import { Chat } from "@ai-sdk/vue";
import type { UseChatOptions } from "@ai-sdk/react";
import { getToolName, isToolUIPart } from "ai";
import type {
  ChatInit,
  JSONSchema7,
  Tool,
  UIMessage as Message,
  UIMessage
} from "ai";
import { nanoid } from "nanoid";
import {
  ref,
  computed,
  watch,
  onMounted,
  onUnmounted,
  type Ref,
  onBeforeUnmount,
  shallowRef,
  watchEffect
} from "vue";
import type { OutgoingMessage } from "./types";
import { MessageType } from "./types";
import { applyChunkToParts, type MessageParts } from "./message-builder";
import { WebSocketChatTransport } from "./ws-chat-transport";
import type { useAgent } from "../../agents/src/react";
import type {
  AITool,
  PrepareSendMessagesRequestOptions,
  PrepareSendMessagesRequestResult,
  OnToolCallCallback
} from "./react";
import { extractClientToolSchemas } from "./react";

/**
 * One-shot deprecation warnings (warns once per key per session).
 */
const _deprecationWarnings = new Set<string>();
function warnDeprecated(id: string, message: string) {
  if (!_deprecationWarnings.has(id)) {
    _deprecationWarnings.add(id);
    console.warn(`[@cloudflare/ai-chat] Deprecated: ${message}`);
  }
}

type GetInitialMessagesOptions = {
  agent: string;
  name: string;
  url: string;
};

// v5 useChat parameters
type UseChatParams<M extends UIMessage = UIMessage> = ChatInit<M> &
  UseChatOptions<M>;

/**
 * Options for addToolOutput function
 */
type AddToolOutputOptions = {
  /** The ID of the tool call to provide output for */
  toolCallId: string;
  /** The name of the tool (optional, for type safety) */
  toolName?: string;
  /** The output to provide */
  output?: unknown;
  /** Override the tool part state (e.g. "output-error" for custom denial) */
  state?: "output-available" | "output-error";
  /** Error message when state is "output-error" */
  errorText?: string;
};

/**
 * Options for the useAgentChat hook
 */
type UseAgentChatOptions<
  State,
  ChatMessage extends UIMessage = UIMessage
