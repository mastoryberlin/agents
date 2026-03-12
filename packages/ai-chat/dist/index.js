import { MessageType } from "./types.js";
import { autoTransformMessages } from "./ai-chat-v5-migration.js";
import { t as applyChunkToParts } from "./message-builder-BAgcFJMf.js";
import { jsonSchema, tool } from "ai";
import { Agent, __DO_NOT_USE_WILL_BREAK__agentContext } from "agents";
import { nanoid } from "nanoid";
//#region src/resumable-stream.ts
/**
 * ResumableStream: Standalone class for buffering, persisting, and replaying
 * stream chunks in SQLite. Extracted from AIChatAgent to separate concerns.
 *
 * Handles:
 * - Chunk buffering (batched writes to SQLite for performance)
 * - Stream lifecycle (start, complete, error)
 * - Chunk replay for reconnecting clients
 * - Stale stream cleanup
 * - Active stream restoration after agent restart
 */
/** Number of chunks to buffer before flushing to SQLite */
const CHUNK_BUFFER_SIZE = 10;
/** Maximum buffer size to prevent memory issues on rapid reconnections */
const CHUNK_BUFFER_MAX_SIZE = 100;
/** Maximum age for a "streaming" stream before considering it stale (ms) - 5 minutes */
const STREAM_STALE_THRESHOLD_MS = 300 * 1e3;
/** Default cleanup interval for old streams (ms) - every 10 minutes */
const CLEANUP_INTERVAL_MS = 600 * 1e3;
/** Default age threshold for cleaning up completed streams (ms) - 24 hours */
const CLEANUP_AGE_THRESHOLD_MS = 1440 * 60 * 1e3;
/** Shared encoder for UTF-8 byte length measurement */
const textEncoder$1 = new TextEncoder();
var ResumableStream = class ResumableStream {
  constructor(sql) {
    this.sql = sql;
    this._activeStreamId = null;
    this._activeRequestId = null;
    this._streamChunkIndex = 0;
    this._isLive = false;
    this._chunkBuffer = [];
    this._isFlushingChunks = false;
    this._lastCleanupTime = 0;
    this.sql`create table if not exists cf_ai_chat_stream_chunks (
      id text primary key,
      stream_id text not null,
      body text not null,
      chunk_index integer not null,
      created_at integer not null
    )`;
    this.sql`create table if not exists cf_ai_chat_stream_metadata (
      id text primary key,
      request_id text not null,
      status text not null,
      created_at integer not null,
      completed_at integer
    )`;
    this.sql`create index if not exists idx_stream_chunks_stream_id 
      on cf_ai_chat_stream_chunks(stream_id, chunk_index)`;
    this.restore();
  }
  get activeStreamId() {
    return this._activeStreamId;
  }
  get activeRequestId() {
    return this._activeRequestId;
  }
  hasActiveStream() {
    return this._activeStreamId !== null;
  }
  /**
   * Whether the active stream has a live LLM reader (started in this
   * instance) vs being restored from SQLite after hibernation (orphaned).
   */
  get isLive() {
    return this._isLive;
  }
  /**
   * Start tracking a new stream for resumable streaming.
   * Creates metadata entry in SQLite and sets up tracking state.
   * @param requestId - The unique ID of the chat request
   * @returns The generated stream ID
   */
  start(requestId) {
    this.flushBuffer();
    const streamId = nanoid();
    this._activeStreamId = streamId;
    this._activeRequestId = requestId;
    this._streamChunkIndex = 0;
    this._isLive = true;
    this.sql`
      insert into cf_ai_chat_stream_metadata (id, request_id, status, created_at)
      values (${streamId}, ${requestId}, 'streaming', ${Date.now()})
    `;
    return streamId;
  }
  /**
   * Mark a stream as completed and flush any pending chunks.
   * @param streamId - The stream to mark as completed
   */
  complete(streamId) {
    this.flushBuffer();
    this.sql`
      update cf_ai_chat_stream_metadata 
      set status = 'completed', completed_at = ${Date.now()} 
      where id = ${streamId}
    `;
    this._activeStreamId = null;
    this._activeRequestId = null;
    this._streamChunkIndex = 0;
    this._isLive = false;
    this._maybeCleanupOldStreams();
  }
  /**
   * Mark a stream as errored and clean up state.
   * @param streamId - The stream to mark as errored
   */
  markError(streamId) {
    this.flushBuffer();
    this.sql`
      update cf_ai_chat_stream_metadata 
      set status = 'error', completed_at = ${Date.now()} 
      where id = ${streamId}
    `;
    this._activeStreamId = null;
    this._activeRequestId = null;
    this._streamChunkIndex = 0;
    this._isLive = false;
  }
  static {
    this.CHUNK_MAX_BYTES = 18e5;
  }
  /**
   * Buffer a stream chunk for batch write to SQLite.
   * Chunks exceeding the row size limit are skipped to prevent crashes.
   * The chunk is still broadcast to live clients (caller handles that),
   * but will be missing from replay on reconnection.
   * @param streamId - The stream this chunk belongs to
   * @param body - The serialized chunk body
   */
  storeChunk(streamId, body) {
    const bodyBytes = textEncoder$1.encode(body).byteLength;
    if (bodyBytes > ResumableStream.CHUNK_MAX_BYTES) {
      console.warn(
        `[ResumableStream] Skipping oversized chunk (${bodyBytes} bytes) to prevent SQLite row limit crash. Live clients still receive it.`
      );
      return;
    }
    if (this._chunkBuffer.length >= CHUNK_BUFFER_MAX_SIZE) this.flushBuffer();
    this._chunkBuffer.push({
      id: nanoid(),
      streamId,
      body,
      index: this._streamChunkIndex
    });
    this._streamChunkIndex++;
    if (this._chunkBuffer.length >= CHUNK_BUFFER_SIZE) this.flushBuffer();
  }
  /**
   * Flush buffered chunks to SQLite in a single batch.
   * Uses a lock to prevent concurrent flush operations.
   */
  flushBuffer() {
    if (this._isFlushingChunks || this._chunkBuffer.length === 0) return;
    this._isFlushingChunks = true;
    try {
      const chunks = this._chunkBuffer;
      this._chunkBuffer = [];
      const now = Date.now();
      for (const chunk of chunks)
        this.sql`
          insert into cf_ai_chat_stream_chunks (id, stream_id, body, chunk_index, created_at)
          values (${chunk.id}, ${chunk.streamId}, ${chunk.body}, ${chunk.index}, ${now})
        `;
    } finally {
      this._isFlushingChunks = false;
    }
  }
  /**
   * Send stored stream chunks to a connection for replay.
   * Chunks are marked with replay: true so the client can batch-apply them.
   *
   * Three outcomes:
   * - **Live stream**: sends chunks + `replayComplete` — client flushes and
   *   continues receiving live chunks from the LLM reader.
   * - **Orphaned stream** (restored from SQLite after hibernation, no reader):
   *   sends chunks + `done` and completes the stream. The caller should
   *   reconstruct and persist the partial message from the stored chunks.
   * - **Completed during replay** (defensive): sends chunks + `done`.
   *
   * @param connection - The WebSocket connection
   * @param requestId - The original request ID
   * @returns The stream ID if the stream was orphaned and finalized, null otherwise.
   *          When non-null the caller should reconstruct the message from chunks.
   */
  replayChunks(connection, requestId) {
    const streamId = this._activeStreamId;
    if (!streamId) return null;
    this.flushBuffer();
    const chunks = this.sql`
      select * from cf_ai_chat_stream_chunks 
      where stream_id = ${streamId} 
      order by chunk_index asc
    `;
    for (const chunk of chunks || [])
      connection.send(
        JSON.stringify({
          body: chunk.body,
          done: false,
          id: requestId,
          type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
          replay: true
        })
      );
    if (this._activeStreamId !== streamId) {
      connection.send(
        JSON.stringify({
          body: "",
          done: true,
          id: requestId,
          type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
          replay: true
        })
      );
      return null;
    }
    if (!this._isLive) {
      connection.send(
        JSON.stringify({
          body: "",
          done: true,
          id: requestId,
          type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
          replay: true
        })
      );
      this.complete(streamId);
      return streamId;
    }
    connection.send(
      JSON.stringify({
        body: "",
        done: false,
        id: requestId,
        type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
        replay: true,
        replayComplete: true
      })
    );
    return null;
  }
  /**
   * Restore active stream state if the agent was restarted during streaming.
   * Validates stream freshness to avoid sending stale resume notifications.
   */
  restore() {
    const activeStreams = this.sql`
      select * from cf_ai_chat_stream_metadata 
      where status = 'streaming' 
      order by created_at desc 
      limit 1
    `;
    if (activeStreams && activeStreams.length > 0) {
      const stream = activeStreams[0];
      const streamAge = Date.now() - stream.created_at;
      if (streamAge > STREAM_STALE_THRESHOLD_MS) {
        this
          .sql`delete from cf_ai_chat_stream_chunks where stream_id = ${stream.id}`;
        this
          .sql`delete from cf_ai_chat_stream_metadata where id = ${stream.id}`;
        console.warn(
          `[ResumableStream] Deleted stale stream ${stream.id} (age: ${Math.round(streamAge / 1e3)}s)`
        );
        return;
      }
      this._activeStreamId = stream.id;
      this._activeRequestId = stream.request_id;
      const lastChunk = this.sql`
        select max(chunk_index) as max_index 
        from cf_ai_chat_stream_chunks 
        where stream_id = ${this._activeStreamId}
      `;
      this._streamChunkIndex =
        lastChunk && lastChunk[0]?.max_index != null
          ? lastChunk[0].max_index + 1
          : 0;
    }
  }
  /**
   * Clear all stream data (called on chat history clear).
   */
  clearAll() {
    this._chunkBuffer = [];
    this.sql`delete from cf_ai_chat_stream_chunks`;
    this.sql`delete from cf_ai_chat_stream_metadata`;
    this._activeStreamId = null;
    this._activeRequestId = null;
    this._streamChunkIndex = 0;
  }
  /**
   * Drop all stream tables (called on destroy).
   */
  destroy() {
    this.flushBuffer();
    this.sql`drop table if exists cf_ai_chat_stream_chunks`;
    this.sql`drop table if exists cf_ai_chat_stream_metadata`;
    this._activeStreamId = null;
    this._activeRequestId = null;
  }
  _maybeCleanupOldStreams() {
    const now = Date.now();
    if (now - this._lastCleanupTime < CLEANUP_INTERVAL_MS) return;
    this._lastCleanupTime = now;
    const cutoff = now - CLEANUP_AGE_THRESHOLD_MS;
    this.sql`
      delete from cf_ai_chat_stream_chunks 
      where stream_id in (
        select id from cf_ai_chat_stream_metadata 
        where status in ('completed', 'error') and completed_at < ${cutoff}
      )
    `;
    this.sql`
      delete from cf_ai_chat_stream_metadata 
      where status in ('completed', 'error') and completed_at < ${cutoff}
    `;
  }
  /** @internal For testing only */
  getStreamChunks(streamId) {
    return (
      this.sql`
        select body, chunk_index from cf_ai_chat_stream_chunks 
        where stream_id = ${streamId} 
        order by chunk_index asc
      ` || []
    );
  }
  /** @internal For testing only */
  getStreamMetadata(streamId) {
    const result = this.sql`
      select status, request_id from cf_ai_chat_stream_metadata 
      where id = ${streamId}
    `;
    return result && result.length > 0 ? result[0] : null;
  }
  /** @internal For testing only */
  getAllStreamMetadata() {
    return (
      this
        .sql`select id, status, request_id, created_at from cf_ai_chat_stream_metadata` ||
      []
    );
  }
  /** @internal For testing only */
  insertStaleStream(streamId, requestId, ageMs) {
    const createdAt = Date.now() - ageMs;
    this.sql`
      insert into cf_ai_chat_stream_metadata (id, request_id, status, created_at)
      values (${streamId}, ${requestId}, 'streaming', ${createdAt})
    `;
  }
};
//#endregion
//#region src/index.ts
/** Shared encoder for UTF-8 byte length measurement */
const textEncoder = new TextEncoder();
/**
 * Validates that a parsed message has the minimum required structure.
 * Returns false for messages that would cause runtime errors downstream
 * (e.g. in convertToModelMessages or the UI layer).
 *
 * Checks:
 * - `id` is a non-empty string
 * - `role` is one of the valid roles
 * - `parts` is an array (may be empty — the AI SDK enforces nonempty
 *   on incoming messages, but we are lenient on persisted data)
 */
