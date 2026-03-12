import { UIMessage } from "ai";

//#region src/session/storage.d.ts
interface Session {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}
interface Compaction {
  id: string;
  session_id: string;
  summary: string;
  from_message_id: string;
  to_message_id: string;
  created_at: string;
}
//#endregion
//#region src/session/index.d.ts
/**
 * Truncate from the head (keep the end of the content).
 */
declare function truncateHead(text: string, maxChars?: number): string;
/**
 * Truncate from the tail (keep the start of the content).
 */
declare function truncateTail(text: string, maxChars?: number): string;
/**
 * Truncate by line count (keep the first N lines).
 */
declare function truncateLines(text: string, maxLines?: number): string;
/**
 * Truncate from both ends, keeping the start and end.
 */
declare function truncateMiddle(text: string, maxChars?: number): string;
/**
 * Smart truncation for tool output.
 */
declare function truncateToolOutput(
  output: string,
  options?: {
    maxChars?: number;
    maxLines?: number;
    strategy?: "head" | "tail" | "middle";
  }
): string;
interface AgentLike {
  sql: (
    strings: TemplateStringsArray,
    ...values: (string | number | boolean | null)[]
  ) => Array<Record<string, unknown>>;
}
interface SessionManagerOptions {
  /**
   * Maximum number of messages on the current branch before
   * needsCompaction() returns true. Default: 100.
   */
  maxContextMessages?: number;
  /**
   * Raw SQL exec function for batch operations (e.g. DELETE ... WHERE id IN (...)).
   * When provided, batch deletes use a single query instead of N individual ones.
   *
   * Typically: `(query, ...values) => { agent.ctx.storage.sql.exec(query, ...values); }`
   */
  exec?: (
    query: string,
    ...values: (string | number | boolean | null)[]
  ) => void;
}
declare class SessionManager {
  private _storage;
  private _options;
  constructor(agent: AgentLike, options?: SessionManagerOptions);
  /**
   * Create a new session with a name.
   */
  create(name: string): Session;
  /**
   * Get a session by ID.
   */
  get(sessionId: string): Session | null;
  /**
   * List all sessions, most recently updated first.
   */
  list(): Session[];
  /**
   * Delete a session and all its messages and compactions.
   */
  delete(sessionId: string): void;
  /**
   * Clear all messages and compactions for a session without
   * deleting the session itself.
   */
  clearMessages(sessionId: string): void;
  /**
   * Rename a session.
   */
  rename(sessionId: string, name: string): void;
  /**
   * Append a message to a session. If parentId is not provided,
   * the message is appended after the latest leaf.
   *
   * Idempotent — appending the same message.id twice is a no-op.
   *
   * Returns the stored message ID.
   */
  append(sessionId: string, message: UIMessage, parentId?: string): string;
  /**
   * Insert or update a message. First call inserts, subsequent calls
   * update the content. Enables incremental persistence.
   *
   * Idempotent on insert, content-updating on subsequent calls.
   */
  upsert(sessionId: string, message: UIMessage, parentId?: string): string;
  /**
   * Delete a single message by ID.
   * Children of the deleted message naturally become path roots
   * (their parent_id points to a missing row, truncating the CTE walk).
   */
  deleteMessage(messageId: string): void;
  /**
   * Delete multiple messages by ID.
   */
  deleteMessages(messageIds: string[]): void;
  /**
   * Append multiple messages in sequence (each parented to the previous).
   * Returns the ID of the last appended message.
   */
  appendAll(
    sessionId: string,
    messages: UIMessage[],
    parentId?: string
  ): string | null;
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
  getHistory(sessionId: string, leafId?: string): UIMessage[];
  /**
   * Get the total message count for a session (across all branches).
   */
  getMessageCount(sessionId: string): number;
  /**
   * Check if the session's current branch needs compaction.
   * Uses a count-only query — does not load message content.
   */
  needsCompaction(sessionId: string): boolean;
  /**
   * Get the children of a message (branches from that point).
   */
  getBranches(messageId: string): UIMessage[];
  /**
   * Fork a session at a specific message, creating a new session
   * with the history up to that point copied over.
   */
  fork(atMessageId: string, newName: string): Session;
  /**
   * Add a compaction record. The summary replaces messages from
   * fromMessageId to toMessageId in context assembly.
   *
   * Typically called after using an LLM to summarize older messages.
   */
  addCompaction(
    sessionId: string,
    summary: string,
    fromMessageId: string,
    toMessageId: string
  ): Compaction;
  /**
   * Get all compaction records for a session.
   */
  getCompactions(sessionId: string): Compaction[];
  private _applyCompactions;
}
//#endregion
export {
  truncateMiddle as a,
  Compaction as c,
  truncateLines as i,
  Session as l,
  SessionManagerOptions as n,
  truncateTail as o,
  truncateHead as r,
  truncateToolOutput as s,
  SessionManager as t
};
//# sourceMappingURL=index-C4OTSwUW.d.ts.map