> = Omit<UseChatParams<ChatMessage>, "fetch" | "onToolCall"> & {
  /** Agent connection from useAgent */
  agent: ReturnType<typeof useAgent<State>>;
  getInitialMessages?:
    | undefined
    | null
    | ((options: GetInitialMessagesOptions) => Promise<ChatMessage[]>);
  /** Request credentials */
  credentials?: RequestCredentials;
  /** Request headers */
  headers?: HeadersInit;
  /**
   * Callback for handling client-side tool execution.
   * Called when a tool without server-side `execute` is invoked by the LLM.
   *
   * Use this for:
   * - Tools that need browser APIs (geolocation, camera, etc.)
   * - Tools that need user interaction before providing a result
   * - Tools requiring approval before execution
   *
   * @example
   * ```typescript
   * onToolCall: async ({ toolCall, addToolOutput }) => {
   *   if (toolCall.toolName === 'getLocation') {
   *     const position = await navigator.geolocation.getCurrentPosition();
   *     addToolOutput({
   *       toolCallId: toolCall.toolCallId,
   *       output: { lat: position.coords.latitude, lng: position.coords.longitude }
   *     });
   *   }
   * }
   * ```
   */
  onToolCall?: OnToolCallCallback;
  /**
   * @deprecated Use `onToolCall` callback instead for automatic tool execution.
   * @description Whether to automatically resolve tool calls that do not require human interaction.
   * @experimental
   */
  experimental_automaticToolResolution?: boolean;
  /**
   * Tools that can be executed on the client. Tool schemas are automatically
   * sent to the server and tool calls are routed back for client execution.
   *
   * **For most apps**, define tools on the server with `tool()` from `"ai"`
   * and handle client-side execution via `onToolCall`. This gives you full
   * Zod type safety and keeps tool definitions in one place.
   *
   * **For SDKs and platforms** where tools are defined dynamically by the
   * embedding application at runtime, this option lets the client register
   * tools the server does not know about at deploy time.
   */
  tools?: Record<string, AITool<unknown, unknown>>;
  /**
   * @deprecated Use `needsApproval` on server-side tools instead.
   * @description Manual override for tools requiring confirmation.
   * If not provided, will auto-detect from tools object (tools without execute require confirmation).
   */
  toolsRequiringConfirmation?: string[];
  /**
   * When true (default), the server automatically continues the conversation
   * after receiving client-side tool results or approvals, similar to how
   * server-executed tools work with maxSteps in streamText. The continuation
   * is merged into the same assistant message.
   *
   * When false, the client must call sendMessage() after tool results
   * to continue the conversation, which creates a new assistant message.
   *
   * @default true
   */
  autoContinueAfterToolResult?: boolean;
  /**
   * @deprecated Use `sendAutomaticallyWhen` from AI SDK instead.
   *
   * When true (default), automatically sends the next message only after
   * all pending confirmation-required tool calls have been resolved.
   * When false, sends immediately after each tool result.
   *
   * Only applies when `autoContinueAfterToolResult` is false.
   *
   * @default true
   */
  autoSendAfterAllConfirmationsResolved?: boolean;
  /**
   * Set to false to disable automatic stream resumption.
   * @default true
   */
  resume?: boolean;
  /**
   * Custom data to include in every chat request body.
   * Accepts a static object or a function that returns one (for dynamic values).
   * These fields are available in `onChatMessage` via `options.body`.
   *
   * @example
   * ```typescript
   * // Static
   * body: { timezone: "America/New_York", userId: "abc" }
   *
   * // Dynamic (called on each send)
   * body: () => ({ token: getAuthToken(), timestamp: Date.now() })
   * ```
   */
  body?:
    | Record<string, unknown>
    | (() => Record<string, unknown> | Promise<Record<string, unknown>>);
  /**
   * Callback to customize the request before sending messages.
   * For most cases, use the `body` option instead.
   * Use this for advanced scenarios that need access to the messages or trigger type.
   *
   * Note: Client tool schemas are automatically sent when tools have `execute` functions.
   * This callback can add additional data alongside the auto-extracted schemas.
   */
  prepareSendMessagesRequest?: (
    options: PrepareSendMessagesRequestOptions<ChatMessage>
  ) =>
    | PrepareSendMessagesRequestResult
    | Promise<PrepareSendMessagesRequestResult>;
};

/**
 * Module-level cache for initial message fetches. Intentionally shared across
 * all useAgentChat instances to deduplicate requests during React Strict Mode
 * double-renders and re-renders. Cache keys include the agent URL, agent type,
 * and thread name to prevent cross-agent collisions.
 */
const requestCache = new Map<string, Promise<Message[]>>();

/**
 * Vue 3 composable for building AI chat interfaces using an Agent
 * @param options Chat options including the agent connection
 * @returns Chat interface controls and state with added clearHistory method
 */
export function useAgentChat<
  State = unknown,
  ChatMessage extends UIMessage = UIMessage
