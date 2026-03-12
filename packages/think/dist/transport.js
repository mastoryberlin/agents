import {
  i as _classPrivateFieldInitSpec,
  n as _classPrivateFieldGet2,
  r as _assertClassBrand,
  t as _classPrivateFieldSet2
} from "./classPrivateFieldSet2-COLddhya.js";
import { t as _classPrivateMethodInitSpec } from "./classPrivateMethodInitSpec-CdQXQy1O.js";
//#region src/transport.ts
/**
 * Extract the text content from a UIMessage's parts.
 */
function getMessageText(msg) {
  return msg.parts
    .filter((p) => p.type === "text")
    .map((p) => p.text)
    .join("");
}
var _agent = /* @__PURE__ */ new WeakMap();
var _activeRequestIds = /* @__PURE__ */ new WeakMap();
var _currentFinish = /* @__PURE__ */ new WeakMap();
var _sendMethod = /* @__PURE__ */ new WeakMap();
var _resumeTimeout = /* @__PURE__ */ new WeakMap();
var _AgentChatTransport_brand = /* @__PURE__ */ new WeakSet();
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
var AgentChatTransport = class {
  constructor(agent, options) {
    _classPrivateMethodInitSpec(this, _AgentChatTransport_brand);
    _classPrivateFieldInitSpec(this, _agent, void 0);
    _classPrivateFieldInitSpec(
      this,
      _activeRequestIds,
      /* @__PURE__ */ new Set()
    );
    _classPrivateFieldInitSpec(this, _currentFinish, null);
    _classPrivateFieldInitSpec(this, _sendMethod, void 0);
    _classPrivateFieldInitSpec(this, _resumeTimeout, void 0);
    _classPrivateFieldSet2(_agent, this, agent);
    _classPrivateFieldSet2(
      _sendMethod,
      this,
      options?.sendMethod ?? "sendMessage"
    );
    _classPrivateFieldSet2(_resumeTimeout, this, options?.resumeTimeout ?? 500);
  }
  /**
   * Detach from the current stream. Call this before switching agents
   * or cleaning up to ensure the stream controller is closed.
   */
  detach() {
    _classPrivateFieldGet2(_currentFinish, this)?.call(this);
    _classPrivateFieldSet2(_currentFinish, this, null);
  }
  async sendMessages({ messages, abortSignal }) {
    const lastMessage = messages[messages.length - 1];
    const text = getMessageText(lastMessage);
    const requestId = crypto.randomUUID().slice(0, 8);
    let completed = false;
    const abortController = new AbortController();
    let streamController;
    const finish = (action) => {
      if (completed) return;
      completed = true;
      _classPrivateFieldSet2(_currentFinish, this, null);
      try {
        action();
      } catch {}
      _classPrivateFieldGet2(_activeRequestIds, this).delete(requestId);
      abortController.abort();
    };
    _classPrivateFieldSet2(_currentFinish, this, () =>
      finish(() => streamController.close())
    );
    const onAbort = () => {
      if (completed) return;
      try {
        _classPrivateFieldGet2(_agent, this).send(
          JSON.stringify({
            type: "cancel",
            requestId
          })
        );
      } catch {}
      finish(() =>
        streamController.error(
          Object.assign(/* @__PURE__ */ new Error("Aborted"), {
            name: "AbortError"
          })
        )
      );
    };
    const stream = new ReadableStream({
      start(controller) {
        streamController = controller;
      },
      cancel() {
        onAbort();
      }
    });
    _classPrivateFieldGet2(_agent, this).addEventListener(
      "message",
      (event) => {
        if (typeof event.data !== "string") return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.requestId !== requestId) return;
          if (msg.type === "stream-event") {
            const chunk = JSON.parse(msg.event);
            streamController.enqueue(chunk);
          } else if (msg.type === "stream-done")
            finish(() => streamController.close());
        } catch {}
      },
      { signal: abortController.signal }
    );
    if (abortSignal) {
      abortSignal.addEventListener("abort", onAbort, { once: true });
      if (abortSignal.aborted) onAbort();
    }
    _classPrivateFieldGet2(_activeRequestIds, this).add(requestId);
    _classPrivateFieldGet2(_agent, this)
      .call(_classPrivateFieldGet2(_sendMethod, this), [text, requestId])
      .catch((error) => {
        finish(() => streamController.error(error));
      });
    return stream;
  }
  async reconnectToStream() {
    const resumeTimeout = _classPrivateFieldGet2(_resumeTimeout, this);
    return new Promise((resolve) => {
      let resolved = false;
      let timeout;
      const done = (value) => {
        if (resolved) return;
        resolved = true;
        if (timeout) clearTimeout(timeout);
        _classPrivateFieldGet2(_agent, this).removeEventListener(
          "message",
          handler
        );
        resolve(value);
      };
      const handler = (event) => {
        if (typeof event.data !== "string") return;
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === "stream-resuming")
            done(
              _assertClassBrand(
                _AgentChatTransport_brand,
                this,
                _createResumeStream
              ).call(this, msg.requestId)
            );
        } catch {}
      };
      _classPrivateFieldGet2(_agent, this).addEventListener("message", handler);
      try {
        _classPrivateFieldGet2(_agent, this).send(
          JSON.stringify({ type: "resume-request" })
        );
      } catch {}
      timeout = setTimeout(() => done(null), resumeTimeout);
    });
  }
};
function _createResumeStream(requestId) {
  const abortController = new AbortController();
  let completed = false;
  const finish = (action) => {
    if (completed) return;
    completed = true;
    try {
      action();
    } catch {}
    _classPrivateFieldGet2(_activeRequestIds, this).delete(requestId);
    abortController.abort();
  };
  _classPrivateFieldGet2(_activeRequestIds, this).add(requestId);
  return new ReadableStream({
    start: (controller) => {
      _classPrivateFieldGet2(_agent, this).addEventListener(
        "message",
        (event) => {
          if (typeof event.data !== "string") return;
          try {
            const msg = JSON.parse(event.data);
            if (msg.requestId !== requestId) return;
            if (msg.type === "stream-event") {
              const chunk = JSON.parse(msg.event);
              controller.enqueue(chunk);
            } else if (msg.type === "stream-done")
              finish(() => controller.close());
          } catch {}
        },
        { signal: abortController.signal }
      );
    },
    cancel() {
      finish(() => {});
    }
  });
}
//#endregion
export { AgentChatTransport };

//# sourceMappingURL=transport.js.map
