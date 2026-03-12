import {
  JSONSchema7,
  StreamTextOnFinishCallback,
  Tool,
  ToolSet,
  UIMessage
} from "ai";
import { Agent, AgentContext, Connection } from "agents";

//#region src/resumable-stream.d.ts
/**
 * Minimal SQL interface matching Agent's this.sql tagged template.
 * Allows ResumableStream to work with the Agent's SQLite without
 * depending on the full Agent class.
 */
type SqlTaggedTemplate = {
  <T = Record<string, unknown>>(
    strings: TemplateStringsArray,
    ...values: (string | number | boolean | null)[]
  ): T[];
};
declare class ResumableStream {
  private sql;
  private _activeStreamId;
  private _activeRequestId;
  private _streamChunkIndex;
  /**
   * Whether the active stream was started in this instance (true) or
   * restored from SQLite after hibernation/restart (false). An orphaned
   * stream has no live LLM reader — the ReadableStream was lost when the
   * DO was evicted.
   */
  private _isLive;
  private _chunkBuffer;
  private _isFlushingChunks;
  private _lastCleanupTime;
  constructor(sql: SqlTaggedTemplate);
  get activeStreamId(): string | null;
  get activeRequestId(): string | null;
  hasActiveStream(): boolean;
  /**
   * Whether the active stream has a live LLM reader (started in this
   * instance) vs being restored from SQLite after hibernation (orphaned).
   */
  get isLive(): boolean;
  /**
   * Start tracking a new stream for resumable streaming.
   * Creates metadata entry in SQLite and sets up tracking state.
   * @param requestId - The unique ID of the chat request
   * @returns The generated stream ID
   */
  start(requestId: string): string;
  /**
   * Mark a stream as completed and flush any pending chunks.
   * @param streamId - The stream to mark as completed
   */
  complete(streamId: string): void;
  /**
   * Mark a stream as errored and clean up state.
   * @param streamId - The stream to mark as errored
   */
  markError(streamId: string): void;
  /** Maximum chunk body size before skipping storage (bytes). Prevents SQLite row limit crash. */
  private static CHUNK_MAX_BYTES;
  /**
   * Buffer a stream chunk for batch write to SQLite.
   * Chunks exceeding the row size limit are skipped to prevent crashes.
   * The chunk is still broadcast to live clients (caller handles that),
   * but will be missing from replay on reconnection.
   * @param streamId - The stream this chunk belongs to
   * @param body - The serialized chunk body
   */
  storeChunk(streamId: string, body: string): void;
  /**
   * Flush buffered chunks to SQLite in a single batch.
   * Uses a lock to prevent concurrent flush operations.
   */
  flushBuffer(): void;
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
  replayChunks(connection: Connection, requestId: string): string | null;
  /**
   * Restore active stream state if the agent was restarted during streaming.
   * Validates stream freshness to avoid sending stale resume notifications.
   */
  restore(): void;
  /**
   * Clear all stream data (called on chat history clear).
   */
  clearAll(): void;
  /**
   * Drop all stream tables (called on destroy).
   */
  destroy(): void;
  private _maybeCleanupOldStreams;
  /** @internal For testing only */
  getStreamChunks(streamId: string): Array<{
    body: string;
    chunk_index: number;
  }>;
  /** @internal For testing only */
  getStreamMetadata(streamId: string): {
    status: string;
    request_id: string;
  } | null;
  /** @internal For testing only */
  getAllStreamMetadata(): Array<{
    id: string;
    status: string;
    request_id: string;
    created_at: number;
  }>;
  /** @internal For testing only */
  insertStaleStream(streamId: string, requestId: string, ageMs: number): void;
}
//#endregion
//#region src/index.d.ts
/**
 * Schema for a client-defined tool sent from the browser.
 * These tools are executed on the client, not the server.
 *
 * **For most apps**, define tools on the server with `tool()` from `"ai"` —
 * you get full Zod type safety, server-side execution, and simpler code.
 * Use `onToolCall` in `useAgentChat` for tools that need client-side execution.
 *
 * **For SDKs and platforms** where the tool surface is determined dynamically
 * by the embedding application at runtime, client tool schemas let the
 * client register tools the server does not know about at deploy time.
 *
 * Note: Uses `parameters` (JSONSchema7) rather than AI SDK's `inputSchema`
 * because this is the wire format. Zod schemas cannot be serialized.
 */
