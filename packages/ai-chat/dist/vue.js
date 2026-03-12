import { MessageType } from "./types.js";
import { t as applyChunkToParts } from "./message-builder-BAgcFJMf.js";
import {
  i as WebSocketChatTransport,
  n as extractClientToolSchemas
} from "./react-B1UeE8Vh.js";
import { getToolName, isToolUIPart } from "ai";
import { nanoid } from "nanoid";
import { Chat } from "@ai-sdk/vue";
import {
  computed,
  onBeforeUnmount,
  ref,
  shallowRef,
  watch,
  watchEffect
} from "vue";
//#region src/vue.ts
/**
 * One-shot deprecation warnings (warns once per key per session).
 */
const _deprecationWarnings = /* @__PURE__ */ new Set();
function warnDeprecated(id, message) {
  if (!_deprecationWarnings.has(id)) {
    _deprecationWarnings.add(id);
    console.warn(`[@cloudflare/ai-chat] Deprecated: ${message}`);
  }
}
/**
 * Module-level cache for initial message fetches. Intentionally shared across
 * all useAgentChat instances to deduplicate requests during React Strict Mode
 * double-renders and re-renders. Cache keys include the agent URL, agent type,
 * and thread name to prevent cross-agent collisions.
 */
const requestCache = /* @__PURE__ */ new Map();
/**
 * Vue 3 composable for building AI chat interfaces using an Agent
 * @param options Chat options including the agent connection
 * @returns Chat interface controls and state with added clearHistory method
 */
