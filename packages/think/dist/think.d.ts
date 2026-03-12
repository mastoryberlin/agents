import { l as Session, t as SessionManager } from "./index-C4OTSwUW.js";
import { LanguageModel, ModelMessage, ToolSet, UIMessage } from "ai";
import { Agent } from "agents";
import {
  FiberCompleteContext,
  FiberContext,
  FiberMethods,
  FiberMethods as FiberMethods$1,
  FiberRecoveryContext,
  FiberState
} from "agents/experimental/forever";
import { Workspace } from "agents/experimental/workspace";

//#region src/think.d.ts
type ThinkBaseConstructor = {
  new <
    Env extends Cloudflare.Env = Cloudflare.Env,
    State = unknown,
    Props extends Record<string, unknown> = Record<string, unknown>
  >(
    ctx: DurableObjectState,
    env: Env
  ): Agent<Env, State, Props> & FiberMethods$1;
};
/**
 * Callback interface for streaming chat events from a Think.
 *
 * Designed to work across the sub-agent RPC boundary — implement as
 * an RpcTarget in the parent agent and pass to `chat()`.
 *
 * Methods may return a Promise for async RPC callbacks.
 */
interface StreamCallback {
  /** Called for each UIMessageChunk event during streaming. */
  onEvent(json: string): void | Promise<void>;
  /** Called when the stream completes successfully (not called on abort). */
  onDone(): void | Promise<void>;
  /** Called when an error occurs during streaming. */
  onError?(error: string): void | Promise<void>;
}
/**
 * Minimal interface for the result of `onChatMessage()`.
 * Must provide a `toUIMessageStream()` method that returns an
 * async-iterable stream of UI message chunks.
 *
 * The AI SDK's `streamText()` result satisfies this interface.
 */
interface StreamableResult {
  toUIMessageStream(): AsyncIterable<unknown>;
}
/**
 * Options for a chat turn (sub-agent RPC entry point).
 */
interface ChatOptions {
  /** AbortSignal — fires when the caller wants to cancel the turn. */
  signal?: AbortSignal;
  /** Extra tools to merge with getTools() for this turn only. */
  tools?: ToolSet;
}
/**
 * Options passed to the onChatMessage handler.
 */
interface ChatMessageOptions {
  /** AbortSignal for cancelling the request */
  signal?: AbortSignal;
  /** Extra tools to merge with getTools() for this turn only. */
  tools?: ToolSet;
}
declare const Think_base: ThinkBaseConstructor;
/**
 * A unified Agent base class for chat sessions.
 *
 * Works as both a top-level agent (WebSocket chat protocol) and a
 * sub-agent (RPC streaming via `chat()`).
 *
 * @experimental Requires the `"experimental"` compatibility flag.
 */
declare class Think<
  Env extends Cloudflare.Env = Cloudflare.Env,
  Config = Record<string, unknown>