type ClientToolSchema = {
  /** Unique name for the tool */ name: string /** Human-readable description of what the tool does */;
  description?: Tool["description"] /** JSON Schema defining the tool's input parameters */;
  parameters?: JSONSchema7;
};
/**
 * Options passed to the onChatMessage handler.
 */
type OnChatMessageOptions = {
  /**
   * Unique ID for this chat message exchange.
   *
   * For initial user messages this is the client-generated ID from the
   * `CF_AGENT_USE_CHAT_REQUEST` WebSocket frame. For tool continuations
   * (auto-continue after client tool results or approvals) this is a
   * server-generated ID.
   */
  requestId: string /** AbortSignal for cancelling the request */;
  abortSignal?: AbortSignal;
  /**
   * Tool schemas sent from the client for dynamic tool registration.
   * These represent tools that will be executed on the client side.
   * Use `createToolsFromClientSchemas()` to convert these to AI SDK tool format.
   *
   * **For most apps**, you do not need this — define tools on the server with
   * `tool()` from `"ai"` and use `onToolCall` for client-side execution.
   *
   * **For SDKs and platforms** where tools are defined dynamically by the
   * client at runtime and the server does not know the tool surface ahead
   * of time, this field carries the client-provided tool schemas.
   */
  clientTools?: ClientToolSchema[];
  /**
   * Custom body data sent from the client via `prepareSendMessagesRequest`
   * or the AI SDK's `body` option in `sendMessage`.
   *
   * Contains all fields from the request body except `messages` and `clientTools`,
   * which are handled separately.
   *
   * During tool continuations (auto-continue after client tool results), this
   * contains the body from the most recent chat request. The value is persisted
   * to SQLite so it survives Durable Object hibernation. It is cleared when the
   * chat is cleared via `CF_AGENT_CHAT_CLEAR`.
   */
  body?: Record<string, unknown>;
};
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
declare function createToolsFromClientSchemas(
  clientTools?: ClientToolSchema[]
): ToolSet;
/**
 * Extension of Agent with built-in chat capabilities
 * @template Env Environment type containing bindings
 */
declare class AIChatAgent<
  Env extends Cloudflare.Env = Cloudflare.Env,
  State = unknown