function isValidMessageStructure(msg) {
  if (typeof msg !== "object" || msg === null) return false;
  const m = msg;
  if (typeof m.id !== "string" || m.id.length === 0) return false;
  if (m.role !== "user" && m.role !== "assistant" && m.role !== "system")
    return false;
  if (!Array.isArray(m.parts)) return false;
  return true;
}
/**
 * Converts client tool schemas to AI SDK tool format.
 *
 * These tools have no `execute` function — when the AI model calls them,
 * the tool call is sent back to the client for execution.
 *
 * **For most apps**, define tools on the server with `tool()` from `"ai"`
 * for full Zod type safety. This helper is intended for SDK/platform use
 * cases where the tool surface is determined dynamically by the client.
 *
 * @param clientTools - Array of tool schemas from the client
 * @returns Record of AI SDK tools that can be spread into your tools object
 *
 * @example
 * ```typescript
 * // In onChatMessage:
 * const tools = {
 *   ...createToolsFromClientSchemas(options.clientTools),
 *   // server-defined tools with execute:
 *   myServerTool: tool({ ... }),
 * };
 * ```
 */
function createToolsFromClientSchemas(clientTools) {
  if (!clientTools || clientTools.length === 0) return {};
  const seenNames = /* @__PURE__ */ new Set();
  for (const t of clientTools) {
    if (seenNames.has(t.name))
      console.warn(
        `[createToolsFromClientSchemas] Duplicate tool name "${t.name}" found. Later definitions will override earlier ones.`
      );
    seenNames.add(t.name);
  }
  return Object.fromEntries(
    clientTools.map((t) => [
      t.name,
      tool({
        description: t.description ?? "",
        inputSchema: jsonSchema(t.parameters ?? { type: "object" })
      })
    ])
  );
}
const decoder = new TextDecoder();
/**
 * Extension of Agent with built-in chat capabilities
 * @template Env Environment type containing bindings
 */
