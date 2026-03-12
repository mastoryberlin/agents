import { ChatTransport, UIMessage, UIMessageChunk } from "ai";

//#region src/transport.d.ts
/**
 * Minimal interface for the agent connection object.
 * Satisfied by the return value of `useAgent()` from `agents/react`.
 */
interface AgentSocket {
  addEventListener(
    type: "message",
    handler: (event: MessageEvent) => void,
    options?: {
      signal?: AbortSignal;
    }
  ): void;
  removeEventListener(
    type: "message",
    handler: (event: MessageEvent) => void
  ): void;
  call(method: string, args?: unknown[]): Promise<unknown>;
  send(data: string): void;
}
/**
 * Options for constructing an AgentChatTransport.
 */
interface AgentChatTransportOptions {
  /**
   * The server-side RPC method to call when sending a message.
   * Receives `[text, requestId]` as arguments.
   * @default "sendMessage"
   */
  sendMethod?: string;
  /**
   * Timeout in milliseconds for reconnectToStream to wait for a
   * stream-resuming response before giving up.
   * @default 500
   */
  resumeTimeout?: number;
}
/**
 * ChatTransport implementation for Agent WebSocket connections.
 *
 * Speaks the wire protocol used by Think's `chat()` method
 * and ChunkRelay on the server:
 *   - `stream-start`   → new stream with requestId
 *   - `stream-event`   → UIMessageChunk payload
 *   - `stream-done`    → stream complete
 *   - `stream-resuming` → replay after reconnect
 *   - `cancel`         → client→server abort
 */
declare class AgentChatTransport implements ChatTransport<UIMessage> {
  #private;
  constructor(agent: AgentSocket, options?: AgentChatTransportOptions);
  /**
   * Detach from the current stream. Call this before switching agents
   * or cleaning up to ensure the stream controller is closed.
   */
  detach(): void;
  sendMessages({
    messages,
    abortSignal
  }: Parameters<ChatTransport<UIMessage>["sendMessages"]>[0]): Promise<
    ReadableStream<UIMessageChunk>
  >;
  reconnectToStream(): Promise<ReadableStream<UIMessageChunk> | null>;
}
//#endregion
export { AgentChatTransport, AgentChatTransportOptions, AgentSocket };
//# sourceMappingURL=transport.d.ts.map
