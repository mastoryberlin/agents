//#region src/session/storage.ts
var SessionStorage = class {
  constructor(sql, exec) {
    this.sql = sql;
    this.exec = exec ?? null;
    this._initSchema();
  }
  _initSchema() {
    this.sql`
      CREATE TABLE IF NOT EXISTS assistant_sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS assistant_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        parent_id TEXT,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES assistant_sessions(id)
      )
    `;
    this.sql`
      CREATE INDEX IF NOT EXISTS idx_assistant_messages_session
      ON assistant_messages(session_id, created_at)
    `;
    this.sql`
      CREATE INDEX IF NOT EXISTS idx_assistant_messages_parent
      ON assistant_messages(parent_id)
    `;
    this.sql`
      CREATE TABLE IF NOT EXISTS assistant_compactions (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        summary TEXT NOT NULL,
        from_message_id TEXT NOT NULL,
        to_message_id TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (session_id) REFERENCES assistant_sessions(id)
      )
    `;
  }
  createSession(id, name) {
    this.sql`
      INSERT INTO assistant_sessions (id, name)
      VALUES (${id}, ${name})
    `;
    return this.sql`
      SELECT * FROM assistant_sessions WHERE id = ${id}
    `[0];
  }
  getSession(id) {
    return (
      this.sql`
      SELECT * FROM assistant_sessions WHERE id = ${id}
    `[0] ?? null
    );
  }
  listSessions() {
    return this.sql`
      SELECT * FROM assistant_sessions ORDER BY updated_at DESC
    `;
  }
  updateSessionTimestamp(id) {
    this.sql`
      UPDATE assistant_sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ${id}
    `;
  }
  deleteSession(id) {
    this.sql`DELETE FROM assistant_compactions WHERE session_id = ${id}`;
    this.sql`DELETE FROM assistant_messages WHERE session_id = ${id}`;
    this.sql`DELETE FROM assistant_sessions WHERE id = ${id}`;
  }
  /**
   * Delete all messages and compactions for a session without
   * deleting the session itself. Resets updated_at.
   */
  clearSessionMessages(id) {
    this.sql`DELETE FROM assistant_compactions WHERE session_id = ${id}`;
    this.sql`DELETE FROM assistant_messages WHERE session_id = ${id}`;
    this.updateSessionTimestamp(id);
  }
  renameSession(id, name) {
    this.sql`
      UPDATE assistant_sessions SET name = ${name}, updated_at = CURRENT_TIMESTAMP
      WHERE id = ${id}
    `;
  }
  /**
   * Insert a message. Uses INSERT OR IGNORE so appending the same
   * message ID twice is a safe no-op (idempotent).
   */
  appendMessage(id, sessionId, parentId, message) {
    const content = JSON.stringify(message);
    this.sql`
      INSERT OR IGNORE INTO assistant_messages (id, session_id, parent_id, role, content)
      VALUES (${id}, ${sessionId}, ${parentId}, ${message.role}, ${content})
    `;
    this.updateSessionTimestamp(sessionId);
    return this.sql`
      SELECT * FROM assistant_messages WHERE id = ${id}
    `[0];
  }
  /**
   * Insert or update a message. Uses INSERT ... ON CONFLICT to update
   * the content if the message already exists (same id). This enables
   * incremental persistence — first call inserts, subsequent calls update.
   */
  upsertMessage(id, sessionId, parentId, message) {
    const content = JSON.stringify(message);
    this.sql`
      INSERT INTO assistant_messages (id, session_id, parent_id, role, content)
      VALUES (${id}, ${sessionId}, ${parentId}, ${message.role}, ${content})
      ON CONFLICT(id) DO UPDATE SET content = ${content}
    `;
    this.updateSessionTimestamp(sessionId);
    return this.sql`
      SELECT * FROM assistant_messages WHERE id = ${id}
    `[0];
  }
  /**
   * Delete a single message by ID.
   * In a tree structure, children of the deleted message retain their
   * parent_id (now pointing to a missing row), which naturally truncates
   * the path when walking via the recursive CTE.
   */
  deleteMessage(id) {
    this.sql`DELETE FROM assistant_messages WHERE id = ${id}`;
  }
  /**
   * Delete multiple messages by ID in a single query.
   */
  deleteMessages(ids) {
    if (ids.length === 0) return;
    if (this.exec) {
      const placeholders = ids.map(() => "?").join(", ");
      this.exec(
        `DELETE FROM assistant_messages WHERE id IN (${placeholders})`,
        ...ids
      );
    } else
      for (const id of ids)
        this.sql`DELETE FROM assistant_messages WHERE id = ${id}`;
  }
  getMessage(id) {
    return (
      this.sql`
      SELECT * FROM assistant_messages WHERE id = ${id}
    `[0] ?? null
    );
  }
  /**
   * Get all messages for a session, ordered by creation time.
   * This returns the flat list — use getMessagePath for a branch path.
   */
  getSessionMessages(sessionId) {
    return this.sql`
      SELECT * FROM assistant_messages
      WHERE session_id = ${sessionId}
      ORDER BY created_at ASC
    `;
  }
  /**
   * Walk from a leaf message back to the root via a recursive CTE,
   * returning messages in chronological order (root first).
   * Uses a depth counter for ordering since created_at may be
   * identical for messages inserted in quick succession.
   */
  getMessagePath(leafId) {
    return this.sql`
      WITH RECURSIVE path AS (
        SELECT *, 0 as depth FROM assistant_messages WHERE id = ${leafId}
        UNION ALL
        SELECT m.*, p.depth + 1 FROM assistant_messages m
        JOIN path p ON m.id = p.parent_id
      )
      SELECT id, session_id, parent_id, role, content, created_at
      FROM path ORDER BY depth DESC
    `;
  }
  /**
   * Count the number of messages on the path from root to leaf.
   * Used by needsCompaction to avoid loading full message content.
   */
  getPathLength(leafId) {
    return (
      this.sql`
      WITH RECURSIVE path AS (
        SELECT id, parent_id FROM assistant_messages WHERE id = ${leafId}
        UNION ALL
        SELECT m.id, m.parent_id FROM assistant_messages m
        JOIN path p ON m.id = p.parent_id
      )
      SELECT COUNT(*) as count FROM path
    `[0]?.count ?? 0
    );
  }
  /**
   * Get children of a message (for branch exploration).
   */
  getChildren(parentId) {
    return this.sql`
      SELECT * FROM assistant_messages
      WHERE parent_id = ${parentId}
      ORDER BY created_at ASC
    `;
  }
  /**
   * Get the latest leaf message in a session (most recent message
   * that has no children). Used to find the "current" position.
   */
  getLatestLeaf(sessionId) {
    return (
      this.sql`
      SELECT m.* FROM assistant_messages m
      LEFT JOIN assistant_messages c ON c.parent_id = m.id
      WHERE m.session_id = ${sessionId} AND c.id IS NULL
      ORDER BY m.created_at DESC
      LIMIT 1
    `[0] ?? null
    );
  }
  /**
   * Count all messages in a session (across all branches).
   */
  getMessageCount(sessionId) {
    return (
      this.sql`
      SELECT COUNT(*) as count FROM assistant_messages
      WHERE session_id = ${sessionId}
    `[0]?.count ?? 0
    );
  }
  addCompaction(id, sessionId, summary, fromMessageId, toMessageId) {
    this.sql`
      INSERT INTO assistant_compactions (id, session_id, summary, from_message_id, to_message_id)
      VALUES (${id}, ${sessionId}, ${summary}, ${fromMessageId}, ${toMessageId})
    `;
    return this.sql`
      SELECT * FROM assistant_compactions WHERE id = ${id}
    `[0];
  }
  getCompactions(sessionId) {
    return this.sql`
      SELECT * FROM assistant_compactions
      WHERE session_id = ${sessionId}
      ORDER BY created_at ASC
    `;
  }
  /**
   * Parse a stored message's content field back into a UIMessage.
   */
  parseMessage(stored) {
    return JSON.parse(stored.content);
  }
};
//#endregion
//#region src/session/index.ts
const DEFAULT_MAX_CHARS = 3e4;
const ELLIPSIS = "\n\n... [truncated] ...\n\n";
/**
 * Truncate from the head (keep the end of the content).
 */