function useAgentChat(options) {
  const {
    agent,
    getInitialMessages,
    messages: optionsInitialMessages,
    onToolCall,
    onData,
    experimental_automaticToolResolution,
    tools,
    toolsRequiringConfirmation: manualToolsRequiringConfirmation,
    autoContinueAfterToolResult = true,
    autoSendAfterAllConfirmationsResolved = true,
    resume = true,
    body: bodyOption,
    prepareSendMessagesRequest,
    ...rest
  } = options;
  if (manualToolsRequiringConfirmation)
    warnDeprecated(
      "useAgentChat.toolsRequiringConfirmation",
      "The 'toolsRequiringConfirmation' option is deprecated. Use needsApproval on server-side tools instead."
    );
  if (experimental_automaticToolResolution)
    warnDeprecated(
      "useAgentChat.experimental_automaticToolResolution",
      "The 'experimental_automaticToolResolution' option is deprecated. Use the onToolCall callback instead."
    );
  if (options.autoSendAfterAllConfirmationsResolved !== void 0)
    warnDeprecated(
      "useAgentChat.autoSendAfterAllConfirmationsResolved",
      "The 'autoSendAfterAllConfirmationsResolved' option is deprecated. Use sendAutomaticallyWhen from AI SDK instead."
    );
  const processedToolCalls = ref(/* @__PURE__ */ new Set());
  const isResolvingTools = ref(false);
  const toolResolutionTrigger = ref(0);
  const clientToolResults = ref(/* @__PURE__ */ new Map());
  const localRequestIds = ref(/* @__PURE__ */ new Set());
  const activeStream = shallowRef(null);
  const toolsRequiringConfirmation = computed(() => {
    if (manualToolsRequiringConfirmation)
      return manualToolsRequiringConfirmation;
    if (!tools) return [];
    return Object.entries(tools)
      .filter(([_name, tool]) => !tool.execute)
      .map(([name]) => name);
  });
  const agentUrl = computed(() => {
    const url = new URL(
      `${(agent._url || agent._pkurl)?.replace("ws://", "http://").replace("wss://", "https://")}`
    );
    url.searchParams.delete("_pk");
    return url.toString();
  });
  const initialMessagesCacheKey = computed(
    () => `${agentUrl.value}|${agent.agent ?? ""}|${agent.name ?? ""}`
  );
  async function defaultGetInitialMessagesFetch({ url }) {
    const getMessagesUrl = new URL(url);
    getMessagesUrl.pathname += "/get-messages";
    const response = await fetch(getMessagesUrl.toString(), {
      credentials: options.credentials,
      headers: options.headers
    });
    if (!response.ok) {
      console.warn(
        `Failed to fetch initial messages: ${response.status} ${response.statusText}`
      );
      return [];
    }
    const text = await response.text();
    if (!text.trim()) return [];
    try {
      return JSON.parse(text);
    } catch (error) {
      console.warn("Failed to parse initial messages JSON:", error);
      return [];
    }
  }
  const getInitialMessagesFetch =
    getInitialMessages || defaultGetInitialMessagesFetch;
  function doGetInitialMessages(getInitialMessagesOptions, cacheKey) {
    if (requestCache.has(cacheKey)) return requestCache.get(cacheKey);
    const promise = getInitialMessagesFetch(getInitialMessagesOptions);
    requestCache.set(cacheKey, promise);
    return promise;
  }
  const initialMessagesPromise = ref(
    getInitialMessages === null
      ? null
      : doGetInitialMessages(
          {
            agent: agent.agent,
            name: agent.name,
            url: agentUrl.value
          },
          initialMessagesCacheKey.value
        )
  );
  const initialMessages = ref(optionsInitialMessages ?? []);
  if (initialMessagesPromise.value)
    initialMessagesPromise.value.then((messages) => {
      initialMessages.value = messages;
      if (chatInstance) chatInstance.messages = messages;
    });
  let customTransport = null;
  if (!customTransport)
    customTransport = new WebSocketChatTransport({
      agent,
      activeRequestIds: localRequestIds.value,
      prepareBody: async ({ messages: msgs, trigger, messageId }) => {
        let extraBody = {};
        if (bodyOption)
          extraBody = {
            ...(typeof bodyOption === "function"
              ? await bodyOption()
              : bodyOption)
          };
        if (tools) {
          const clientToolSchemas = extractClientToolSchemas(tools);
          if (clientToolSchemas) extraBody.clientTools = clientToolSchemas;
        }
        if (prepareSendMessagesRequest) {
          const userResult = await prepareSendMessagesRequest({
            id: agent._pk,
            messages: msgs,
            trigger,
            messageId
          });
          if (userResult.body) Object.assign(extraBody, userResult.body);
        }
        return extraBody;
      }
    });
  watchEffect(() => {
    if (customTransport) customTransport.agent = agent;
  });
  const chatInstance = new Chat({
    ...rest,
    onData,
    messages: initialMessages.value,
    transport: customTransport,
    id: initialMessagesCacheKey.value,
    resume
  });
  const chatMessages = computed(() => chatInstance.messages);
  const status = computed(() => chatInstance.status);
  const error = computed(() => chatInstance.error);
  const sendMessage = async (text) => {
    if (text !== void 0) return await chatInstance.sendMessage({ text });
    return await chatInstance.sendMessage();
  };
  const setMessages = (messages) => {
    if (typeof messages === "function")
      chatInstance.messages = messages(chatInstance.messages);
    else chatInstance.messages = messages;
  };
  const addToolResult = async (args) => {
    return await chatInstance.addToolResult(args);
  };
  const addToolApprovalResponse = (args) => {
    return chatInstance.addToolApprovalResponse(args);
  };
  const regenerate = async () => {
    return await chatInstance.regenerate();
  };
  const stop = () => {
    chatInstance.stop();
  };
  const pendingConfirmations = computed(() => {
    const messages = chatMessages.value;
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== "assistant")
      return {
        messageId: void 0,
        toolCallIds: /* @__PURE__ */ new Set()
      };
    const pendingIds = /* @__PURE__ */ new Set();
    for (const part of lastMessage.parts ?? [])
      if (
        isToolUIPart(part) &&
        part.state === "input-available" &&
        toolsRequiringConfirmation.value.includes(getToolName(part))
      )
        pendingIds.add(part.toolCallId);
    return {
      messageId: lastMessage.id,
      toolCallIds: pendingIds
    };
  });
  const sendToolOutputToServer = (
    toolCallId,
    toolName,
    output,
    state,
    errorText
  ) => {
    agent.send(
      JSON.stringify({
        type: MessageType.CF_AGENT_TOOL_RESULT,
        toolCallId,
        toolName,
        output,
        ...(state ? { state } : {}),
        ...(errorText !== void 0 ? { errorText } : {}),
        autoContinue:
          state === "output-error" ? false : autoContinueAfterToolResult,
        clientTools: tools ? extractClientToolSchemas(tools) : void 0
      })
    );
    if (state !== "output-error")
      clientToolResults.value = new Map(clientToolResults.value).set(
        toolCallId,
        output
      );
  };
  const sendToolApprovalToServer = (toolCallId, approved) => {
    agent.send(
      JSON.stringify({
        type: MessageType.CF_AGENT_TOOL_APPROVAL,
        toolCallId,
        approved,
        autoContinue: autoContinueAfterToolResult
      })
    );
  };
  const flushActiveStreamToMessages = (activeMsg) => {
    setMessages((prevMessages) => {
      const existingIdx = prevMessages.findIndex(
        (m) => m.id === activeMsg.messageId
      );
      const partialMessage = {
        id: activeMsg.messageId,
        role: "assistant",
        parts: [...activeMsg.parts],
        ...(activeMsg.metadata != null && { metadata: activeMsg.metadata })
      };
      if (existingIdx >= 0) {
        const updated = [...prevMessages];
        updated[existingIdx] = partialMessage;
        return updated;
      }
      return [...prevMessages, partialMessage];
    });
  };
  watchEffect(() => {
    if (!experimental_automaticToolResolution) return;
    if (isResolvingTools.value) return;
    const messages = chatMessages.value;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;
    const toolCalls = lastMsg.parts.filter(
      (part) =>
        isToolUIPart(part) &&
        part.state === "input-available" &&
        !processedToolCalls.value.has(part.toolCallId)
    );
    if (toolCalls.length > 0) {
      const currentTools = tools;
      const toolCallsToResolve = toolCalls.filter(
        (part) =>
          isToolUIPart(part) &&
          !toolsRequiringConfirmation.value.includes(getToolName(part)) &&
          currentTools?.[getToolName(part)]?.execute
      );
      if (toolCallsToResolve.length > 0) {
        isResolvingTools.value = true;
        (async () => {
          try {
            const toolResults = [];
            for (const part of toolCallsToResolve)
              if (isToolUIPart(part)) {
                let toolOutput = null;
                const toolName = getToolName(part);
                const tool = currentTools?.[toolName];
                if (tool?.execute && part.input !== void 0)
                  try {
                    toolOutput = await tool.execute(part.input);
                  } catch (error) {
                    toolOutput = `Error executing tool: ${error instanceof Error ? error.message : String(error)}`;
                  }
                processedToolCalls.value.add(part.toolCallId);
                toolResults.push({
                  toolCallId: part.toolCallId,
                  toolName,
                  output: toolOutput
                });
              }
            if (toolResults.length > 0) {
              const clientToolSchemas = extractClientToolSchemas(currentTools);
              for (const result of toolResults)
                agent.send(
                  JSON.stringify({
                    type: MessageType.CF_AGENT_TOOL_RESULT,
                    toolCallId: result.toolCallId,
                    toolName: result.toolName,
                    output: result.output,
                    autoContinue: autoContinueAfterToolResult,
                    clientTools: clientToolSchemas
                  })
                );
              await Promise.all(
                toolResults.map((result) =>
                  addToolResult({
                    tool: result.toolName,
                    toolCallId: result.toolCallId,
                    output: result.output
                  })
                )
              );
              clientToolResults.value = new Map(
                [...clientToolResults.value].concat(
                  toolResults.map((r) => [r.toolCallId, r.output])
                )
              );
            }
          } finally {
            isResolvingTools.value = false;
            toolResolutionTrigger.value++;
          }
        })();
      }
    }
  });
  watch(chatMessages, () => {
    if (!onToolCall) return;
    const messages = chatMessages.value;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") return;
    const pendingToolCalls = lastMsg.parts.filter(
      (part) =>
        isToolUIPart(part) &&
        part.state === "input-available" &&
        !processedToolCalls.value.has(part.toolCallId)
    );
    for (const part of pendingToolCalls)
      if (isToolUIPart(part)) {
        const toolCallId = part.toolCallId;
        const toolName = getToolName(part);
        processedToolCalls.value.add(toolCallId);
        const addToolOutput = (opts) => {
          sendToolOutputToServer(
            opts.toolCallId,
            toolName,
            opts.output,
            opts.state,
            opts.errorText
          );
          addToolResult({
            tool: toolName,
            toolCallId: opts.toolCallId,
            output:
              opts.state === "output-error"
                ? (opts.errorText ?? "Tool execution denied by user")
                : opts.output
          });
        };
        onToolCall({
          toolCall: {
            toolCallId,
            toolName,
            input: part.input
          },
          addToolOutput
        });
      }
  });
  const onAgentMessage = (event) => {
    if (typeof event.data !== "string") return;
    let data;
    try {
      data = JSON.parse(event.data);
    } catch (_error) {
      return;
    }
    switch (data.type) {
      case MessageType.CF_AGENT_CHAT_CLEAR:
        setMessages([]);
        break;
      case MessageType.CF_AGENT_CHAT_MESSAGES:
        setMessages(data.messages);
        break;
      case MessageType.CF_AGENT_MESSAGE_UPDATED:
        setMessages((prevMessages) => {
          const updatedMessage = data.message;
          let idx = prevMessages.findIndex((m) => m.id === updatedMessage.id);
          if (idx < 0) {
            const updatedToolCallIds = new Set(
              updatedMessage.parts
                .filter((p) => "toolCallId" in p && p.toolCallId)
                .map((p) => p.toolCallId)
            );
            if (updatedToolCallIds.size > 0)
              idx = prevMessages.findIndex((m) =>
                m.parts.some(
                  (p) =>
                    "toolCallId" in p && updatedToolCallIds.has(p.toolCallId)
                )
              );
          }
          if (idx >= 0) {
            const updated = [...prevMessages];
            updated[idx] = {
              ...updatedMessage,
              id: prevMessages[idx].id
            };
            return updated;
          }
          return [...prevMessages, updatedMessage];
        });
        break;
      case MessageType.CF_AGENT_STREAM_RESUME_NONE:
        customTransport?.handleStreamResumeNone();
        break;
      case MessageType.CF_AGENT_STREAM_RESUMING:
        if (!resume) return;
        if (customTransport?.handleStreamResuming(data)) return;
        if (localRequestIds.value.has(data.id)) return;
        activeStream.value = {
          id: data.id,
          messageId: nanoid(),
          parts: []
        };
        agent.send(
          JSON.stringify({
            type: MessageType.CF_AGENT_STREAM_RESUME_ACK,
            id: data.id
          })
        );
        break;
      case MessageType.CF_AGENT_USE_CHAT_RESPONSE:
        if (localRequestIds.value.has(data.id)) return;
        const isContinuation = data.continuation === true;
        if (!activeStream.value || activeStream.value.id !== data.id) {
          let messageId = nanoid();
          let existingParts = [];
          let existingMetadata;
          if (isContinuation) {
            const currentMessages = chatMessages.value;
            for (let i = currentMessages.length - 1; i >= 0; i--)
              if (currentMessages[i].role === "assistant") {
                messageId = currentMessages[i].id;
                existingParts = [...currentMessages[i].parts];
                if (currentMessages[i].metadata != null)
                  existingMetadata = { ...currentMessages[i].metadata };
                break;
              }
          }
          activeStream.value = {
            id: data.id,
            messageId,
            parts: existingParts,
            metadata: existingMetadata
          };
        }
        const activeMsg = activeStream.value;
        const isReplay = data.replay === true;
        if (data.body?.trim())
          try {
            const chunkData = JSON.parse(data.body);
            const handled = applyChunkToParts(activeMsg.parts, chunkData);
            if (
              typeof chunkData.type === "string" &&
              chunkData.type.startsWith("data-") &&
              onData
            )
              onData(chunkData);
            if (
              !handled &&
              (chunkData.type === "start" ||
                chunkData.type === "finish" ||
                chunkData.type === "message-metadata")
            ) {
              if (chunkData.messageId != null && chunkData.type === "start")
                activeMsg.messageId = chunkData.messageId;
              if (chunkData.messageMetadata != null)
                activeMsg.metadata = activeMsg.metadata
                  ? {
                      ...activeMsg.metadata,
                      ...chunkData.messageMetadata
                    }
                  : { ...chunkData.messageMetadata };
            }
            if (!isReplay) flushActiveStreamToMessages(activeMsg);
          } catch (parseError) {
            console.warn(
              "[useAgentChat] Failed to parse stream chunk:",
              parseError instanceof Error ? parseError.message : parseError,
              "body:",
              data.body?.slice(0, 100)
            );
          }
        if (data.done || data.error) {
          if (isReplay && activeMsg) flushActiveStreamToMessages(activeMsg);
          activeStream.value = null;
        } else if (data.replayComplete && activeMsg)
          flushActiveStreamToMessages(activeMsg);
        break;
    }
  };
  watchEffect((onCleanup) => {
    agent.addEventListener("message", onAgentMessage);
    onCleanup(() => {
      agent.removeEventListener("message", onAgentMessage);
      activeStream.value = null;
    });
  });
  watch(chatMessages, () => {
    const messages = chatMessages.value;
    const currentToolCallIds = /* @__PURE__ */ new Set();
    for (const msg of messages)
      for (const part of msg.parts)
        if ("toolCallId" in part && part.toolCallId)
          currentToolCallIds.add(part.toolCallId);
    clientToolResults.value = new Map(
      Array.from(clientToolResults.value).filter(([id]) =>
        currentToolCallIds.has(id)
      )
    );
    processedToolCalls.value = new Set(
      Array.from(processedToolCalls.value).filter((id) =>
        currentToolCallIds.has(id)
      )
    );
  });
  const messagesWithToolResults = computed(() => {
    if (clientToolResults.value.size === 0) return chatMessages.value;
    return chatMessages.value.map((msg) => ({
      ...msg,
      parts: msg.parts.map((p) => {
        if (
          !("toolCallId" in p) ||
          !("state" in p) ||
          p.state !== "input-available" ||
          !clientToolResults.value.has(p.toolCallId)
        )
          return p;
        return {
          ...p,
          state: "output-available",
          output: clientToolResults.value.get(p.toolCallId)
        };
      })
    }));
  });
  const addToolResultAndSendMessage = async (args) => {
    const { toolCallId } = args;
    const toolName = "tool" in args ? args.tool : "";
    const output = "output" in args ? args.output : void 0;
    agent.send(
      JSON.stringify({
        type: MessageType.CF_AGENT_TOOL_RESULT,
        toolCallId,
        toolName,
        output,
        autoContinue: autoContinueAfterToolResult,
        clientTools: tools ? extractClientToolSchemas(tools) : void 0
      })
    );
    clientToolResults.value.set(toolCallId, output);
    await addToolResult(args);
    if (!autoContinueAfterToolResult) {
      if (!autoSendAfterAllConfirmationsResolved) {
        await sendMessage();
        return;
      }
      const pending = pendingConfirmations.value?.toolCallIds;
      if (!pending) {
        await sendMessage();
        return;
      }
      const wasLast = pending.size === 1 && pending.has(toolCallId);
      if (pending.has(toolCallId)) pending.delete(toolCallId);
      if (wasLast || pending.size === 0) await sendMessage();
    }
  };
  const addToolApprovalResponseAndNotifyServer = (args) => {
    const { id: approvalId, approved } = args;
    let toolCallId;
    const messages = chatMessages.value;
    for (const msg of messages) {
      for (const part of msg.parts)
        if (
          "toolCallId" in part &&
          "approval" in part &&
          part.approval?.id === approvalId
        ) {
          toolCallId = part.toolCallId;
          break;
        }
      if (toolCallId) break;
    }
    if (toolCallId) sendToolApprovalToServer(toolCallId, approved);
    else
      console.warn(
        `[useAgentChat] addToolApprovalResponse: Could not find toolCallId for approval ID "${approvalId}".`
      );
    addToolApprovalResponse(args);
  };
  const addToolOutput = (opts) => {
    const toolName = opts.toolName ?? "";
    sendToolOutputToServer(
      opts.toolCallId,
      toolName,
      opts.output,
      opts.state,
      opts.errorText
    );
    addToolResult({
      tool: toolName,
      toolCallId: opts.toolCallId,
      output:
        opts.state === "output-error"
          ? (opts.errorText ?? "Tool execution denied by user")
          : opts.output
    });
  };
  const clearHistory = () => {
    setMessages([]);
    clientToolResults.value = /* @__PURE__ */ new Map();
    processedToolCalls.value.clear();
    agent.send(JSON.stringify({ type: MessageType.CF_AGENT_CHAT_CLEAR }));
  };
  const setMessagesWithSync = (messagesOrUpdater) => {
    let resolvedMessages;
    if (typeof messagesOrUpdater === "function")
      resolvedMessages = messagesOrUpdater(chatMessages.value);
    else resolvedMessages = messagesOrUpdater;
    setMessages(resolvedMessages);
    agent.send(
      JSON.stringify({
        messages: resolvedMessages,
        type: MessageType.CF_AGENT_CHAT_MESSAGES
      })
    );
  };
  onBeforeUnmount(() => {
    if (initialMessagesCacheKey.value && initialMessagesPromise.value) {
      if (
        requestCache.get(initialMessagesCacheKey.value) ===
        initialMessagesPromise.value
      )
        requestCache.delete(initialMessagesCacheKey.value);
    }
    stop();
  });
  return {
    messages: messagesWithToolResults,
    status,
    error,
    sendMessage,
    regenerate,
    stop,
    addToolOutput,
    addToolResult: addToolResultAndSendMessage,
    addToolApprovalResponse: addToolApprovalResponseAndNotifyServer,
    clearHistory,
    setMessages: setMessagesWithSync
  };
}
//#endregion
export { useAgentChat };

//# sourceMappingURL=vue.js.map