var AIChatAgent = class AIChatAgent extends Agent {
  static {
    this.ROW_MAX_BYTES = 18e5;
  }
  /** Measure UTF-8 byte length of a string (accurate for SQLite row limits). */
  static _byteLength(s) {
    return textEncoder.encode(s).byteLength;
  }
  constructor(ctx, env) {
    super(ctx, env);
    this._streamingMessage = null;
    this._approvalPersistedMessageId = null;
    this._streamCompletionPromise = null;
    this._streamCompletionResolve = null;
    this._pendingResumeConnections = /* @__PURE__ */ new Set();
    this._persistedMessageCache = /* @__PURE__ */ new Map();
    this.maxPersistedMessages = void 0;
    this.waitForMcpConnections = { timeout: 1e4 };
    this.sql`create table if not exists cf_ai_chat_agent_messages (
      id text primary key,
      message text not null,
      created_at datetime default current_timestamp
    )`;
    this.sql`create table if not exists cf_ai_chat_request_context (
      key text primary key,
      value text not null
    )`;
    this._restoreRequestContext();
    this._resumableStream = new ResumableStream(this.sql.bind(this));
    this.messages = autoTransformMessages(this._loadMessagesFromDb());
    this._chatMessageAbortControllers = /* @__PURE__ */ new Map();
    const _onConnect = this.onConnect.bind(this);
    this.onConnect = async (connection, ctx) => {
      if (this._resumableStream.hasActiveStream())
        this._notifyStreamResuming(connection);
      return _onConnect(connection, ctx);
    };
    const _onClose = this.onClose.bind(this);
    this.onClose = async (connection, code, reason, wasClean) => {
      this._pendingResumeConnections.delete(connection.id);
      return _onClose(connection, code, reason, wasClean);
    };
    const _onMessage = this.onMessage.bind(this);
    this.onMessage = async (connection, message) => {
      await this.mcp.ensureJsonSchema();
      if (typeof message === "string") {
        let data;
        try {
          data = JSON.parse(message);
        } catch (_error) {
          return _onMessage(connection, message);
        }
        if (
          data.type === MessageType.CF_AGENT_USE_CHAT_REQUEST &&
          data.init.method === "POST"
        ) {
          if (this.waitForMcpConnections) {
            const timeout =
              typeof this.waitForMcpConnections === "object"
                ? this.waitForMcpConnections.timeout
                : void 0;
            await this.mcp.waitForConnections(
              timeout != null ? { timeout } : void 0
            );
          }
          const { body } = data.init;
          if (!body) {
            console.warn(
              "[AIChatAgent] Received chat request with empty body, ignoring"
            );
            return;
          }
          let parsed;
          try {
            parsed = JSON.parse(body);
          } catch (_parseError) {
            console.warn(
              "[AIChatAgent] Received chat request with invalid JSON body, ignoring"
            );
            return;
          }
          const {
            messages,
            clientTools,
            trigger: _trigger,
            ...customBody
          } = parsed;
          this._lastClientTools = clientTools?.length ? clientTools : void 0;
          this._lastBody =
            Object.keys(customBody).length > 0 ? customBody : void 0;
          this._persistRequestContext();
          const transformedMessages = autoTransformMessages(messages);
          this._broadcastChatMessage(
            {
              messages: transformedMessages,
              type: MessageType.CF_AGENT_CHAT_MESSAGES
            },
            [connection.id]
          );
          await this.persistMessages(transformedMessages, [connection.id], {
            _deleteStaleRows: true
          });
          this._emit("message:request");
          const chatMessageId = data.id;
          const abortSignal = this._getAbortSignal(chatMessageId);
          return this._tryCatchChat(async () => {
            return __DO_NOT_USE_WILL_BREAK__agentContext.run(
              {
                agent: this,
                connection,
                request: void 0,
                email: void 0
              },
              async () => {
                const response = await this.onChatMessage(
                  async (_finishResult) => {},
                  {
                    requestId: chatMessageId,
                    abortSignal,
                    clientTools,
                    body: this._lastBody
                  }
                );
                if (response)
                  await this._reply(data.id, response, [connection.id], {
                    chatMessageId
                  });
                else {
                  console.warn(
                    `[AIChatAgent] onChatMessage returned no response for chatMessageId: ${chatMessageId}`
                  );
                  this._broadcastChatMessage(
                    {
                      body: "No response was generated by the agent.",
                      done: true,
                      id: data.id,
                      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE
                    },
                    [connection.id]
                  );
                }
              }
            );
          });
        }
        if (data.type === MessageType.CF_AGENT_CHAT_CLEAR) {
          this._destroyAbortControllers();
          this.sql`delete from cf_ai_chat_agent_messages`;
          this._resumableStream.clearAll();
          this._pendingResumeConnections.clear();
          this._lastClientTools = void 0;
          this._lastBody = void 0;
          this._persistRequestContext();
          this._persistedMessageCache.clear();
          this.messages = [];
          this._broadcastChatMessage(
            { type: MessageType.CF_AGENT_CHAT_CLEAR },
            [connection.id]
          );
          this._emit("message:clear");
          return;
        }
        if (data.type === MessageType.CF_AGENT_CHAT_MESSAGES) {
          const transformedMessages = autoTransformMessages(data.messages);
          await this.persistMessages(transformedMessages, [connection.id]);
          return;
        }
        if (data.type === MessageType.CF_AGENT_CHAT_REQUEST_CANCEL) {
          this._cancelChatRequest(data.id);
          this._emit("message:cancel", { requestId: data.id });
          return;
        }
        if (data.type === MessageType.CF_AGENT_STREAM_RESUME_REQUEST) {
          if (this._resumableStream.hasActiveStream())
            this._notifyStreamResuming(connection);
          else
            connection.send(
              JSON.stringify({ type: MessageType.CF_AGENT_STREAM_RESUME_NONE })
            );
          return;
        }
        if (data.type === MessageType.CF_AGENT_STREAM_RESUME_ACK) {
          this._pendingResumeConnections.delete(connection.id);
          if (
            this._resumableStream.hasActiveStream() &&
            this._resumableStream.activeRequestId === data.id
          ) {
            const orphanedStreamId = this._resumableStream.replayChunks(
              connection,
              this._resumableStream.activeRequestId
            );
            if (orphanedStreamId) this._persistOrphanedStream(orphanedStreamId);
          }
          return;
        }
        if (data.type === MessageType.CF_AGENT_TOOL_RESULT) {
          const {
            toolCallId,
            toolName,
            output,
            state,
            errorText,
            autoContinue,
            clientTools
          } = data;
          if (clientTools?.length) {
            this._lastClientTools = clientTools;
            this._persistRequestContext();
          }
          const overrideState =
            state === "output-error" ? "output-error" : void 0;
          this._emit("tool:result", {
            toolCallId,
            toolName
          });
          this._applyToolResult(
            toolCallId,
            toolName,
            output,
            overrideState,
            errorText
          ).then((applied) => {
            if (applied && autoContinue) {
              const waitForStream = async () => {
                if (this._streamCompletionPromise)
                  await this._streamCompletionPromise;
                else await new Promise((resolve) => setTimeout(resolve, 500));
              };
              waitForStream()
                .then(() => {
                  const continuationId = nanoid();
                  const abortSignal = this._getAbortSignal(continuationId);
                  return this._tryCatchChat(async () => {
                    return __DO_NOT_USE_WILL_BREAK__agentContext.run(
                      {
                        agent: this,
                        connection,
                        request: void 0,
                        email: void 0
                      },
                      async () => {
                        const response = await this.onChatMessage(
                          async (_finishResult) => {},
                          {
                            requestId: continuationId,
                            abortSignal,
                            clientTools: clientTools ?? this._lastClientTools,
                            body: this._lastBody
                          }
                        );
                        if (response)
                          await this._reply(continuationId, response, [], {
                            continuation: true,
                            chatMessageId: continuationId
                          });
                      }
                    );
                  });
                })
                .catch((error) => {
                  console.error(
                    "[AIChatAgent] Tool continuation failed:",
                    error
                  );
                });
            }
          });
          return;
        }
        if (data.type === MessageType.CF_AGENT_TOOL_APPROVAL) {
          const { toolCallId, approved, autoContinue } = data;
          this._emit("tool:approval", {
            toolCallId,
            approved
          });
          this._applyToolApproval(toolCallId, approved).then((applied) => {
            if (applied && autoContinue) {
              const waitForStream = async () => {
                if (this._streamCompletionPromise)
                  await this._streamCompletionPromise;
                else await new Promise((resolve) => setTimeout(resolve, 500));
              };
              waitForStream()
                .then(() => {
                  const continuationId = nanoid();
                  const abortSignal = this._getAbortSignal(continuationId);
                  return this._tryCatchChat(async () => {
                    return __DO_NOT_USE_WILL_BREAK__agentContext.run(
                      {
                        agent: this,
                        connection,
                        request: void 0,
                        email: void 0
                      },
                      async () => {
                        const response = await this.onChatMessage(
                          async (_finishResult) => {},
                          {
                            requestId: continuationId,
                            abortSignal,
                            clientTools: this._lastClientTools,
                            body: this._lastBody
                          }
                        );
                        if (response)
                          await this._reply(continuationId, response, [], {
                            continuation: true,
                            chatMessageId: continuationId
                          });
                      }
                    );
                  });
                })
                .catch((error) => {
                  console.error(
                    "[AIChatAgent] Tool approval continuation failed:",
                    error
                  );
                });
            }
          });
          return;
        }
      }
      return _onMessage(connection, message);
    };
    const _onRequest = this.onRequest.bind(this);
    this.onRequest = async (request) => {
      return this._tryCatchChat(async () => {
        if (new URL(request.url).pathname.split("/").pop() === "get-messages")
          return Response.json(this._loadMessagesFromDb());
        return _onRequest(request);
      });
    };
  }
  /**
   * Notify a connection about an active stream that can be resumed.
   * The client should respond with CF_AGENT_STREAM_RESUME_ACK to receive chunks.
   * @param connection - The WebSocket connection to notify
   */
  _notifyStreamResuming(connection) {
    if (!this._resumableStream.hasActiveStream()) return;
    this._pendingResumeConnections.add(connection.id);
    connection.send(
      JSON.stringify({
        type: MessageType.CF_AGENT_STREAM_RESUMING,
        id: this._resumableStream.activeRequestId
      })
    );
  }
  /** @internal Delegate to _resumableStream */
  get _activeStreamId() {
    return this._resumableStream?.activeStreamId ?? null;
  }
  /** @internal Delegate to _resumableStream */
  get _activeRequestId() {
    return this._resumableStream?.activeRequestId ?? null;
  }
  /** @internal Delegate to _resumableStream */
  _startStream(requestId) {
    return this._resumableStream.start(requestId);
  }
  /** @internal Delegate to _resumableStream */
  _completeStream(streamId) {
    this._resumableStream.complete(streamId);
    this._pendingResumeConnections.clear();
  }
  /** @internal Delegate to _resumableStream */
  _storeStreamChunk(streamId, body) {
    this._resumableStream.storeChunk(streamId, body);
  }
  /** @internal Delegate to _resumableStream */
  _flushChunkBuffer() {
    this._resumableStream.flushBuffer();
  }
  /** @internal Delegate to _resumableStream */
  _restoreActiveStream() {
    this._resumableStream.restore();
  }
  /** @internal Delegate to _resumableStream */
  _markStreamError(streamId) {
    this._resumableStream.markError(streamId);
  }
  /**
   * Reconstruct and persist a partial assistant message from an orphaned
   * stream's stored chunks. Called when the DO wakes from hibernation and
   * discovers an active stream with no live LLM reader.
   *
   * Replays each chunk body through `applyChunkToParts` to rebuild the
   * message parts, then persists the result so it survives further refreshes.
   * @internal
   */
  _persistOrphanedStream(streamId) {
    const chunks = this._resumableStream.getStreamChunks(streamId);
    if (!chunks.length) return;
    const message = {
      id: `assistant_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
      role: "assistant",
      parts: []
    };
    for (const chunk of chunks)
      try {
        const data = JSON.parse(chunk.body);
        if (data.type === "start" && data.messageId != null)
          message.id = data.messageId;
        if (
          (data.type === "start" ||
            data.type === "finish" ||
            data.type === "message-metadata") &&
          data.messageMetadata != null
        )
          message.metadata = message.metadata
            ? {
                ...message.metadata,
                ...data.messageMetadata
              }
            : data.messageMetadata;
        applyChunkToParts(message.parts, data);
      } catch {}
    if (message.parts.length > 0) {
      const existingIdx = this.messages.findIndex((m) => m.id === message.id);
      const updatedMessages =
        existingIdx >= 0
          ? this.messages.map((m, i) => (i === existingIdx ? message : m))
          : [...this.messages, message];
      this.persistMessages(updatedMessages);
    }
  }
  /**
   * Restore _lastBody and _lastClientTools from SQLite.
   * Called in the constructor so these values survive DO hibernation.
   * @internal
   */
  _restoreRequestContext() {
    const rows =
      this.sql`
        select key, value from cf_ai_chat_request_context
      ` || [];
    for (const row of rows)
      try {
        if (row.key === "lastBody") this._lastBody = JSON.parse(row.value);
        else if (row.key === "lastClientTools")
          this._lastClientTools = JSON.parse(row.value);
      } catch {}
  }
  /**
   * Persist _lastBody and _lastClientTools to SQLite so they survive hibernation.
   * Uses upsert (INSERT OR REPLACE) so repeated calls are safe.
   * @internal
   */
  _persistRequestContext() {
    if (this._lastBody)
      this.sql`
        insert or replace into cf_ai_chat_request_context (key, value)
        values ('lastBody', ${JSON.stringify(this._lastBody)})
      `;
    else
      this.sql`delete from cf_ai_chat_request_context where key = 'lastBody'`;
    if (this._lastClientTools)
      this.sql`
        insert or replace into cf_ai_chat_request_context (key, value)
        values ('lastClientTools', ${JSON.stringify(this._lastClientTools)})
      `;
    else
      this
        .sql`delete from cf_ai_chat_request_context where key = 'lastClientTools'`;
  }
  _broadcastChatMessage(message, exclude) {
    const allExclusions = [
      ...(exclude || []),
      ...this._pendingResumeConnections
    ];
    this.broadcast(JSON.stringify(message), allExclusions);
  }
  /**
   * Broadcasts a text event for non-SSE responses.
   * This ensures plain text responses follow the AI SDK v5 stream protocol.
   *
   * @param streamId - The stream identifier for chunk storage
   * @param event - The text event payload (text-start, text-delta with delta, or text-end)
   * @param continuation - Whether this is a continuation of a previous stream
   */
  _broadcastTextEvent(streamId, event, continuation) {
    const body = JSON.stringify(event);
    this._storeStreamChunk(streamId, body);
    this._broadcastChatMessage({
      body,
      done: false,
      id: event.id,
      type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
      ...(continuation && { continuation: true })
    });
  }
  _loadMessagesFromDb() {
    const rows =
      this.sql`select * from cf_ai_chat_agent_messages order by created_at` ||
      [];
    this._persistedMessageCache.clear();
    return rows
      .map((row) => {
        try {
          const messageStr = row.message;
          const parsed = JSON.parse(messageStr);
          if (!isValidMessageStructure(parsed)) {
            console.warn(
              `[AIChatAgent] Skipping invalid message ${row.id}: missing or malformed id, role, or parts`
            );
            return null;
          }
          this._persistedMessageCache.set(parsed.id, messageStr);
          return parsed;
        } catch (error) {
          console.error(`Failed to parse message ${row.id}:`, error);
          return null;
        }
      })
      .filter((msg) => msg !== null);
  }
  async _tryCatchChat(fn) {
    try {
      return await fn();
    } catch (e) {
      throw this.onError(e);
    }
  }
  /**
   * Handle incoming chat messages and generate a response
   * @param onFinish Callback to be called when the response is finished
   * @param options Options including abort signal and client-defined tools
   * @returns Response to send to the client or undefined
   */
  async onChatMessage(onFinish, options) {
    throw new Error(
      "received a chat message, override onChatMessage and return a Response to send to the client"
    );
  }
  /**
   * Save messages on the server side
   * @param messages Chat messages to save
   */
  async saveMessages(messages) {
    await this.persistMessages(messages);
    await this._tryCatchChat(async () => {
      const requestId = nanoid();
      const abortSignal = this._getAbortSignal(requestId);
      const response = await this.onChatMessage(() => {}, {
        requestId,
        abortSignal,
        clientTools: this._lastClientTools,
        body: this._lastBody
      });
      if (response) this._reply(requestId, response);
    });
  }
  async persistMessages(messages, excludeBroadcastIds = [], options) {
    const mergedMessages = this._mergeIncomingWithServerState(messages);
    for (const message of mergedMessages) {
      const sanitizedMessage = this._sanitizeMessageForPersistence(message);
      const resolved = this._resolveMessageForToolMerge(sanitizedMessage);
      const safe = this._enforceRowSizeLimit(resolved);
      const json = JSON.stringify(safe);
      if (this._persistedMessageCache.get(safe.id) === json) continue;
      this.sql`
        insert into cf_ai_chat_agent_messages (id, message)
        values (${safe.id}, ${json})
        on conflict(id) do update set message = excluded.message
      `;
      this._persistedMessageCache.set(safe.id, json);
    }
    if (options?._deleteStaleRows) {
      const serverIds = new Set(this.messages.map((m) => m.id));
      if (mergedMessages.every((m) => serverIds.has(m.id))) {
        const keepIds = new Set(mergedMessages.map((m) => m.id));
        const allDbRows =
          this.sql`
            select id from cf_ai_chat_agent_messages
          ` || [];
        for (const row of allDbRows)
          if (!keepIds.has(row.id)) {
            this.sql`
              delete from cf_ai_chat_agent_messages where id = ${row.id}
            `;
            this._persistedMessageCache.delete(row.id);
          }
      }
    }
    if (this.maxPersistedMessages != null) this._enforceMaxPersistedMessages();
    this.messages = autoTransformMessages(this._loadMessagesFromDb());
    this._broadcastChatMessage(
      {
        messages: mergedMessages,
        type: MessageType.CF_AGENT_CHAT_MESSAGES
      },
      excludeBroadcastIds
    );
  }
  /**
   * Merges incoming messages with existing server state.
   * This preserves tool outputs that the server has (via _applyToolResult)
   * but the client doesn't have yet.
   *
   * @param incomingMessages - Messages from the client
   * @returns Messages with server's tool outputs preserved
   */
  _mergeIncomingWithServerState(incomingMessages) {
    const serverToolOutputs = /* @__PURE__ */ new Map();
    for (const msg of this.messages) {
      if (msg.role !== "assistant") continue;
      for (const part of msg.parts)
        if (
          "toolCallId" in part &&
          "state" in part &&
          part.state === "output-available" &&
          "output" in part
        )
          serverToolOutputs.set(part.toolCallId, part.output);
    }
    const withMergedToolOutputs =
      serverToolOutputs.size === 0
        ? incomingMessages
        : incomingMessages.map((msg) => {
            if (msg.role !== "assistant") return msg;
            let hasChanges = false;
            const updatedParts = msg.parts.map((part) => {
              if (
                "toolCallId" in part &&
                "state" in part &&
                (part.state === "input-available" ||
                  part.state === "approval-requested" ||
                  part.state === "approval-responded") &&
                serverToolOutputs.has(part.toolCallId)
              ) {
                hasChanges = true;
                return {
                  ...part,
                  state: "output-available",
                  output: serverToolOutputs.get(part.toolCallId)
                };
              }
              return part;
            });
            return hasChanges
              ? {
                  ...msg,
                  parts: updatedParts
                }
              : msg;
          });
    return this._reconcileAssistantIdsWithServerState(withMergedToolOutputs);
  }
  /**
   * Reconciles assistant message IDs between incoming client state and server state.
   *
   * The client can keep a different local ID for an assistant message than the one
   * persisted on the server (e.g. optimistic/local IDs). When that full history is
   * sent back, persisting by ID alone creates duplicate assistant rows. To prevent
   * this, we reuse the server ID for assistant messages that match by content,
   * while leaving tool-call messages to _resolveMessageForToolMerge.
   *
   * Uses a two-pass approach:
   *  - Pass 1: resolve all exact-ID matches, claiming server indices.
   *  - Pass 2: content-based matching for remaining non-tool assistant messages,
   *    scanning only unclaimed server indices left-to-right.
   *
   * The two-pass design prevents exact-ID matches from advancing a cursor past
   * server messages that a later incoming message needs for content matching.
   * This fixes mismatches when two assistant messages have identical text
   * (e.g. "Sure", "I understand") — see #1008.
   */
  _reconcileAssistantIdsWithServerState(incomingMessages) {
    if (this.messages.length === 0) return incomingMessages;
    const claimedServerIndices = /* @__PURE__ */ new Set();
    const exactMatchMap = /* @__PURE__ */ new Map();
    for (let i = 0; i < incomingMessages.length; i++) {
      const serverIdx = this.messages.findIndex(
        (sm, si) =>
          !claimedServerIndices.has(si) && sm.id === incomingMessages[i].id
      );
      if (serverIdx !== -1) {
        claimedServerIndices.add(serverIdx);
        exactMatchMap.set(i, serverIdx);
      }
    }
    return incomingMessages.map((incomingMessage, incomingIdx) => {
      if (exactMatchMap.has(incomingIdx)) return incomingMessage;
      if (
        incomingMessage.role !== "assistant" ||
        this._hasToolCallPart(incomingMessage)
      )
        return incomingMessage;
      const incomingKey = this._assistantMessageContentKey(incomingMessage);
      if (!incomingKey) return incomingMessage;
      for (let i = 0; i < this.messages.length; i++) {
        if (claimedServerIndices.has(i)) continue;
        const serverMessage = this.messages[i];
        if (
          serverMessage.role !== "assistant" ||
          this._hasToolCallPart(serverMessage)
        )
          continue;
        if (this._assistantMessageContentKey(serverMessage) === incomingKey) {
          claimedServerIndices.add(i);
          return {
            ...incomingMessage,
            id: serverMessage.id
          };
        }
      }
      return incomingMessage;
    });
  }
  _hasToolCallPart(message) {
    return message.parts.some((part) => "toolCallId" in part);
  }
  _assistantMessageContentKey(message) {
    if (message.role !== "assistant") return;
    const sanitized = this._sanitizeMessageForPersistence(message);
    return JSON.stringify(sanitized.parts);
  }
  /**
   * Resolves a message for persistence, handling tool result merging.
   * If the message contains tool parts with output-available state, checks if there's
   * an existing message with the same toolCallId that should be updated instead of
   * creating a duplicate. This prevents the "Duplicate item found" error from OpenAI
   * when client-side tool results arrive in a new request.
   *
   * @param message - The message to potentially merge
   * @returns The message with the correct ID (either original or merged)
   */
  _resolveMessageForToolMerge(message) {
    if (message.role !== "assistant") return message;
    for (const part of message.parts)
      if (
        "toolCallId" in part &&
        "state" in part &&
        (part.state === "output-available" ||
          part.state === "output-error" ||
          part.state === "approval-responded" ||
          part.state === "approval-requested")
      ) {
        const toolCallId = part.toolCallId;
        const existingMessage = this._findMessageByToolCallId(toolCallId);
        if (existingMessage && existingMessage.id !== message.id)
          return {
            ...message,
            id: existingMessage.id
          };
      }
    return message;
  }
  /**
   * Finds an existing assistant message that contains a tool part with the given toolCallId.
   * Used to detect when a tool result should update an existing message rather than
   * creating a new one.
   *
   * @param toolCallId - The tool call ID to search for
   * @returns The existing message if found, undefined otherwise
   */
  _findMessageByToolCallId(toolCallId) {
    for (const msg of this.messages) {
      if (msg.role !== "assistant") continue;
      for (const part of msg.parts)
        if ("toolCallId" in part && part.toolCallId === toolCallId) return msg;
    }
  }
  /**
   * Sanitizes a message for persistence by removing ephemeral provider-specific
   * data that should not be stored or sent back in subsequent requests.
   *
   * Two-step process:
   *
   * 1. **Strip OpenAI ephemeral fields**: The AI SDK's @ai-sdk/openai provider
   *    (v2.0.x+) defaults to using OpenAI's Responses API which assigns unique
   *    itemIds and reasoningEncryptedContent to message parts. When persisted
   *    and sent back, OpenAI rejects duplicate itemIds.
   *
   * 2. **Filter truly empty reasoning parts**: After stripping, reasoning parts
   *    with no text and no remaining providerMetadata are removed. Parts that
   *    still carry providerMetadata (e.g. Anthropic's redacted_thinking blocks
   *    with providerMetadata.anthropic.redactedData) are preserved, as they
   *    contain data required for round-tripping with the provider API.
   *
   * @param message - The message to sanitize
   * @returns A new message with ephemeral provider data removed
   */
  _sanitizeMessageForPersistence(message) {
    const sanitizedParts = message.parts
      .map((part) => {
        let sanitizedPart = part;
        if (
          "providerMetadata" in sanitizedPart &&
          sanitizedPart.providerMetadata &&
          typeof sanitizedPart.providerMetadata === "object" &&
          "openai" in sanitizedPart.providerMetadata
        )
          sanitizedPart = this._stripOpenAIMetadata(
            sanitizedPart,
            "providerMetadata"
          );
        if (
          "callProviderMetadata" in sanitizedPart &&
          sanitizedPart.callProviderMetadata &&
          typeof sanitizedPart.callProviderMetadata === "object" &&
          "openai" in sanitizedPart.callProviderMetadata
        )
          sanitizedPart = this._stripOpenAIMetadata(
            sanitizedPart,
            "callProviderMetadata"
          );
        return sanitizedPart;
      })
      .filter((part) => {
        if (part.type === "reasoning") {
          const reasoningPart = part;
          if (!reasoningPart.text || reasoningPart.text.trim() === "") {
            if (
              "providerMetadata" in reasoningPart &&
              reasoningPart.providerMetadata &&
              typeof reasoningPart.providerMetadata === "object" &&
              Object.keys(reasoningPart.providerMetadata).length > 0
            )
              return true;
            return false;
          }
        }
        return true;
      });
    return {
      ...message,
      parts: sanitizedParts
    };
  }
  /**
   * Helper to strip OpenAI-specific ephemeral fields from a metadata object.
   * Removes itemId and reasoningEncryptedContent while preserving other fields.
   */
  _stripOpenAIMetadata(part, metadataKey) {
    const metadata = part[metadataKey];
    if (!metadata?.openai) return part;
    const {
      itemId: _itemId,
      reasoningEncryptedContent: _rec,
      ...restOpenai
    } = metadata.openai;
    const hasOtherOpenaiFields = Object.keys(restOpenai).length > 0;
    const { openai: _openai, ...restMetadata } = metadata;
    let newMetadata;
    if (hasOtherOpenaiFields)
      newMetadata = {
        ...restMetadata,
        openai: restOpenai
      };
    else if (Object.keys(restMetadata).length > 0) newMetadata = restMetadata;
    const { [metadataKey]: _oldMeta, ...restPart } = part;
    if (newMetadata)
      return {
        ...restPart,
        [metadataKey]: newMetadata
      };
    return restPart;
  }
  /**
   * Deletes oldest messages from SQLite when the count exceeds maxPersistedMessages.
   * Called after each persist to keep storage bounded.
   */
  _enforceMaxPersistedMessages() {
    if (this.maxPersistedMessages == null) return;
    const count =
      this.sql`
      select count(*) as cnt from cf_ai_chat_agent_messages
    `?.[0]?.cnt ?? 0;
    if (count <= this.maxPersistedMessages) return;
    const excess = count - this.maxPersistedMessages;
    const toDelete = this.sql`
      select id from cf_ai_chat_agent_messages 
      order by created_at asc 
      limit ${excess}
    `;
    if (toDelete && toDelete.length > 0)
      for (const row of toDelete) {
        this.sql`delete from cf_ai_chat_agent_messages where id = ${row.id}`;
        this._persistedMessageCache.delete(row.id);
      }
  }
  /**
   * Enforces SQLite row size limits by compacting tool outputs and text parts
   * when a serialized message exceeds the safety threshold (1.8MB).
   *
   * Only fires in pathological cases (extremely large tool outputs or text).
   * Returns the message unchanged if it fits within limits.
   *
   * Compaction strategy:
   * 1. Compact tool outputs over 1KB (replace with LLM-friendly summary)
   * 2. If still too big, truncate text parts from oldest to newest
   * 3. Add metadata so clients can detect compaction
   *
   * @param message - The message to check
   * @returns The message, compacted if necessary
   */
  _enforceRowSizeLimit(message) {
    let json = JSON.stringify(message);
    let size = AIChatAgent._byteLength(json);
    if (size <= AIChatAgent.ROW_MAX_BYTES) return message;
    if (message.role !== "assistant") {
      console.warn(
        `[AIChatAgent] Non-assistant message ${message.id} is ${size} bytes, exceeds row limit. Truncating text parts.`
      );
      return this._truncateTextParts(message);
    }
    console.warn(
      `[AIChatAgent] Message ${message.id} is ${size} bytes, compacting tool outputs to fit SQLite row limit`
    );
    const compactedToolCallIds = [];
    const compactedParts = message.parts.map((part) => {
      if (
        "output" in part &&
        "toolCallId" in part &&
        "state" in part &&
        part.state === "output-available"
      ) {
        const outputJson = JSON.stringify(part.output);
        if (outputJson.length > 1e3) {
          compactedToolCallIds.push(part.toolCallId);
          return {
            ...part,
            output: `This tool output was too large to persist in storage (${outputJson.length} bytes). If the user asks about this data, suggest re-running the tool. Preview: ${outputJson.slice(0, 500)}...`
          };
        }
      }
      return part;
    });
    let result = {
      ...message,
      parts: compactedParts
    };
    if (compactedToolCallIds.length > 0)
      result.metadata = {
        ...(result.metadata ?? {}),
        compactedToolOutputs: compactedToolCallIds
      };
    json = JSON.stringify(result);
    size = AIChatAgent._byteLength(json);
    if (size <= AIChatAgent.ROW_MAX_BYTES) return result;
    console.warn(
      `[AIChatAgent] Message ${message.id} still ${size} bytes after tool compaction, truncating text parts`
    );
    return this._truncateTextParts(result);
  }
  /**
   * Truncates text parts in a message to fit within the row size limit.
   * Truncates from the first text part forward, keeping the last text part
   * as intact as possible (it is usually the most relevant).
   */
  _truncateTextParts(message) {
    const compactedTextPartIndices = [];
    const parts = [...message.parts];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.type === "text" && "text" in part) {
        const text = part.text;
        if (text.length > 1e3) {
          compactedTextPartIndices.push(i);
          parts[i] = {
            ...part,
            text: `[Text truncated for storage (${text.length} chars). First 500 chars: ${text.slice(0, 500)}...]`
          };
          const candidate = {
            ...message,
            parts
          };
          if (
            AIChatAgent._byteLength(JSON.stringify(candidate)) <=
            AIChatAgent.ROW_MAX_BYTES
          )
            break;
        }
      }
    }
    const result = {
      ...message,
      parts
    };
    if (compactedTextPartIndices.length > 0)
      result.metadata = {
        ...(result.metadata ?? {}),
        compactedTextParts: compactedTextPartIndices
      };
    return result;
  }
  /**
   * Shared helper for finding a tool part by toolCallId and applying an update.
   * Handles both streaming (in-memory) and persisted (SQLite) messages.
   *
   * Checks _streamingMessage first (tool results/approvals can arrive while
   * the AI is still streaming), then retries persisted messages with backoff
   * in case streaming completes between attempts.
   *
   * @param toolCallId - The tool call ID to find
   * @param callerName - Name for log messages (e.g. "_applyToolResult")
   * @param matchStates - Which tool part states to match
   * @param applyUpdate - Mutation to apply to the matched part (streaming: in-place, persisted: spread)
   * @returns true if the update was applied, false if not found or state didn't match
   */
  async _findAndUpdateToolPart(
    toolCallId,
    callerName,
    matchStates,
    applyUpdate
  ) {
    let message;
    if (this._streamingMessage) {
      for (const part of this._streamingMessage.parts)
        if ("toolCallId" in part && part.toolCallId === toolCallId) {
          message = this._streamingMessage;
          break;
        }
    }
    if (!message)
      for (let attempt = 0; attempt < 10; attempt++) {
        message = this._findMessageByToolCallId(toolCallId);
        if (message) break;
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    if (!message) {
      console.warn(
        `[AIChatAgent] ${callerName}: Could not find message with toolCallId ${toolCallId} after retries`
      );
      return false;
    }
    const isStreamingMessage = message === this._streamingMessage;
    let updated = false;
    if (isStreamingMessage) {
      for (const part of message.parts)
        if (
          "toolCallId" in part &&
          part.toolCallId === toolCallId &&
          "state" in part &&
          matchStates.includes(part.state)
        ) {
          const applied = applyUpdate(part);
          Object.assign(part, applied);
          updated = true;
          break;
        }
    } else {
      const updatedParts = message.parts.map((part) => {
        if (
          "toolCallId" in part &&
          part.toolCallId === toolCallId &&
          "state" in part &&
          matchStates.includes(part.state)
        ) {
          updated = true;
          return applyUpdate(part);
        }
        return part;
      });
      if (updated) {
        const updatedMessage = this._sanitizeMessageForPersistence({
          ...message,
          parts: updatedParts
        });
        const safe = this._enforceRowSizeLimit(updatedMessage);
        const json = JSON.stringify(safe);
        this.sql`
          update cf_ai_chat_agent_messages 
          set message = ${json}
          where id = ${message.id}
        `;
        this._persistedMessageCache.set(message.id, json);
        this.messages = autoTransformMessages(this._loadMessagesFromDb());
      }
    }
    if (!updated) {
      console.warn(
        `[AIChatAgent] ${callerName}: Tool part with toolCallId ${toolCallId} not in expected state (expected: ${matchStates.join("|")})`
      );
      return false;
    }
    if (isStreamingMessage)
      this._broadcastChatMessage({
        type: MessageType.CF_AGENT_MESSAGE_UPDATED,
        message
      });
    else {
      const broadcastMessage = this._findMessageByToolCallId(toolCallId);
      if (broadcastMessage)
        this._broadcastChatMessage({
          type: MessageType.CF_AGENT_MESSAGE_UPDATED,
          message: broadcastMessage
        });
    }
    return true;
  }
  /**
   * Applies a tool result to an existing assistant message.
   * This is used when the client sends CF_AGENT_TOOL_RESULT for client-side tools.
   * The server is the source of truth, so we update the message here and broadcast
   * the update to all clients.
   *
   * @param toolCallId - The tool call ID this result is for
   * @param _toolName - The name of the tool (unused, kept for API compat)
   * @param output - The output from the tool execution
   * @param overrideState - Optional state override ("output-error" to signal denial/failure)
   * @param errorText - Error message when overrideState is "output-error"
   * @returns true if the result was applied, false if the message was not found
   */
  async _applyToolResult(
    toolCallId,
    _toolName,
    output,
    overrideState,
    errorText
  ) {
    return this._findAndUpdateToolPart(
      toolCallId,
      "_applyToolResult",
      ["input-available", "approval-requested", "approval-responded"],
      (part) => ({
        ...part,
        ...(overrideState === "output-error"
          ? {
              state: "output-error",
              errorText: errorText ?? "Tool execution denied by user"
            }
          : {
              state: "output-available",
              output,
              preliminary: false
            })
      })
    );
  }
  async _streamSSEReply(
    id,
    streamId,
    reader,
    message,
    streamCompleted,
    continuation = false,
    abortSignal
  ) {
    streamCompleted.value = false;
    if (abortSignal && !abortSignal.aborted)
      abortSignal.addEventListener(
        "abort",
        () => {
          reader.cancel().catch(() => {});
        },
        { once: true }
      );
    while (true) {
      if (abortSignal?.aborted) break;
      let readResult;
      try {
        readResult = await reader.read();
      } catch {
        break;
      }
      const { done, value } = readResult;
      if (done) {
        this._completeStream(streamId);
        streamCompleted.value = true;
        this._broadcastChatMessage({
          body: "",
          done: true,
          id,
          type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
          ...(continuation && { continuation: true })
        });
        break;
      }
      const lines = decoder.decode(value).split("\n");
      for (const line of lines)
        if (line.startsWith("data: ") && line !== "data: [DONE]")
          try {
            const data = JSON.parse(line.slice(6));
            const handled = applyChunkToParts(message.parts, data);
            if (
              data.type === "tool-approval-request" &&
              this._streamingMessage
            ) {
              const snapshot = {
                ...this._streamingMessage,
                parts: [...this._streamingMessage.parts]
              };
              const sanitized = this._sanitizeMessageForPersistence(snapshot);
              const json = JSON.stringify(sanitized);
              this.sql`
                INSERT INTO cf_ai_chat_agent_messages (id, message)
                VALUES (${sanitized.id}, ${json})
                ON CONFLICT(id) DO UPDATE SET message = excluded.message
              `;
              this._approvalPersistedMessageId = sanitized.id;
            }
            if (
              (data.type === "tool-output-available" ||
                data.type === "tool-output-error") &&
              data.toolCallId
            ) {
              if (
                !message.parts.some(
                  (p) => "toolCallId" in p && p.toolCallId === data.toolCallId
                )
              )
                if (data.type === "tool-output-available")
                  this._findAndUpdateToolPart(
                    data.toolCallId,
                    "_streamSSEReply",
                    [
                      "input-available",
                      "input-streaming",
                      "approval-responded",
                      "approval-requested"
                    ],
                    (part) => ({
                      ...part,
                      state: "output-available",
                      output: data.output,
                      ...(data.preliminary !== void 0 && {
                        preliminary: data.preliminary
                      })
                    })
                  );
                else
                  this._findAndUpdateToolPart(
                    data.toolCallId,
                    "_streamSSEReply",
                    [
                      "input-available",
                      "input-streaming",
                      "approval-responded",
                      "approval-requested"
                    ],
                    (part) => ({
                      ...part,
                      state: "output-error",
                      errorText: data.errorText
                    })
                  );
            }
            if (!handled)
              switch (data.type) {
                case "start":
                  if (data.messageId != null) message.id = data.messageId;
                  if (data.messageMetadata != null)
                    message.metadata = message.metadata
                      ? {
                          ...message.metadata,
                          ...data.messageMetadata
                        }
                      : data.messageMetadata;
                  break;
                case "finish":
                case "message-metadata":
                  if (data.messageMetadata != null)
                    message.metadata = message.metadata
                      ? {
                          ...message.metadata,
                          ...data.messageMetadata
                        }
                      : data.messageMetadata;
                  break;
                case "finish-step":
                  break;
                case "error":
                  this._broadcastChatMessage({
                    error: true,
                    body: data.errorText ?? JSON.stringify(data),
                    done: false,
                    id,
                    type: MessageType.CF_AGENT_USE_CHAT_RESPONSE
                  });
                  break;
              }
            let eventToSend = data;
            if (data.type === "finish" && "finishReason" in data) {
              const { finishReason, ...rest } = data;
              eventToSend = {
                ...rest,
                type: "finish",
                messageMetadata: { finishReason }
              };
            }
            const chunkBody = JSON.stringify(eventToSend);
            this._storeStreamChunk(streamId, chunkBody);
            this._broadcastChatMessage({
              body: chunkBody,
              done: false,
              id,
              type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
              ...(continuation && { continuation: true })
            });
          } catch (_error) {}
    }
    if (!streamCompleted.value) {
      console.warn(
        "[AIChatAgent] Stream was still active when cancel was received. Pass options.abortSignal to streamText() in your onChatMessage() to cancel the upstream LLM call and avoid wasted work."
      );
      this._completeStream(streamId);
      streamCompleted.value = true;
      this._broadcastChatMessage({
        body: "",
        done: true,
        id,
        type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
        ...(continuation && { continuation: true })
      });
    }
  }
  async _sendPlaintextReply(
    id,
    streamId,
    reader,
    message,
    streamCompleted,
    continuation = false,
    abortSignal
  ) {
    this._broadcastTextEvent(
      streamId,
      {
        type: "text-start",
        id
      },
      continuation
    );
    const textPart = {
      type: "text",
      text: "",
      state: "streaming"
    };
    message.parts.push(textPart);
    if (abortSignal && !abortSignal.aborted)
      abortSignal.addEventListener(
        "abort",
        () => {
          reader.cancel().catch(() => {});
        },
        { once: true }
      );
    while (true) {
      if (abortSignal?.aborted) break;
      let readResult;
      try {
        readResult = await reader.read();
      } catch {
        break;
      }
      const { done, value } = readResult;
      if (done) {
        textPart.state = "done";
        this._broadcastTextEvent(
          streamId,
          {
            type: "text-end",
            id
          },
          continuation
        );
        this._completeStream(streamId);
        streamCompleted.value = true;
        this._broadcastChatMessage({
          body: "",
          done: true,
          id,
          type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
          ...(continuation && { continuation: true })
        });
        break;
      }
      const chunk = decoder.decode(value);
      if (chunk.length > 0) {
        textPart.text += chunk;
        this._broadcastTextEvent(
          streamId,
          {
            type: "text-delta",
            id,
            delta: chunk
          },
          continuation
        );
      }
    }
    if (!streamCompleted.value) {
      console.warn(
        "[AIChatAgent] Stream was still active when cancel was received. Pass options.abortSignal to streamText() in your onChatMessage() to cancel the upstream LLM call and avoid wasted work."
      );
      textPart.state = "done";
      this._broadcastTextEvent(
        streamId,
        {
          type: "text-end",
          id
        },
        continuation
      );
      this._completeStream(streamId);
      streamCompleted.value = true;
      this._broadcastChatMessage({
        body: "",
        done: true,
        id,
        type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
        ...(continuation && { continuation: true })
      });
    }
  }
  /**
   * Applies a tool approval response from the client, updating the persisted message.
   * This is called when the client sends CF_AGENT_TOOL_APPROVAL for tools with needsApproval.
   *
   * - approved=true transitions to approval-responded
   * - approved=false transitions to output-denied so convertToModelMessages
   *   emits a tool_result for providers (e.g. Anthropic) that require it.
   *
   * @param toolCallId - The tool call ID this approval is for
   * @param approved - Whether the tool execution was approved
   * @returns true if the approval was applied, false if the message was not found
   */
  async _applyToolApproval(toolCallId, approved) {
    return this._findAndUpdateToolPart(
      toolCallId,
      "_applyToolApproval",
      ["input-available", "approval-requested"],
      (part) => ({
        ...part,
        state: approved ? "approval-responded" : "output-denied",
        approval: {
          ...part.approval,
          approved
        }
      })
    );
  }
  async _reply(id, response, excludeBroadcastIds = [], options = {}) {
    const { continuation = false, chatMessageId } = options;
    const abortSignal = chatMessageId
      ? this._chatMessageAbortControllers.get(chatMessageId)?.signal
      : void 0;
    return this.keepAliveWhile(() =>
      this._tryCatchChat(async () => {
        if (!response.body) {
          this._broadcastChatMessage({
            body: "",
            done: true,
            id,
            type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
            ...(continuation && { continuation: true })
          });
          return;
        }
        const streamId = this._startStream(id);
        const reader = response.body.getReader();
        const message = {
          id: `assistant_${Date.now()}_${Math.random().toString(36).slice(2, 11)}`,
          role: "assistant",
          parts: []
        };
        this._streamingMessage = message;
        this._streamCompletionPromise = new Promise((resolve) => {
          this._streamCompletionResolve = resolve;
        });
        const isSSE = (response.headers.get("content-type") || "").includes(
          "text/event-stream"
        );
        const streamCompleted = { value: false };
        let earlyPersistedId = null;
        try {
          if (isSSE)
            await this._streamSSEReply(
              id,
              streamId,
              reader,
              message,
              streamCompleted,
              continuation,
              abortSignal
            );
          else
            await this._sendPlaintextReply(
              id,
              streamId,
              reader,
              message,
              streamCompleted,
              continuation,
              abortSignal
            );
        } catch (error) {
          if (!streamCompleted.value) {
            this._markStreamError(streamId);
            this._broadcastChatMessage({
              body: error instanceof Error ? error.message : "Stream error",
              done: true,
              error: true,
              id,
              type: MessageType.CF_AGENT_USE_CHAT_RESPONSE,
              ...(continuation && { continuation: true })
            });
            this._emit("message:error", {
              error: error instanceof Error ? error.message : String(error)
            });
          }
          throw error;
        } finally {
          reader.releaseLock();
          this._streamingMessage = null;
          earlyPersistedId = this._approvalPersistedMessageId;
          this._approvalPersistedMessageId = null;
          if (this._streamCompletionResolve) {
            this._streamCompletionResolve();
            this._streamCompletionResolve = null;
            this._streamCompletionPromise = null;
          }
          if (chatMessageId) {
            this._removeAbortController(chatMessageId);
            if (streamCompleted.value) this._emit("message:response");
          }
        }
        if (message.parts.length > 0)
          if (earlyPersistedId) {
            const updatedMessages = this.messages.map((msg) =>
              msg.id === earlyPersistedId ? message : msg
            );
            await this.persistMessages(updatedMessages, excludeBroadcastIds);
          } else if (continuation) {
            let lastAssistantIdx = -1;
            for (let i = this.messages.length - 1; i >= 0; i--)
              if (this.messages[i].role === "assistant") {
                lastAssistantIdx = i;
                break;
              }
            if (lastAssistantIdx >= 0) {
              const lastAssistant = this.messages[lastAssistantIdx];
              const mergedMessage = {
                ...lastAssistant,
                parts: [...lastAssistant.parts, ...message.parts]
              };
              const updatedMessages = [...this.messages];
              updatedMessages[lastAssistantIdx] = mergedMessage;
              await this.persistMessages(updatedMessages, excludeBroadcastIds);
            } else
              await this.persistMessages(
                [...this.messages, message],
                excludeBroadcastIds
              );
          } else
            await this.persistMessages(
              [...this.messages, message],
              excludeBroadcastIds
            );
      })
    );
  }
  /**
   * For the given message id, look up its associated AbortController
   * If the AbortController does not exist, create and store one in memory
   *
   * returns the AbortSignal associated with the AbortController
   */
  _getAbortSignal(id) {
    if (typeof id !== "string") return;
    if (!this._chatMessageAbortControllers.has(id))
      this._chatMessageAbortControllers.set(id, new AbortController());
    return this._chatMessageAbortControllers.get(id)?.signal;
  }
  /**
   * Remove an abort controller from the cache of pending message responses
   */
  _removeAbortController(id) {
    this._chatMessageAbortControllers.delete(id);
  }
  /**
   * Propagate an abort signal for any requests associated with the given message id
   */
  _cancelChatRequest(id) {
    if (this._chatMessageAbortControllers.has(id))
      this._chatMessageAbortControllers.get(id)?.abort();
  }
  /**
   * Abort all pending requests and clear the cache of AbortControllers
   */
  _destroyAbortControllers() {
    for (const controller of this._chatMessageAbortControllers.values())
      controller?.abort();
    this._chatMessageAbortControllers.clear();
  }
  /**
   * When the DO is destroyed, cancel all pending requests and clean up resources
   */
  async destroy() {
    this._destroyAbortControllers();
    this._resumableStream.destroy();
    await super.destroy();
  }
};
//#endregion
export { AIChatAgent, createToolsFromClientSchemas };

//# sourceMappingURL=index.js.map