> extends Agent<Env, State> {
  /**
   * Map of message `id`s to `AbortController`s
   * useful to propagate request cancellation signals for any external calls made by the agent
   */
  private _chatMessageAbortControllers;
  /**
   * Resumable stream manager -- handles chunk buffering, persistence, and replay.
   * @internal Protected for testing purposes.
   */
  protected _resumableStream: ResumableStream;
  /**
   * The message currently being streamed. Used to apply tool results
   * before the message is persisted.
   * @internal
   */
  private _streamingMessage;
  /**
   * Tracks the ID of a streaming message that was persisted early due to
   * a tool entering approval-requested state. When set, stream completion
   * updates the existing persisted message instead of appending a new one.
   * @internal
   */
  private _approvalPersistedMessageId;
  /**
   * Promise that resolves when the current stream completes.
   * Used to wait for message persistence before continuing after tool results.
   * @internal
   */
  private _streamCompletionPromise;
  private _streamCompletionResolve;
  /**
   * Set of connection IDs that are pending stream resume.
   * These connections have received CF_AGENT_STREAM_RESUMING but haven't sent ACK yet.
   * They should be excluded from live stream broadcasts until they ACK.
   * @internal
   */
  private _pendingResumeConnections;
  /**
   * Client tool schemas from the most recent chat request.
   * Stored so they can be passed to onChatMessage during tool continuations.
   * @internal
   */
  private _lastClientTools;
  /**
   * Custom body data from the most recent chat request.
   * Stored so it can be passed to onChatMessage during tool continuations.
   * @internal
   */
  private _lastBody;
  /**
   * Cache of last-persisted JSON for each message ID.
   * Used for incremental persistence: skip SQL writes for unchanged messages.
   * Lost on hibernation, repopulated from SQLite on wake.
   * @internal
   */
  private _persistedMessageCache;
  /** Maximum serialized message size before compaction (bytes). 1.8MB with headroom below SQLite's 2MB limit. */
  private static ROW_MAX_BYTES;
  /** Measure UTF-8 byte length of a string (accurate for SQLite row limits). */
  private static _byteLength;
  /**
   * Maximum number of messages to keep in SQLite storage.
   * When the conversation exceeds this limit, oldest messages are deleted
   * after each persist. Set to `undefined` (default) for no limit.
   *
   * This controls storage only — it does not affect what's sent to the LLM.
   * Use `pruneMessages()` from the AI SDK in your `onChatMessage` to control
   * LLM context separately.
   *
   * @example
   * ```typescript
   * class MyAgent extends AIChatAgent<Env> {
   *   maxPersistedMessages = 100; // Keep last 100 messages in storage
   * }
   * ```
   */
  maxPersistedMessages: number | undefined;
  /**
   * When enabled, waits for all MCP server connections to be ready before
   * calling `onChatMessage`. This prevents the race condition where
   * `getAITools()` returns an incomplete set because connections are still
   * restoring after Durable Object hibernation.
   *
   * - `false` (default) — non-blocking; `onChatMessage` runs immediately.
   * - `true` — waits indefinitely for all connections to settle.
   * - `{ timeout: number }` — waits up to `timeout` milliseconds.
   *
   * For lower-level control, call `this.mcp.waitForConnections()` directly
   * inside your `onChatMessage` instead.
   *
   * @example
   * ```typescript
   * class MyAgent extends AIChatAgent<Env> {
   *   waitForMcpConnections = true;
   * }
   * ```
   *
   * @example
   * ```typescript
   * class MyAgent extends AIChatAgent<Env> {
   *   waitForMcpConnections = { timeout: 10_000 };
   * }
   * ```
   */
  waitForMcpConnections:
    | boolean
    | {
        timeout: number;
      };
  /** Array of chat messages for the current conversation */
  messages: UIMessage[];
  constructor(ctx: AgentContext, env: Env);
  /**
   * Notify a connection about an active stream that can be resumed.
   * The client should respond with CF_AGENT_STREAM_RESUME_ACK to receive chunks.
   * @param connection - The WebSocket connection to notify
   */
  private _notifyStreamResuming;
  /** @internal Delegate to _resumableStream */
  protected get _activeStreamId(): string | null;
  /** @internal Delegate to _resumableStream */
  protected get _activeRequestId(): string | null;
  /** @internal Delegate to _resumableStream */
  protected _startStream(requestId: string): string;
  /** @internal Delegate to _resumableStream */
  protected _completeStream(streamId: string): void;
  /** @internal Delegate to _resumableStream */
  protected _storeStreamChunk(streamId: string, body: string): void;
  /** @internal Delegate to _resumableStream */
  protected _flushChunkBuffer(): void;
  /** @internal Delegate to _resumableStream */
  protected _restoreActiveStream(): void;
  /** @internal Delegate to _resumableStream */
  protected _markStreamError(streamId: string): void;
  /**
   * Reconstruct and persist a partial assistant message from an orphaned
   * stream's stored chunks. Called when the DO wakes from hibernation and
   * discovers an active stream with no live LLM reader.
   *
   * Replays each chunk body through `applyChunkToParts` to rebuild the
   * message parts, then persists the result so it survives further refreshes.
   * @internal
   */
  private _persistOrphanedStream;
  /**
   * Restore _lastBody and _lastClientTools from SQLite.
   * Called in the constructor so these values survive DO hibernation.
   * @internal
   */
  private _restoreRequestContext;
  /**
   * Persist _lastBody and _lastClientTools to SQLite so they survive hibernation.
   * Uses upsert (INSERT OR REPLACE) so repeated calls are safe.
   * @internal
   */
  private _persistRequestContext;
  private _broadcastChatMessage;
  /**
   * Broadcasts a text event for non-SSE responses.
   * This ensures plain text responses follow the AI SDK v5 stream protocol.
   *
   * @param streamId - The stream identifier for chunk storage
   * @param event - The text event payload (text-start, text-delta with delta, or text-end)
   * @param continuation - Whether this is a continuation of a previous stream
   */
  private _broadcastTextEvent;
  private _loadMessagesFromDb;
  private _tryCatchChat;
  /**
   * Handle incoming chat messages and generate a response
   * @param onFinish Callback to be called when the response is finished
   * @param options Options including abort signal and client-defined tools
   * @returns Response to send to the client or undefined
   */
  onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: OnChatMessageOptions
  ): Promise<Response | undefined>;
  /**
   * Save messages on the server side
   * @param messages Chat messages to save
   */
  saveMessages(messages: UIMessage[]): Promise<void>;
  persistMessages(
    messages: UIMessage[],
    excludeBroadcastIds?: string[],
    /** @internal */ options?: {
      _deleteStaleRows?: boolean;
    }
  ): Promise<void>;
  /**
   * Merges incoming messages with existing server state.
   * This preserves tool outputs that the server has (via _applyToolResult)
   * but the client doesn't have yet.
   *
   * @param incomingMessages - Messages from the client
   * @returns Messages with server's tool outputs preserved
   */
  private _mergeIncomingWithServerState;
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
  private _reconcileAssistantIdsWithServerState;
  private _hasToolCallPart;
  private _assistantMessageContentKey;
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
  private _resolveMessageForToolMerge;
  /**
   * Finds an existing assistant message that contains a tool part with the given toolCallId.
   * Used to detect when a tool result should update an existing message rather than
   * creating a new one.
   *
   * @param toolCallId - The tool call ID to search for
   * @returns The existing message if found, undefined otherwise
   */
  private _findMessageByToolCallId;
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
  private _sanitizeMessageForPersistence;
  /**
   * Helper to strip OpenAI-specific ephemeral fields from a metadata object.
   * Removes itemId and reasoningEncryptedContent while preserving other fields.
   */
  private _stripOpenAIMetadata;
  /**
   * Deletes oldest messages from SQLite when the count exceeds maxPersistedMessages.
   * Called after each persist to keep storage bounded.
   */
  private _enforceMaxPersistedMessages;
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
  private _enforceRowSizeLimit;
  /**
   * Truncates text parts in a message to fit within the row size limit.
   * Truncates from the first text part forward, keeping the last text part
   * as intact as possible (it is usually the most relevant).
   */
  private _truncateTextParts;
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
  private _findAndUpdateToolPart;
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
  private _applyToolResult;
  private _streamSSEReply;
  private _sendPlaintextReply;
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
  private _applyToolApproval;
  private _reply;
  /**
   * For the given message id, look up its associated AbortController
   * If the AbortController does not exist, create and store one in memory
   *
   * returns the AbortSignal associated with the AbortController
   */
  private _getAbortSignal;
  /**
   * Remove an abort controller from the cache of pending message responses
   */
  private _removeAbortController;
  /**
   * Propagate an abort signal for any requests associated with the given message id
   */
  private _cancelChatRequest;
  /**
   * Abort all pending requests and clear the cache of AbortControllers
   */
  private _destroyAbortControllers;
  /**
   * When the DO is destroyed, cancel all pending requests and clean up resources
   */
  destroy(): Promise<void>;
}
//#endregion
export {
  createToolsFromClientSchemas as i,
  ClientToolSchema as n,
  OnChatMessageOptions as r,
  AIChatAgent as t
};
//# sourceMappingURL=index-O3HZiiYs.d.ts.map
