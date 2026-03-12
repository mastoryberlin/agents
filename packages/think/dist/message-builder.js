//#region src/message-builder.ts
/**
 * Applies a stream chunk to a mutable parts array, building up the message
 * incrementally. Returns true if the chunk was handled, false if it was
 * an unrecognized type (caller may handle it with additional logic).
 */
function applyChunkToParts(parts, chunk) {
  switch (chunk.type) {
    case "text-start":
      parts.push({
        type: "text",
        text: "",
        state: "streaming"
      });
      return true;
    case "text-delta": {
      const lastTextPart = findLastPartByType(parts, "text");
      if (lastTextPart && lastTextPart.type === "text")
        lastTextPart.text += chunk.delta ?? "";
      else
        parts.push({
          type: "text",
          text: chunk.delta ?? "",
          state: "streaming"
        });
      return true;
    }
    case "text-end": {
      const lastTextPart = findLastPartByType(parts, "text");
      if (lastTextPart && "state" in lastTextPart) lastTextPart.state = "done";
      return true;
    }
    case "reasoning-start":
      parts.push({
        type: "reasoning",
        text: "",
        state: "streaming"
      });
      return true;
    case "reasoning-delta": {
      const lastReasoningPart = findLastPartByType(parts, "reasoning");
      if (lastReasoningPart && lastReasoningPart.type === "reasoning")
        lastReasoningPart.text += chunk.delta ?? "";
      else
        parts.push({
          type: "reasoning",
          text: chunk.delta ?? "",
          state: "streaming"
        });
      return true;
    }
    case "reasoning-end": {
      const lastReasoningPart = findLastPartByType(parts, "reasoning");
      if (lastReasoningPart && "state" in lastReasoningPart)
        lastReasoningPart.state = "done";
      return true;
    }
    case "file":
      parts.push({
        type: "file",
        mediaType: chunk.mediaType,
        url: chunk.url
      });
      return true;
    case "source-url":
      parts.push({
        type: "source-url",
        sourceId: chunk.sourceId,
        url: chunk.url,
        title: chunk.title,
        providerMetadata: chunk.providerMetadata
      });
      return true;
    case "source-document":
      parts.push({
        type: "source-document",
        sourceId: chunk.sourceId,
        mediaType: chunk.mediaType,
        title: chunk.title,
        filename: chunk.filename,
        providerMetadata: chunk.providerMetadata
      });
      return true;
    case "tool-input-start":
      parts.push({
        type: `tool-${chunk.toolName}`,
        toolCallId: chunk.toolCallId,
        toolName: chunk.toolName,
        state: "input-streaming",
        input: void 0,
        ...(chunk.providerExecuted != null
          ? { providerExecuted: chunk.providerExecuted }
          : {}),
        ...(chunk.providerMetadata != null
          ? { callProviderMetadata: chunk.providerMetadata }
          : {}),
        ...(chunk.title != null ? { title: chunk.title } : {})
      });
      return true;
    case "tool-input-delta": {
      const toolPart = findToolPartByCallId(parts, chunk.toolCallId);
      if (toolPart) toolPart.input = chunk.input;
      return true;
    }
    case "tool-input-available": {
      const existing = findToolPartByCallId(parts, chunk.toolCallId);
      if (existing) {
        const p = existing;
        p.state = "input-available";
        p.input = chunk.input;
        if (chunk.providerExecuted != null)
          p.providerExecuted = chunk.providerExecuted;
        if (chunk.providerMetadata != null)
          p.callProviderMetadata = chunk.providerMetadata;
        if (chunk.title != null) p.title = chunk.title;
      } else
        parts.push({
          type: `tool-${chunk.toolName}`,
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          state: "input-available",
          input: chunk.input,
          ...(chunk.providerExecuted != null
            ? { providerExecuted: chunk.providerExecuted }
            : {}),
          ...(chunk.providerMetadata != null
            ? { callProviderMetadata: chunk.providerMetadata }
            : {}),
          ...(chunk.title != null ? { title: chunk.title } : {})
        });
      return true;
    }
    case "tool-input-error": {
      const existing = findToolPartByCallId(parts, chunk.toolCallId);
      if (existing) {
        const p = existing;
        p.state = "output-error";
        p.errorText = chunk.errorText;
        p.input = chunk.input;
        if (chunk.providerExecuted != null)
          p.providerExecuted = chunk.providerExecuted;
        if (chunk.providerMetadata != null)
          p.callProviderMetadata = chunk.providerMetadata;
      } else
        parts.push({
          type: `tool-${chunk.toolName}`,
          toolCallId: chunk.toolCallId,
          toolName: chunk.toolName,
          state: "output-error",
          input: chunk.input,
          errorText: chunk.errorText,
          ...(chunk.providerExecuted != null
            ? { providerExecuted: chunk.providerExecuted }
            : {}),
          ...(chunk.providerMetadata != null
            ? { callProviderMetadata: chunk.providerMetadata }
            : {})
        });
      return true;
    }
    case "tool-approval-request": {
      const toolPart = findToolPartByCallId(parts, chunk.toolCallId);
      if (toolPart) {
        const p = toolPart;
        p.state = "approval-requested";
        p.approval = { id: chunk.approvalId };
      }
      return true;
    }
    case "tool-output-denied": {
      const toolPart = findToolPartByCallId(parts, chunk.toolCallId);
      if (toolPart) {
        const p = toolPart;
        p.state = "output-denied";
      }
      return true;
    }
    case "tool-output-available": {
      const toolPart = findToolPartByCallId(parts, chunk.toolCallId);
      if (toolPart) {
        const p = toolPart;
        p.state = "output-available";
        p.output = chunk.output;
        if (chunk.preliminary !== void 0) p.preliminary = chunk.preliminary;
      }
      return true;
    }
    case "tool-output-error": {
      const toolPart = findToolPartByCallId(parts, chunk.toolCallId);
      if (toolPart) {
        const p = toolPart;
        p.state = "output-error";
        p.errorText = chunk.errorText;
      }
      return true;
    }
    case "step-start":
    case "start-step":
      parts.push({ type: "step-start" });
      return true;
    default:
      if (chunk.type.startsWith("data-")) {
        if (chunk.transient) return true;
        if (chunk.id != null) {
          const existing = findDataPartByTypeAndId(parts, chunk.type, chunk.id);
          if (existing) {
            existing.data = chunk.data;
            return true;
          }
        }
        parts.push({
          type: chunk.type,
          ...(chunk.id != null && { id: chunk.id }),
          data: chunk.data
        });
        return true;
      }
      return false;
  }
}
function findLastPartByType(parts, type) {
  for (let i = parts.length - 1; i >= 0; i--)
    if (parts[i].type === type) return parts[i];
}
function findToolPartByCallId(parts, toolCallId) {
  if (!toolCallId) return void 0;
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if ("toolCallId" in p && p.toolCallId === toolCallId) return p;
  }
}
function findDataPartByTypeAndId(parts, type, id) {
  for (let i = parts.length - 1; i >= 0; i--) {
    const p = parts[i];
    if (p.type === type && "id" in p && p.id === id) return p;
  }
}
//#endregion
export { applyChunkToParts };

//# sourceMappingURL=message-builder.js.map
