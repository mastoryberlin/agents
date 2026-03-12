import { UIMessage } from "ai";

//#region src/message-builder.d.ts
/** The parts array type from UIMessage */
type MessageParts = UIMessage["parts"];
/** A single part from the UIMessage parts array */
type MessagePart = MessageParts[number];
/**
 * Parsed chunk data from an AI SDK stream event.
 * This is the JSON-parsed body of a CF_AGENT_USE_CHAT_RESPONSE message,
 * or the `data:` payload of an SSE line.
 */
type StreamChunkData = {
  type: string;
  id?: string;
  delta?: string;
  text?: string;
  mediaType?: string;
  url?: string;
  sourceId?: string;
  title?: string;
  filename?: string;
  toolCallId?: string;
  toolName?: string;
  input?: unknown;
  inputTextDelta?: string;
  output?: unknown;
  state?: string;
  errorText?: string;
  preliminary?: boolean;
  approvalId?: string;
  providerMetadata?: Record<string, unknown>;
  providerExecuted?: boolean;
  data?: unknown;
  transient?: boolean;
  messageId?: string;
  messageMetadata?: Record<string, unknown>;
  [key: string]: unknown;
};
/**
 * Applies a stream chunk to a mutable parts array, building up the message
 * incrementally. Returns true if the chunk was handled, false if it was
 * an unrecognized type (caller may handle it with additional logic).
 */
declare function applyChunkToParts(
  parts: MessagePart[],
  chunk: StreamChunkData
): boolean;
//#endregion
export { MessagePart, MessageParts, StreamChunkData, applyChunkToParts };
//# sourceMappingURL=message-builder.d.ts.map