>(
  options: UseAgentChatOptions<State, ChatMessage> & {
    onChunk?: (chunk: any) => void;
  }
) {
  const {
    agent,
    getInitialMessages,
    messages: optionsInitialMessages,
    onToolCall,
    onData,
    onChunk,
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
  console.log("YES, this is the Vue composable!");

  // Emit deprecation warnings
  if (manualToolsRequiringConfirmation) {
    warnDeprecated(
      "useAgentChat.toolsRequiringConfirmation",
      "The 'toolsRequiringConfirmation' option is deprecated. Use needsApproval on server-side tools instead."
    );
  }
  if (experimental_automaticToolResolution) {
    warnDeprecated(
      "useAgentChat.experimental_automaticToolResolution",
      "The 'experimental_automaticToolResolution' option is deprecated. Use the onToolCall callback instead."
    );
  }
  if (options.autoSendAfterAllConfirmationsResolved !== undefined) {
    warnDeprecated(
      "useAgentChat.autoSendAfterAllConfirmationsResolved",
      "The 'autoSendAfterAllConfirmationsResolved' option is deprecated. Use sendAutomaticallyWhen from AI SDK instead."
    );
  }

  // Vue refs for reactive state
  const processedToolCalls = ref(new Set<string>());
  const isResolvingTools = ref(false);
  const toolResolutionTrigger = ref(0);
  const clientToolResults = ref(new Map<string, unknown>());
  const localRequestIds = ref(new Set<string>());
  const activeStream = shallowRef<{
    id: string;
    messageId: string;
    parts: ChatMessage["parts"];
    metadata?: Record<string, unknown>;
  } | null>(null);

  // Computed values
  const toolsRequiringConfirmation = computed(() => {
    if (manualToolsRequiringConfirmation) {
      return manualToolsRequiringConfirmation;
    }
    if (!tools) return [];
    return Object.entries(tools)
      .filter(([_name, tool]) => !tool.execute)
      .map(([name]) => name);
  });

  const agentUrl = computed(() => {
    const url = new URL(
      `${
        // @ts-expect-error we're using a protected _url property
        ((agent._url as string | null) || agent._pkurl)
          ?.replace("ws://", "http://")
          .replace("wss://", "https://")
      }`
    );
    url.searchParams.delete("_pk");
    return url.toString();
  });

  const initialMessagesCacheKey = computed(
    () => `${agentUrl.value}|${agent.agent ?? ""}|${agent.name ?? ""}`
  );

  // Default initial messages fetch function
  async function defaultGetInitialMessagesFetch({
    url
  }: GetInitialMessagesOptions) {
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
    if (!text.trim()) {
      return [];
    }
    try {
      return JSON.parse(text) as ChatMessage[];
    } catch (error) {
      console.warn("Failed to parse initial messages JSON:", error);
      return [];
    }
  }

  const getInitialMessagesFetch =
    getInitialMessages || defaultGetInitialMessagesFetch;

  function doGetInitialMessages(
    getInitialMessagesOptions: GetInitialMessagesOptions,
    cacheKey: string
  ) {
    if (requestCache.has(cacheKey)) {
      return requestCache.get(cacheKey)! as Promise<ChatMessage[]>;
    }
    const promise = getInitialMessagesFetch(getInitialMessagesOptions);
    requestCache.set(cacheKey, promise);
    return promise;
  }

  // Handle initial messages
  const initialMessagesPromise = ref<Promise<ChatMessage[]> | null>(
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

  // In Vue, we need to handle async initial messages differently
  const initialMessages = ref<ChatMessage[]>(optionsInitialMessages ?? []);

  // Load initial messages if promise exists
  if (initialMessagesPromise.value) {
    initialMessagesPromise.value.then((messages) => {
      initialMessages.value = messages;
      // Update Chat instance with initial messages
      if (chatInstance) {
        chatInstance.messages.splice(
          0,
          chatInstance.messages.length,
          ...messages
        );
      }
    });
  }

  // WebSocket transport
  let customTransport: WebSocketChatTransport<ChatMessage> | null = null;

  // Create transport only once
  if (!customTransport) {
    customTransport = new WebSocketChatTransport<ChatMessage>({
      agent: agent,
      activeRequestIds: localRequestIds.value,
      prepareBody: async ({ messages: msgs, trigger, messageId }) => {
        let extraBody: Record<string, unknown> = {};

        if (bodyOption) {
          const resolved =
            typeof bodyOption === "function" ? await bodyOption() : bodyOption;
          extraBody = { ...resolved };
        }

        if (tools) {
          const clientToolSchemas = extractClientToolSchemas(tools);
          if (clientToolSchemas) {
            extraBody.clientTools = clientToolSchemas;
          }
        }

        if (prepareSendMessagesRequest) {
          const userResult = await prepareSendMessagesRequest({
            id: agent._pk,
            messages: msgs,
            trigger,
            messageId
          });
          if (userResult.body) {
            Object.assign(extraBody, userResult.body);
          }
        }

        return extraBody;
      }
    });
  }

  // Update transport's agent reference
  watchEffect(() => {
    if (customTransport) {
      customTransport.agent = agent;
    }
  });

  // Create Chat instance from @ai-sdk/vue
  const chatInstance = new Chat<ChatMessage>({
    ...rest,
    onData,
    //@ts-expect-error
    messages: initialMessages.value,
    transport: customTransport,
    id: initialMessagesCacheKey.value,
    resume
  });

  // Expose reactive properties from Chat instance
  const refresher = ref(false);
  function refresh() {
    refresher.value = !refresher.value;
  }
  const chatMessages = computed(() => {
    console.log("chatMessages getter");
    return refresher.value ? chatInstance.messages : chatInstance.messages;
  });
  const status = computed(() =>
    refresher.value ? chatInstance.status : chatInstance.status
  );
  const error = computed(() =>
    refresher.value ? chatInstance.error : chatInstance.error
  );

  // Wrap Chat methods
  const sendMessage = async (text?: string) => {
    if (text !== undefined) {
      const r = await chatInstance.sendMessage({ text });
      refresh();
      return r;
    }
    return await chatInstance.sendMessage();
  };

  const setMessages = (
    messages: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
  ) => {
    console.log("setMessages was called");
    chatInstance.messages.splice(
      0,
      chatInstance.messages.length,
      ...(typeof messages === "function"
        ? messages(chatInstance.messages)
        : messages)
    );
    refresh();
  };

  const addToolResult = async (args: any) => {
    return await chatInstance.addToolResult(args);
  };

  const addToolApprovalResponse = (args: any) => {
    return chatInstance.addToolApprovalResponse(args);
  };

  const regenerate = async () => {
    return await chatInstance.regenerate();
  };

  const stop = () => {
    chatInstance.stop();
  };

  // Computed pending confirmations
  const pendingConfirmations = computed(() => {
    const messages = chatMessages.value;
    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.role !== "assistant") {
      return { messageId: undefined, toolCallIds: new Set<string>() };
    }

    const pendingIds = new Set<string>();
    for (const part of lastMessage.parts ?? []) {
      if (
        isToolUIPart(part) &&
        part.state === "input-available" &&
        toolsRequiringConfirmation.value.includes(getToolName(part))
      ) {
        pendingIds.add(part.toolCallId);
      }
    }
    return { messageId: lastMessage.id, toolCallIds: pendingIds };
  });

  // Helper functions
  const sendToolOutputToServer = (
    toolCallId: string,
    toolName: string,
    output: unknown,
    state?: "output-available" | "output-error",
    errorText?: string
  ) => {
    agent.send(
      JSON.stringify({
        type: MessageType.CF_AGENT_TOOL_RESULT,
        toolCallId,
        toolName,
        output,
        ...(state ? { state } : {}),
        ...(errorText !== undefined ? { errorText } : {}),
        autoContinue:
          state === "output-error" ? false : autoContinueAfterToolResult,
        clientTools: tools ? extractClientToolSchemas(tools) : undefined
      })
    );

    if (state !== "output-error") {
      clientToolResults.value = new Map(clientToolResults.value).set(
        toolCallId,
        output
      );
    }
  };

  const sendToolApprovalToServer = (toolCallId: string, approved: boolean) => {
    agent.send(
      JSON.stringify({
        type: MessageType.CF_AGENT_TOOL_APPROVAL,
        toolCallId,
        approved,
        autoContinue: autoContinueAfterToolResult
      })
    );
  };

  const flushActiveStreamToMessages = (activeMsg: {
    id: string;
    messageId: string;
    parts: ChatMessage["parts"];
    metadata?: Record<string, unknown>;
  }) => {
    console.log(
      "now calling flushActiveStreamToMessages for activeMsg",
      activeMsg.id
    );
    setMessages((prevMessages: ChatMessage[]) => {
      const existingIdx = prevMessages.findIndex(
        (m) => m.id === activeMsg.messageId
      );
      const partialMessage = {
        id: activeMsg.messageId,
        role: "assistant" as const,
        parts: [...activeMsg.parts],
        ...(activeMsg.metadata != null && { metadata: activeMsg.metadata })
      } as unknown as ChatMessage;

      if (existingIdx >= 0) {
        const updated = [...prevMessages];
        updated[existingIdx] = partialMessage;
        return updated;
      }
      return [...prevMessages, partialMessage];
    });
  };

  // Watch for automatic tool resolution (deprecated)
  watchEffect(() => {
    if (!experimental_automaticToolResolution) {
      return;
    }

    if (isResolvingTools.value) {
      return;
    }

    const messages = chatMessages.value;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") {
      return;
    }

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
            const toolResults: Array<{
              toolCallId: string;
              toolName: string;
              output: unknown;
            }> = [];

            for (const part of toolCallsToResolve) {
              if (isToolUIPart(part)) {
                let toolOutput: unknown = null;
                const toolName = getToolName(part);
                const tool = currentTools?.[toolName];

                if (tool?.execute && part.input !== undefined) {
                  try {
                    toolOutput = await tool.execute(part.input);
                  } catch (error) {
                    toolOutput = `Error executing tool: ${
                      error instanceof Error ? error.message : String(error)
                    }`;
                  }
                }

                processedToolCalls.value.add(part.toolCallId);
                toolResults.push({
                  toolCallId: part.toolCallId,
                  toolName,
                  output: toolOutput
                });
              }
            }

            if (toolResults.length > 0) {
              const clientToolSchemas = extractClientToolSchemas(currentTools);
              for (const result of toolResults) {
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
              }

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

  // Watch for onToolCall callback
  watch(chatMessages, () => {
    if (!onToolCall) {
      return;
    }

    const messages = chatMessages.value;
    const lastMsg = messages[messages.length - 1];
    if (!lastMsg || lastMsg.role !== "assistant") {
      return;
    }

    const pendingToolCalls = lastMsg.parts.filter(
      (part) =>
        isToolUIPart(part) &&
        part.state === "input-available" &&
        !processedToolCalls.value.has(part.toolCallId)
    );

    for (const part of pendingToolCalls) {
      if (isToolUIPart(part)) {
        const toolCallId = part.toolCallId;
        const toolName = getToolName(part);

        processedToolCalls.value.add(toolCallId);

        const addToolOutput = (opts: AddToolOutputOptions) => {
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
    }
  });

  // Message event listener
  const onAgentMessage = (event: MessageEvent) => {
    if (typeof event.data !== "string") {
      console.warn(
        "entering onAgentMessage - but immediately leaving it bc of unexpected event.data",
        event.data
      );
      return;
    }

    let data: OutgoingMessage<ChatMessage>;
    try {
      data = JSON.parse(event.data) as OutgoingMessage<ChatMessage>;
    } catch (_error) {
      console.warn(
        "leaving onAgentMessage due to JSON parsing error about event.data"
      );
      return;
    }
    console.log(
      "entering onAgentMessage - event.data.type:",
      data.type,
      "- full event.data:",
      data
    );

    switch (data.type) {
      case MessageType.CF_AGENT_CHAT_CLEAR:
        setMessages([]);
        break;

      case MessageType.CF_AGENT_CHAT_MESSAGES:
        setMessages(data.messages);
        break;

      case MessageType.CF_AGENT_MESSAGE_UPDATED:
        setMessages((prevMessages: ChatMessage[]) => {
          const updatedMessage = data.message;
          let idx = prevMessages.findIndex((m) => m.id === updatedMessage.id);

          if (idx < 0) {
            const updatedToolCallIds = new Set(
              updatedMessage.parts
                .filter(
                  (p: ChatMessage["parts"][number]) =>
                    "toolCallId" in p && p.toolCallId
                )
                .map(
                  (p: ChatMessage["parts"][number]) =>
                    (p as { toolCallId: string }).toolCallId
                )
            );

            if (updatedToolCallIds.size > 0) {
              idx = prevMessages.findIndex((m) =>
                m.parts.some(
                  (p) =>
                    "toolCallId" in p &&
                    updatedToolCallIds.has(
                      (p as { toolCallId: string }).toolCallId
                    )
                )
              );
            }
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
        console.log("CF_AGENT_USE_CHAT_RESPONSE case");
        // if (localRequestIds.value.has(data.id)) {
        //   console.log('CF_AGENT_USE_CHAT_RESPONSE: returning bc localRequestIds.value.has(data.id)')
        //   return
        // };

        const isContinuation = data.continuation === true;

        if (!activeStream.value || activeStream.value.id !== data.id) {
          console.log(
            "CF_AGENT_USE_CHAT_RESPONSE: entering if (!activeStream.value ... block"
          );
          let messageId = nanoid();
          let existingParts: ChatMessage["parts"] = [];
          let existingMetadata: Record<string, unknown> | undefined;

          if (isContinuation) {
            console.log(
              "CF_AGENT_USE_CHAT_RESPONSE: entering if (isContinuation) block"
            );
            const currentMessages = chatMessages.value;
            for (let i = currentMessages.length - 1; i >= 0; i--) {
              if (currentMessages[i].role === "assistant") {
                messageId = currentMessages[i].id;
                existingParts = [...currentMessages[i].parts];
                if (currentMessages[i].metadata != null) {
                  existingMetadata = {
                    ...(currentMessages[i].metadata as Record<string, unknown>)
                  };
                }
                break;
              }
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
        console.log(
          "CF_AGENT_USE_CHAT_RESPONSE: activeMsg is now",
          activeMsg,
          ", isReplay=",
          isReplay
        );

        if (data.body?.trim()) {
          console.log(
            "CF_AGENT_USE_CHAT_RESPONSE: entering if (data.body?.trim()) block"
          );
          try {
            const chunkData = JSON.parse(data.body);

            const handled = applyChunkToParts(
              activeMsg.parts as MessageParts,
              chunkData
            );

            if (
              typeof chunkData.type === "string" &&
              chunkData.type.startsWith("data-") &&
              onData
            ) {
              onData(chunkData);
            }
            if (onChunk) {
              onChunk(chunkData);
            }

            if (
              !handled &&
              (chunkData.type === "start" ||
                chunkData.type === "finish" ||
                chunkData.type === "message-metadata")
            ) {
              console.log(
                "CF_AGENT_USE_CHAT_RESPONSE: entering if (!handled ... block"
              );
              if (chunkData.messageId != null && chunkData.type === "start") {
                activeMsg.messageId = chunkData.messageId;
              }
              if (chunkData.messageMetadata != null) {
                activeMsg.metadata = activeMsg.metadata
                  ? { ...activeMsg.metadata, ...chunkData.messageMetadata }
                  : { ...chunkData.messageMetadata };
              }
            }

            if (!isReplay) {
              console.log(
                "CF_AGENT_USE_CHAT_RESPONSE: calling flushActiveStreamToMessages w/activeMsg=",
                activeMsg
              );
              flushActiveStreamToMessages(activeMsg);
            } else {
              console.log(
                "CF_AGENT_USE_CHAT_RESPONSE: not calling flushActiveStreamToMessages bc isReplay is",
                isReplay
              );
            }
          } catch (parseError) {
            console.warn(
              "[useAgentChat] Failed to parse stream chunk:",
              parseError instanceof Error ? parseError.message : parseError,
              "body:",
              data.body?.slice(0, 100)
            );
          }
        }

        if (data.done || data.error) {
          if (isReplay && activeMsg) {
            flushActiveStreamToMessages(activeMsg);
          }
          activeStream.value = null;
        } else if (data.replayComplete && activeMsg) {
          flushActiveStreamToMessages(activeMsg);
        }
        break;
    }
  };

  // Set up event listener
  watchEffect((onCleanup) => {
    console.log('adding event listener for "message"');
    agent.addEventListener("message", onAgentMessage);

    onCleanup(() => {
      console.log('removing event listener for "message"');
      agent.removeEventListener("message", onAgentMessage);
      activeStream.value = null;
    });
  });

  // Clean up processed tool calls
  watch(chatMessages, () => {
    const messages = chatMessages.value;
    const currentToolCallIds = new Set<string>();
    for (const msg of messages) {
      for (const part of msg.parts) {
        if ("toolCallId" in part && part.toolCallId) {
          currentToolCallIds.add(part.toolCallId);
        }
      }
    }

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

  // Merge client-side tool results with messages
  const messagesWithToolResults = computed(() => {
    if (clientToolResults.value.size === 0) {
      return chatMessages.value;
    }

    return chatMessages.value.map((msg) => ({
      ...msg,
      parts: msg.parts.map((p) => {
        if (
          !("toolCallId" in p) ||
          !("state" in p) ||
          p.state !== "input-available" ||
          !clientToolResults.value.has(p.toolCallId)
        ) {
          return p;
        }
        return {
          ...p,
          state: "output-available" as const,
          output: clientToolResults.value.get(p.toolCallId)
        };
      })
    })) as ChatMessage[];
  });

  // Wrapper functions
  const addToolResultAndSendMessage: typeof addToolResult = async (args) => {
    const { toolCallId } = args;
    const toolName = "tool" in args ? args.tool : "";
    const output = "output" in args ? args.output : undefined;

    agent.send(
      JSON.stringify({
        type: MessageType.CF_AGENT_TOOL_RESULT,
        toolCallId,
        toolName,
        output,
        autoContinue: autoContinueAfterToolResult,
        clientTools: tools ? extractClientToolSchemas(tools) : undefined
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
      if (pending.has(toolCallId)) {
        pending.delete(toolCallId);
      }

      if (wasLast || pending.size === 0) {
        await sendMessage();
      }
    }
  };

  const addToolApprovalResponseAndNotifyServer: typeof addToolApprovalResponse =
    (args) => {
      const { id: approvalId, approved } = args;

      let toolCallId: string | undefined;
      const messages = chatMessages.value;
      for (const msg of messages) {
        for (const part of msg.parts) {
          if (
            "toolCallId" in part &&
            "approval" in part &&
            (part.approval as { id?: string })?.id === approvalId
          ) {
            toolCallId = part.toolCallId as string;
            break;
          }
        }
        if (toolCallId) break;
      }

      if (toolCallId) {
        sendToolApprovalToServer(toolCallId, approved);
      } else {
        console.warn(
          `[useAgentChat] addToolApprovalResponse: Could not find toolCallId for approval ID "${approvalId}".`
        );
      }

      addToolApprovalResponse(args);
    };

  const addToolOutput = (opts: AddToolOutputOptions) => {
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
    clientToolResults.value = new Map();
    processedToolCalls.value.clear();
    agent.send(
      JSON.stringify({
        type: MessageType.CF_AGENT_CHAT_CLEAR
      })
    );
  };

  const setMessagesWithSync = (
    messagesOrUpdater: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])
  ) => {
    let resolvedMessages: ChatMessage[];
    if (typeof messagesOrUpdater === "function") {
      resolvedMessages = messagesOrUpdater(chatMessages.value);
    } else {
      resolvedMessages = messagesOrUpdater;
    }

    setMessages(resolvedMessages);
    agent.send(
      JSON.stringify({
        messages: resolvedMessages,
        type: MessageType.CF_AGENT_CHAT_MESSAGES
      })
    );
  };

  // Cleanup on unmount
  onBeforeUnmount(() => {
    if (initialMessagesCacheKey.value && initialMessagesPromise.value) {
      if (
        requestCache.get(initialMessagesCacheKey.value) ===
        initialMessagesPromise.value
      ) {
        requestCache.delete(initialMessagesCacheKey.value);
      }
    }
    // Stop any ongoing streams
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