> extends Think_base<Env> {
  #private;
  /** Session manager — persistence layer with branching and compaction. */
  sessions: SessionManager;
  /** In-memory messages for the current conversation. Authoritative after load. */
  messages: UIMessage[];
  /**
   * Enable durable fiber recovery on start. Set to `true` to
   * automatically recover interrupted fibers when the DO restarts.
   *
   * Fiber methods (`spawnFiber()`, `stashFiber()`, etc.) are always
   * available — this flag only controls automatic recovery.
   *
   * @experimental
   */
  fibers: boolean;
  /**
   * Maximum number of messages to keep in storage per session.
   * When exceeded, oldest messages are deleted after each persist.
   * Set to `undefined` (default) for no limit.
   *
   * This controls storage only — it does not affect what's sent to the LLM.
   * Use `pruneMessages()` in `assembleContext()` to control LLM context.
   */
  maxPersistedMessages: number | undefined;
  /**
   * Cache of last-persisted JSON for each message ID.
   * Used for incremental persistence: skip SQL writes for unchanged messages.
   * @internal
   */
  private _persistedMessageCache;
  private _sessionId;
  private _abortControllers;
  private _clearGeneration;
  private _ensureConfigTable;
  /**
   * Persist a typed configuration object.
   * Stored in SQLite so it survives restarts and hibernation.
   */
  configure(config: Config): void;
  /**
   * Read the persisted configuration, or null if never configured.
   */
  getConfig(): Config | null;
  onStart(): void;
  /**
   * Return the language model to use for inference.
   * Must be overridden by subclasses that rely on the default
   * `onChatMessage` implementation (the agentic loop).
   */
  getModel(): LanguageModel;
  /**
   * Return the system prompt for the assistant.
   * Override to customize instructions.
   */
  getSystemPrompt(): string;
  /**
   * Return the tools available to the assistant.
   * Override to provide workspace tools, custom tools, etc.
   */
  getTools(): ToolSet;
  /**
   * Return the maximum number of tool-call steps per turn.
   */
  getMaxSteps(): number;
  /**
   * Return the workspace instance for this session, or null if none.
   *
   * Override in subclasses that create a Workspace. Used by
   * HostBridgeLoopback to provide workspace access to extension Workers.
   */
  getWorkspace(): Workspace | null;
  _hostReadFile(path: string): Promise<string | null>;
  _hostWriteFile(path: string, content: string): Promise<void>;
  _hostDeleteFile(path: string): Promise<boolean>;
  _hostListFiles(dir: string): Array<{
    name: string;
    type: string;
    size: number;
    path: string;
  }>;
  /**
   * Assemble the model messages from the current conversation history.
   * Override to customize context assembly (e.g. inject memory,
   * project context, or apply compaction).
   */
  assembleContext(): Promise<ModelMessage[]>;
  /**
   * Handle a chat turn and return the streaming result.
   *
   * The default implementation runs the agentic loop:
   * 1. Assemble context from `this.messages`
   * 2. Call `streamText` with the model, system prompt, tools, and step limit
   *
   * Override for full control over inference (e.g. different models per turn,
   * RAG pipelines, routing to specialized sub-agents, etc.).
   *
   * When this is called, `this.messages` already contains the user's
   * latest message persisted to the current session.
   *
   * @returns A result with `toUIMessageStream()` — AI SDK's `streamText()`
   *          return value satisfies this interface.
   */
  onChatMessage(options?: ChatMessageOptions): Promise<StreamableResult>;
  /**
   * Handle an error that occurred during a chat turn.
   * Override to customize error handling (e.g. logging, metrics).
   *
   * @param error The error that occurred
   * @returns The error (or a wrapped version) to propagate
   */
  onChatError(error: unknown): unknown;
  /**
   * Run a chat turn: persist the user message, run the agentic loop,
   * stream UIMessageChunk events via callback, and persist the
   * assistant's response.
   *
   * On error or abort, the partial assistant message is still persisted
   * so the user doesn't lose context.
   *
   * @param userMessage The user's message (string or UIMessage for multi-modal)
   * @param callback Streaming callback (typically an RpcTarget from the parent)
   * @param options Optional chat options (e.g. AbortSignal)
   */
  chat(
    userMessage: string | UIMessage,
    callback: StreamCallback,
    options?: ChatOptions
  ): Promise<void>;
  getSessions(): Session[];
  createSession(name: string): Session;
  switchSession(sessionId: string): UIMessage[];
  deleteSession(sessionId: string): void;
  renameSession(sessionId: string, name: string): void;
  getCurrentSessionId(): string | null;
  /**
   * Get the current session info, or null if no session exists yet.
   */
  getSession(): Session | null;
  /**
   * Get the conversation history as UIMessage[].
   */
  getHistory(): UIMessage[];
  /**
   * Get the total message count for this session.
   */
  getMessageCount(): number;
  /**
   * Clear all messages from this session (preserves the session itself).
   */
  clearMessages(): void;
  /**
   * Wrap onMessage and onRequest to intercept the chat protocol.
   * Unrecognized messages are forwarded to the user's handlers.
   * @internal
   */
  private _setupProtocolHandlers;
  /**
   * Route an incoming WebSocket message to the appropriate handler.
   * Returns true if the message was handled by the protocol.
   * @internal
   */
  private _handleProtocol;
  /**
   * Handle CF_AGENT_USE_CHAT_REQUEST:
   * 1. Parse incoming messages
   * 2. Ensure a session exists
   * 3. Persist user messages to session
   * 4. Call onChatMessage
   * 5. Stream response back to clients
   * 6. Persist assistant message to session
   * @internal
   */
  private _handleChatRequest;
  /**
   * Handle CF_AGENT_CHAT_CLEAR: abort streams, clear current session messages.
   * @internal
   */
  private _handleClear;
  /**
   * Handle CF_AGENT_CHAT_REQUEST_CANCEL: abort a specific request.
   * @internal
   */
  private _handleCancel;
  /**
   * Iterate a StreamableResult, broadcast chunks to clients,
   * build a UIMessage, and persist it to the session.
   * @internal
   */
  private _streamResult;
  /**
   * Persist an assistant message with sanitization, size enforcement,
   * and incremental persistence.
   * @internal
   */
  private _persistAssistantMessage;
  /**
   * Rebuild the persistence cache from current messages.
   * Called on startup to enable incremental persistence.
   * @internal
   */
  private _rebuildPersistenceCache;
  /**
   * Delete oldest messages on the current branch when count exceeds
   * maxPersistedMessages. Uses path-based count (not total across all
   * branches) and individual deletes to preserve branch structure.
   * @internal
   */
  private _enforceMaxPersistedMessages;
  /**
   * Broadcast a JSON message to all connected clients.
   * @internal
   */
  private _broadcast;
  /**
   * Broadcast the current message list to all connected clients.
   * @internal
   */
  private _broadcastMessages;
}
//#endregion
export {
  ChatMessageOptions,
  ChatOptions,
  type FiberCompleteContext,
  type FiberContext,
  type FiberMethods,
  type FiberRecoveryContext,
  type FiberState,
  type Session,
  StreamCallback,
  StreamableResult,
  Think
};
//# sourceMappingURL=think.d.ts.map