function truncateHead(text, maxChars = DEFAULT_MAX_CHARS) {
  if (text.length <= maxChars) return text;
  const keep = maxChars - 23;
  if (keep <= 0) return text.slice(-maxChars);
  return ELLIPSIS + text.slice(-keep);
}
/**
 * Truncate from the tail (keep the start of the content).
 */
function truncateTail(text, maxChars = DEFAULT_MAX_CHARS) {
  if (text.length <= maxChars) return text;
  const keep = maxChars - 23;
  if (keep <= 0) return text.slice(0, maxChars);
  return text.slice(0, keep) + ELLIPSIS;
}
/**
 * Truncate by line count (keep the first N lines).
 */
function truncateLines(text, maxLines = 200) {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return (
    lines.slice(0, maxLines).join("\n") +
    `\n\n... [${lines.length - maxLines} more lines truncated] ...`
  );
}
/**
 * Truncate from both ends, keeping the start and end.
 */
function truncateMiddle(text, maxChars = DEFAULT_MAX_CHARS) {
  if (text.length <= maxChars) return text;
  const halfKeep = Math.floor((maxChars - 23) / 2);
  if (halfKeep <= 0) return text.slice(0, maxChars);
  return text.slice(0, halfKeep) + ELLIPSIS + text.slice(-halfKeep);
}
/**
 * Smart truncation for tool output.
 */
