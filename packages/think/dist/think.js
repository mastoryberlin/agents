import { t as SessionManager } from "./session-C6ZU_1zM.js";
import { applyChunkToParts } from "./message-builder.js";
import {
  i as _classPrivateFieldInitSpec,
  n as _classPrivateFieldGet2,
  t as _classPrivateFieldSet2
} from "./classPrivateFieldSet2-COLddhya.js";
import {
  convertToModelMessages,
  pruneMessages,
  stepCountIs,
  streamText
} from "ai";
import { Agent, __DO_NOT_USE_WILL_BREAK__agentContext } from "agents";
import { withFibers } from "agents/experimental/forever";
//#region src/sanitize.ts
/** Shared encoder for UTF-8 byte length measurement */
const textEncoder = new TextEncoder();
/** Maximum serialized message size before compaction (bytes). 1.8MB with headroom below SQLite's 2MB limit. */
const ROW_MAX_BYTES = 18e5;
/** Measure UTF-8 byte length of a string. */
function byteLength(s) {
  return textEncoder.encode(s).byteLength;
}
/**
 * Sanitize a message for persistence by removing ephemeral provider-specific
 * data that should not be stored or sent back in subsequent requests.
 *
 * 1. Strips OpenAI ephemeral fields (itemId, reasoningEncryptedContent)
 * 2. Filters truly empty reasoning parts (no text, no remaining providerMetadata)
 */