function truncateToolOutput(output, options = {}) {
  const {
    maxChars = DEFAULT_MAX_CHARS,
    maxLines = 500,
    strategy = "tail"
  } = options;
  let result = truncateLines(output, maxLines);
  if (result.length > maxChars)
    switch (strategy) {
      case "head":
        result = truncateHead(result, maxChars);
        break;
      case "middle":
        result = truncateMiddle(result, maxChars);
        break;
      default:
        result = truncateTail(result, maxChars);
        break;
    }
  return result;
}
var SessionManager = class {
  constructor(agent, options = {}) {
    this._storage = new SessionStorage(agent.sql.bind(agent), options.exec);
    this._options = {
      maxContextMessages: 100,
      ...options
    };
  }
  /**
   * Create a new session with a name.
   */
  create(name) {
    return this._storage.createSession(crypto.randomUUID(), name);
  }
  /**
   * Get a session by ID.
   */
  get(sessionId) {
    return this._storage.getSession(sessionId);
  }
  /**
   * List all sessions, most recently updated first.
   */
  list() {
    return this._storage.listSessions();
  }
  /**
   * Delete a session and all its messages and compactions.
   */
  delete(sessionId) {
    this._storage.deleteSession(sessionId);
  }
  /**
   * Clear all messages and compactions for a session without
   * deleting the session itself.
   */
  clearMessages(sessionId) {
    this._storage.clearSessionMessages(sessionId);
  }
  /**
   * Rename a session.
   */
  rename(sessionId, name) {
    this._storage.renameSession(sessionId, name);
  }
  /**
   * Append a message to a session. If parentId is not provided,
   * the message is appended after the latest leaf.
   *
   * Idempotent — appending the same message.id twice is a no-op.
   *
   * Returns the stored message ID.
   */
  append(sessionId, message, parentId) {
    const resolvedParent =
      parentId ?? this._storage.getLatestLeaf(sessionId)?.id ?? null;
    const id = message.id || crypto.randomUUID();
    this._storage.appendMessage(id, sessionId, resolvedParent, message);
    return id;
  }
  /**
   * Insert or update a message. First call inserts, subsequent calls
   * update the content. Enables incremental persistence.
   *
   * Idempotent on insert, content-updating on subsequent calls.
   */
  upsert(sessionId, message, parentId) {
    const resolvedParent =
      parentId ?? this._storage.getLatestLeaf(sessionId)?.id ?? null;
    const id = message.id || crypto.randomUUID();
    this._storage.upsertMessage(id, sessionId, resolvedParent, message);
    return id;
  }
  /**
   * Delete a single message by ID.
   * Children of the deleted message naturally become path roots
   * (their parent_id points to a missing row, truncating the CTE walk).
   */
  deleteMessage(messageId) {
    this._storage.deleteMessage(messageId);
  }
  /**
   * Delete multiple messages by ID.
   */
  deleteMessages(messageIds) {
    this._storage.deleteMessages(messageIds);
  }
  /**
   * Append multiple messages in sequence (each parented to the previous).
   * Returns the ID of the last appended message.
   */
  appendAll(sessionId, messages, parentId) {
    let lastId = parentId ?? null;
    for (const msg of messages) {
      const resolvedParent =
        lastId ?? this._storage.getLatestLeaf(sessionId)?.id ?? null;
      const id = msg.id || crypto.randomUUID();
      this._storage.appendMessage(id, sessionId, resolvedParent, msg);
      lastId = id;
    }
    return lastId;
  }
  /**
   * Get the conversation history for a session as UIMessage[].
   *
   * If leafId is provided, returns the path from root to that leaf
   * (a specific branch). Otherwise returns the path to the most
   * recent leaf (the "current" branch).
   *
   * If compactions exist, older messages covered by a compaction
   * are replaced with a system message containing the summary.
   */
  getHistory(sessionId, leafId) {
    const leaf = leafId
      ? this._storage.getMessage(leafId)
      : this._storage.getLatestLeaf(sessionId);
    if (!leaf) return [];
    const storedPath = this._storage.getMessagePath(leaf.id);
    const compactions = this._storage.getCompactions(sessionId);
    if (compactions.length === 0)
      return storedPath.map((m) => this._storage.parseMessage(m));
    return this._applyCompactions(storedPath, compactions);
  }
  /**
   * Get the total message count for a session (across all branches).
   */
  getMessageCount(sessionId) {
    return this._storage.getMessageCount(sessionId);
  }
  /**
   * Check if the session's current branch needs compaction.
   * Uses a count-only query — does not load message content.
   */
  needsCompaction(sessionId) {
    const leaf = this._storage.getLatestLeaf(sessionId);
    if (!leaf) return false;
    return (
      this._storage.getPathLength(leaf.id) >
      (this._options.maxContextMessages ?? 100)
    );
  }
  /**
   * Get the children of a message (branches from that point).
   */
  getBranches(messageId) {
    return this._storage
      .getChildren(messageId)
      .map((m) => this._storage.parseMessage(m));
  }
  /**
   * Fork a session at a specific message, creating a new session
   * with the history up to that point copied over.
   */
  fork(atMessageId, newName) {
    const newSession = this.create(newName);
    const path = this._storage.getMessagePath(atMessageId);
    let parentId = null;
    for (const stored of path) {
      const msg = this._storage.parseMessage(stored);
      const newId = crypto.randomUUID();
      this._storage.appendMessage(newId, newSession.id, parentId, msg);
      parentId = newId;
    }
    return newSession;
  }
  /**
   * Add a compaction record. The summary replaces messages from
   * fromMessageId to toMessageId in context assembly.
   *
   * Typically called after using an LLM to summarize older messages.
   */
  addCompaction(sessionId, summary, fromMessageId, toMessageId) {
    return this._storage.addCompaction(
      crypto.randomUUID(),
      sessionId,
      summary,
      fromMessageId,
      toMessageId
    );
  }
  /**
   * Get all compaction records for a session.
   */
  getCompactions(sessionId) {
    return this._storage.getCompactions(sessionId);
  }
  _applyCompactions(path, compactions) {
    const pathIds = path.map((m) => m.id);
    const result = [];
    let i = 0;
    while (i < path.length) {
      const compaction = compactions.find(
        (c) => c.from_message_id === pathIds[i]
      );
      if (compaction) {
        const endIdx = pathIds.indexOf(compaction.to_message_id);
        if (endIdx >= i) {
          result.push({
            id: `compaction_${compaction.id}`,
            role: "system",
            parts: [
              {
                type: "text",
                text: `[Previous conversation summary]\n${compaction.summary}`
              }
            ]
          });
          i = endIdx + 1;
        } else {
          result.push(JSON.parse(path[i].content));
          i++;
        }
      } else {
        result.push(JSON.parse(path[i].content));
        i++;
      }
    }
    return result;
  }
};
//#endregion
export {
  truncateTail as a,
  truncateMiddle as i,
  truncateHead as n,
  truncateToolOutput as o,
  truncateLines as r,
  SessionManager as t
};

//# sourceMappingURL=session-C6ZU_1zM.js.map