function sanitizeMessage(message) {
  const sanitizedParts = message.parts
    .map((part) => {
      let sanitizedPart = part;
      if (
        "providerMetadata" in sanitizedPart &&
        sanitizedPart.providerMetadata &&
        typeof sanitizedPart.providerMetadata === "object" &&
        "openai" in sanitizedPart.providerMetadata
      )
        sanitizedPart = stripOpenAIMetadata(sanitizedPart, "providerMetadata");
      if (
        "callProviderMetadata" in sanitizedPart &&
        sanitizedPart.callProviderMetadata &&
        typeof sanitizedPart.callProviderMetadata === "object" &&
        "openai" in sanitizedPart.callProviderMetadata
      )
        sanitizedPart = stripOpenAIMetadata(
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
 * Strip OpenAI-specific ephemeral fields from a metadata object.
 */
function stripOpenAIMetadata(part, metadataKey) {
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
 * Enforce SQLite row size limits by compacting tool outputs and text parts
 * when a serialized message exceeds the safety threshold (1.8MB).
 *
 * Compaction strategy:
 * 1. Compact tool outputs over 1KB (replace with summary)
 * 2. If still too big, truncate text parts from oldest to newest
 */
function enforceRowSizeLimit(message) {
  let json = JSON.stringify(message);
  let size = byteLength(json);
  if (size <= ROW_MAX_BYTES) return message;
  if (message.role !== "assistant") return truncateTextParts(message);
  const compactedParts = message.parts.map((part) => {
    if (
      "output" in part &&
      "toolCallId" in part &&
      "state" in part &&
      part.state === "output-available"
    ) {
      const outputJson = JSON.stringify(part.output);
      if (outputJson.length > 1e3)
        return {
          ...part,
          output: `This tool output was too large to persist in storage (${outputJson.length} bytes). If the user asks about this data, suggest re-running the tool. Preview: ${outputJson.slice(0, 500)}...`
        };
    }
    return part;
  });
  let result = {
    ...message,
    parts: compactedParts
  };
  json = JSON.stringify(result);
  size = byteLength(json);
  if (size <= ROW_MAX_BYTES) return result;
  return truncateTextParts(result);
}
/**
 * Truncate text parts to fit within the row size limit.
 */
function truncateTextParts(message) {
  const parts = [...message.parts];
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (part.type === "text" && "text" in part) {
      const text = part.text;
      if (text.length > 1e3) {
        parts[i] = {
          ...part,
          text: `[Text truncated for storage (${text.length} chars). First 500 chars: ${text.slice(0, 500)}...]`
        };
        const candidate = {
          ...message,
          parts
        };
        if (byteLength(JSON.stringify(candidate)) <= ROW_MAX_BYTES) break;
      }
    }
  }
  return {
    ...message,
    parts
  };
}
//#endregion
//#region src/think.ts
const ThinkBase = withFibers(Agent);
const MSG_CHAT_MESSAGES = "cf_agent_chat_messages";
const MSG_CHAT_REQUEST = "cf_agent_use_chat_request";
const MSG_CHAT_RESPONSE = "cf_agent_use_chat_response";
const MSG_CHAT_CLEAR = "cf_agent_chat_clear";
const MSG_CHAT_CANCEL = "cf_agent_chat_request_cancel";
var _configTableReady = /* @__PURE__ */ new WeakMap();
var _configCache = /* @__PURE__ */ new WeakMap();
/**
 * A unified Agent base class for chat sessions.
 *
 * Works as both a top-level agent (WebSocket chat protocol) and a
 * sub-agent (RPC streaming via `chat()`).
 *
 * @experimental Requires the `"experimental"` compatibility flag.
 */
var Think = class extends ThinkBase {
  constructor(..._args) {
    super(..._args);
    this.messages = [];
    this.fibers = false;
    this.maxPersistedMessages = void 0;
    this._persistedMessageCache = /* @__PURE__ */ new Map();
    this._sessionId = null;
    this._abortControllers = /* @__PURE__ */ new Map();
    this._clearGeneration = 0;
    _classPrivateFieldInitSpec(this, _configTableReady, false);
    _classPrivateFieldInitSpec(this, _configCache, null);
  }
  _ensureConfigTable() {
    if (_classPrivateFieldGet2(_configTableReady, this)) return;
    this.sql`
      CREATE TABLE IF NOT EXISTS _think_config (
        key TEXT PRIMARY KEY, value TEXT NOT NULL
      )
    `;
    _classPrivateFieldSet2(_configTableReady, this, true);
  }
  /**
   * Persist a typed configuration object.
   * Stored in SQLite so it survives restarts and hibernation.
   */
  configure(config) {
    this._ensureConfigTable();
    const json = JSON.stringify(config);
    this.sql`
      INSERT OR REPLACE INTO _think_config (key, value) VALUES ('config', ${json})
    `;
    _classPrivateFieldSet2(_configCache, this, config);
  }
  /**
   * Read the persisted configuration, or null if never configured.
   */
  getConfig() {
    if (_classPrivateFieldGet2(_configCache, this))
      return _classPrivateFieldGet2(_configCache, this);
    this._ensureConfigTable();
    const rows = this.sql`
      SELECT value FROM _think_config WHERE key = 'config'
    `;
    if (rows.length > 0) {
      _classPrivateFieldSet2(_configCache, this, JSON.parse(rows[0].value));
      return _classPrivateFieldGet2(_configCache, this);
    }
    return null;
  }
  onStart() {
    this.sessions = new SessionManager(this, {
      exec: (query, ...values) => {
        this.ctx.storage.sql.exec(query, ...values);
      }
    });
    const existing = this.sessions.list();
    if (existing.length > 0) {
      this._sessionId = existing[0].id;
      this.messages = this.sessions.getHistory(this._sessionId);
      this._rebuildPersistenceCache();
    }
    this._setupProtocolHandlers();
    if (this.fibers) this.checkFibers();
  }
  /**
   * Return the language model to use for inference.
   * Must be overridden by subclasses that rely on the default
   * `onChatMessage` implementation (the agentic loop).
   */
  getModel() {
    throw new Error(
      "Override getModel() to return a LanguageModel, or override onChatMessage() for full control."
    );
  }
  /**
   * Return the system prompt for the assistant.
   * Override to customize instructions.
   */
  getSystemPrompt() {
    return "You are a helpful assistant.";
  }
  /**
   * Return the tools available to the assistant.
   * Override to provide workspace tools, custom tools, etc.
   */
  getTools() {
    return {};
  }
  /**
   * Return the maximum number of tool-call steps per turn.
   */
  getMaxSteps() {
    return 10;
  }
  /**
   * Return the workspace instance for this session, or null if none.
   *
   * Override in subclasses that create a Workspace. Used by
   * HostBridgeLoopback to provide workspace access to extension Workers.
   */
  getWorkspace() {
    return null;
  }
  async _hostReadFile(path) {
    const ws = this.getWorkspace();
    if (!ws) throw new Error("No workspace available on this agent");
    return ws.readFile(path);
  }
  async _hostWriteFile(path, content) {
    const ws = this.getWorkspace();
    if (!ws) throw new Error("No workspace available on this agent");
    await ws.writeFile(path, content);
  }
  async _hostDeleteFile(path) {
    const ws = this.getWorkspace();
    if (!ws) throw new Error("No workspace available on this agent");
    return ws.deleteFile(path);
  }
  _hostListFiles(dir) {
    const ws = this.getWorkspace();
    if (!ws) throw new Error("No workspace available on this agent");
    return ws.readDir(dir);
  }
  /**
   * Assemble the model messages from the current conversation history.
   * Override to customize context assembly (e.g. inject memory,
   * project context, or apply compaction).
   */
  async assembleContext() {
    return pruneMessages({
      messages: await convertToModelMessages(this.messages),
      toolCalls: "before-last-2-messages"
    });
  }
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
  async onChatMessage(options) {
    const baseTools = this.getTools();
    const tools = options?.tools
      ? {
          ...baseTools,
          ...options.tools
        }
      : baseTools;
    return streamText({
      model: this.getModel(),
      system: this.getSystemPrompt(),
      messages: await this.assembleContext(),
      tools,
      stopWhen: stepCountIs(this.getMaxSteps()),
      abortSignal: options?.signal
    });
  }
  /**
   * Handle an error that occurred during a chat turn.
   * Override to customize error handling (e.g. logging, metrics).
   *
   * @param error The error that occurred
   * @returns The error (or a wrapped version) to propagate
   */
  onChatError(error) {
    return error;
  }
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
  async chat(userMessage, callback, options) {
    if (!this._sessionId) this._sessionId = this.sessions.create("default").id;
    const userMsg =
      typeof userMessage === "string"
        ? {
            id: crypto.randomUUID(),
            role: "user",
            parts: [
              {
                type: "text",
                text: userMessage
              }
            ]
          }
        : userMessage;
    this.sessions.append(this._sessionId, userMsg);
    this.messages = this.sessions.getHistory(this._sessionId);
    const assistantMsg = {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: []
    };
    try {
      const result = await this.onChatMessage({
        signal: options?.signal,
        tools: options?.tools
      });
      let aborted = false;
      for await (const chunk of result.toUIMessageStream()) {
        if (options?.signal?.aborted) {
          aborted = true;
          break;
        }
        applyChunkToParts(assistantMsg.parts, chunk);
        await callback.onEvent(JSON.stringify(chunk));
      }
      this._persistAssistantMessage(assistantMsg);
      if (!aborted) await callback.onDone();
    } catch (error) {
      if (assistantMsg.parts.length > 0)
        this._persistAssistantMessage(assistantMsg);
      const wrapped = this.onChatError(error);
      const errorMessage =
        wrapped instanceof Error ? wrapped.message : String(wrapped);
      if (callback.onError) await callback.onError(errorMessage);
      else throw wrapped;
    }
  }
  getSessions() {
    return this.sessions.list();
  }
  createSession(name) {
    const session = this.sessions.create(name);
    this._sessionId = session.id;
    this.messages = [];
    this._broadcastMessages();
    return session;
  }
  switchSession(sessionId) {
    if (!this.sessions.get(sessionId))
      throw new Error(`Session not found: ${sessionId}`);
    this._sessionId = sessionId;
    this.messages = this.sessions.getHistory(sessionId);
    this._broadcastMessages();
    return this.messages;
  }
  deleteSession(sessionId) {
    if (!this.sessions.get(sessionId))
      throw new Error(`Session not found: ${sessionId}`);
    this.sessions.delete(sessionId);
    if (this._sessionId === sessionId) {
      this._sessionId = null;
      this.messages = [];
      this._broadcastMessages();
    }
  }
  renameSession(sessionId, name) {
    if (!this.sessions.get(sessionId))
      throw new Error(`Session not found: ${sessionId}`);
    this.sessions.rename(sessionId, name);
  }
  getCurrentSessionId() {
    return this._sessionId;
  }
  /**
   * Get the current session info, or null if no session exists yet.
   */
  getSession() {
    if (!this._sessionId) return null;
    return this.sessions.get(this._sessionId);
  }
  /**
   * Get the conversation history as UIMessage[].
   */
  getHistory() {
    if (!this._sessionId) return [];
    return this.sessions.getHistory(this._sessionId);
  }
  /**
   * Get the total message count for this session.
   */
  getMessageCount() {
    if (!this._sessionId) return 0;
    return this.sessions.getMessageCount(this._sessionId);
  }
  /**
   * Clear all messages from this session (preserves the session itself).
   */
  clearMessages() {
    if (!this._sessionId) return;
    this.sessions.clearMessages(this._sessionId);
    this.messages = [];
    this._persistedMessageCache.clear();
  }
  /**
   * Wrap onMessage and onRequest to intercept the chat protocol.
   * Unrecognized messages are forwarded to the user's handlers.
   * @internal
   */
  _setupProtocolHandlers() {
    const _onMessage = this.onMessage.bind(this);
    this.onMessage = async (connection, message) => {
      if (typeof message === "string")
        try {
          const data = JSON.parse(message);
          if (await this._handleProtocol(connection, data)) return;
        } catch {}
      return _onMessage(connection, message);
    };
    const _onRequest = this.onRequest.bind(this);
    this.onRequest = async (request) => {
      const url = new URL(request.url);
      if (
        url.pathname === "/get-messages" ||
        url.pathname.endsWith("/get-messages")
      ) {
        const sessionId = url.searchParams.get("sessionId");
        if (sessionId) {
          if (!this.sessions.get(sessionId))
            return Response.json(
              { error: "Session not found" },
              { status: 404 }
            );
          return Response.json(this.sessions.getHistory(sessionId));
        }
        return Response.json(this.messages);
      }
      return _onRequest(request);
    };
  }
  /**
   * Route an incoming WebSocket message to the appropriate handler.
   * Returns true if the message was handled by the protocol.
   * @internal
   */
  async _handleProtocol(connection, data) {
    const type = data.type;
    if (type === MSG_CHAT_REQUEST) {
      if (data.init?.method === "POST") {
        await this._handleChatRequest(connection, data);
        return true;
      }
    }
    if (type === MSG_CHAT_CLEAR) {
      this._handleClear();
      return true;
    }
    if (type === MSG_CHAT_CANCEL) {
      this._handleCancel(data.id);
      return true;
    }
    return false;
  }
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
  async _handleChatRequest(connection, data) {
    const init = data.init;
    if (!init?.body) return;
    let parsed;
    try {
      parsed = JSON.parse(init.body);
    } catch {
      return;
    }
    const incomingMessages = parsed.messages;
    if (!Array.isArray(incomingMessages)) return;
    if (!this._sessionId) this._sessionId = this.sessions.create("New Chat").id;
    this.sessions.appendAll(this._sessionId, incomingMessages);
    this.messages = this.sessions.getHistory(this._sessionId);
    this._broadcastMessages([connection.id]);
    const requestId = data.id;
    const abortController = new AbortController();
    this._abortControllers.set(requestId, abortController);
    try {
      await this.keepAliveWhile(async () => {
        const result = await __DO_NOT_USE_WILL_BREAK__agentContext.run(
          {
            agent: this,
            connection,
            request: void 0,
            email: void 0
          },
          () => this.onChatMessage({ signal: abortController.signal })
        );
        if (result)
          await this._streamResult(requestId, result, abortController.signal);
        else
          this._broadcast({
            type: MSG_CHAT_RESPONSE,
            id: requestId,
            body: "No response was generated.",
            done: true
          });
      });
    } catch (error) {
      this._broadcast({
        type: MSG_CHAT_RESPONSE,
        id: requestId,
        body: error instanceof Error ? error.message : "Error",
        done: true,
        error: true
      });
    } finally {
      this._abortControllers.delete(requestId);
    }
  }
  /**
   * Handle CF_AGENT_CHAT_CLEAR: abort streams, clear current session messages.
   * @internal
   */
  _handleClear() {
    for (const controller of this._abortControllers.values())
      controller.abort();
    this._abortControllers.clear();
    if (this._sessionId) this.sessions.clearMessages(this._sessionId);
    this.messages = [];
    this._persistedMessageCache.clear();
    this._clearGeneration++;
    this._broadcast({ type: MSG_CHAT_CLEAR });
  }
  /**
   * Handle CF_AGENT_CHAT_REQUEST_CANCEL: abort a specific request.
   * @internal
   */
  _handleCancel(requestId) {
    const controller = this._abortControllers.get(requestId);
    if (controller) controller.abort();
  }
  /**
   * Iterate a StreamableResult, broadcast chunks to clients,
   * build a UIMessage, and persist it to the session.
   * @internal
   */
  async _streamResult(requestId, result, abortSignal) {
    const clearGen = this._clearGeneration;
    const message = {
      id: crypto.randomUUID(),
      role: "assistant",
      parts: []
    };
    let doneSent = false;
    try {
      for await (const chunk of result.toUIMessageStream()) {
        if (abortSignal?.aborted) break;
        const data = chunk;
        if (!applyChunkToParts(message.parts, data))
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
            case "error":
              this._broadcast({
                type: MSG_CHAT_RESPONSE,
                id: requestId,
                body: data.errorText ?? JSON.stringify(data),
                done: false,
                error: true
              });
              continue;
          }
        this._broadcast({
          type: MSG_CHAT_RESPONSE,
          id: requestId,
          body: JSON.stringify(chunk),
          done: false
        });
      }
      this._broadcast({
        type: MSG_CHAT_RESPONSE,
        id: requestId,
        body: "",
        done: true
      });
      doneSent = true;
    } catch (error) {
      if (!doneSent) {
        this._broadcast({
          type: MSG_CHAT_RESPONSE,
          id: requestId,
          body: error instanceof Error ? error.message : "Stream error",
          done: true,
          error: true
        });
        doneSent = true;
      }
    } finally {
      if (!doneSent)
        this._broadcast({
          type: MSG_CHAT_RESPONSE,
          id: requestId,
          body: "",
          done: true
        });
    }
    if (
      message.parts.length > 0 &&
      this._sessionId &&
      this._clearGeneration === clearGen
    )
      try {
        this._persistAssistantMessage(message);
        this._broadcastMessages();
      } catch (e) {
        console.error("Failed to persist assistant message:", e);
      }
  }
  /**
   * Persist an assistant message with sanitization, size enforcement,
   * and incremental persistence.
   * @internal
   */
  _persistAssistantMessage(msg) {
    if (!this._sessionId) return;
    const safe = enforceRowSizeLimit(sanitizeMessage(msg));
    const json = JSON.stringify(safe);
    if (this._persistedMessageCache.get(safe.id) !== json) {
      this.sessions.upsert(this._sessionId, safe);
      this._persistedMessageCache.set(safe.id, json);
    }
    if (this.maxPersistedMessages != null) this._enforceMaxPersistedMessages();
    this.messages = this.sessions.getHistory(this._sessionId);
  }
  /**
   * Rebuild the persistence cache from current messages.
   * Called on startup to enable incremental persistence.
   * @internal
   */
  _rebuildPersistenceCache() {
    this._persistedMessageCache.clear();
    for (const msg of this.messages)
      this._persistedMessageCache.set(msg.id, JSON.stringify(msg));
  }
  /**
   * Delete oldest messages on the current branch when count exceeds
   * maxPersistedMessages. Uses path-based count (not total across all
   * branches) and individual deletes to preserve branch structure.
   * @internal
   */
  _enforceMaxPersistedMessages() {
    if (this.maxPersistedMessages == null || !this._sessionId) return;
    const history = this.sessions.getHistory(this._sessionId);
    if (history.length <= this.maxPersistedMessages) return;
    const excess = history.length - this.maxPersistedMessages;
    const toRemove = history.slice(0, excess);
    this.sessions.deleteMessages(toRemove.map((m) => m.id));
    for (const msg of toRemove) this._persistedMessageCache.delete(msg.id);
  }
  /**
   * Broadcast a JSON message to all connected clients.
   * @internal
   */
  _broadcast(message, exclude) {
    this.broadcast(JSON.stringify(message), exclude);
  }
  /**
   * Broadcast the current message list to all connected clients.
   * @internal
   */
  _broadcastMessages(exclude) {
    this._broadcast(
      {
        type: MSG_CHAT_MESSAGES,
        messages: this.messages
      },
      exclude
    );
  }
};
//#endregion
export { Think };

//# sourceMappingURL=think.js.map
