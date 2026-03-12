import { t as VOICE_PROTOCOL_VERSION } from "./types-CMD_tb0L.js";
//#region src/sentence-chunker.ts
/**
 * Sentence chunker — accumulates streaming text and yields complete sentences.
 *
 * Isolated and testable: no dependencies on the voice pipeline, Agent, or AI APIs.
 * Feed it tokens via `add()`, get back sentences via the return value.
 * Call `flush()` at end-of-stream to get any remaining text.
 *
 * Current implementation: splits on sentence-ending punctuation (. ! ?) followed
 * by a space or end-of-input. This is intentionally simple — optimize later with
 * better heuristics (abbreviations, decimal numbers, quoted speech, etc.).
 */
/**
 * Punctuation characters that can end a sentence.
 */
const SENTENCE_TERMINATORS = new Set([".", "!", "?"]);
/**
 * Minimum character count before we'll emit a sentence.
 * Prevents emitting fragments like "Dr." or "U.S." as standalone sentences,
 * while still allowing short responses like "Sure thing!" to stream quickly.
 */
const MIN_SENTENCE_LENGTH = 10;
var SentenceChunker = class {
  #buffer = "";
  /**
   * Add a chunk of text (e.g. a streamed LLM token).
   * Returns an array of complete sentences extracted from the buffer.
   * May return 0, 1, or multiple sentences depending on the input.
   */
  add(text) {
    this.#buffer += text;
    return this.#extractSentences();
  }
  /**
   * Flush any remaining text in the buffer as a final sentence.
   * Call this when the LLM stream ends.
   * Returns the remaining text (trimmed), or an empty array if nothing is left.
   */
  flush() {
    const remaining = this.#buffer.trim();
    this.#buffer = "";
    if (remaining.length > 0) return [remaining];
    return [];
  }
  /**
   * Reset the chunker, discarding any buffered text.
   */
  reset() {
    this.#buffer = "";
  }
  /**
   * Extract complete sentences from the buffer.
   * A sentence boundary is a terminator (. ! ?) followed by:
   * - a space and an uppercase letter (start of next sentence)
   * - a space and end of current buffer (likely a boundary)
   * - end of buffer after the terminator
   *
   * We leave ambiguous cases in the buffer until more text arrives.
   */
  #extractSentences() {
    const sentences = [];
    while (true) {
      const boundary = this.#findSentenceBoundary();
      if (boundary === -1) break;
      const sentence = this.#buffer.slice(0, boundary + 1).trim();
      this.#buffer = this.#buffer.slice(boundary + 1).trimStart();
      if (sentence.length > 0) sentences.push(sentence);
    }
    return sentences;
  }
  /**
   * Find the index of the end of the first complete sentence in the buffer.
   * Returns -1 if no complete sentence boundary is found.
   */
  #findSentenceBoundary() {
    for (let i = 0; i < this.#buffer.length; i++) {
      const char = this.#buffer[i];
      if (!SENTENCE_TERMINATORS.has(char)) continue;
      const nextChar = this.#buffer[i + 1];
      if (nextChar === void 0) continue;
      if (nextChar === " " || nextChar === "\n") {
        if (this.#buffer.slice(0, i + 1).trim().length >= MIN_SENTENCE_LENGTH)
          return i;
      }
    }
    return -1;
  }
};
//#endregion
//#region src/text-stream.ts
/**
 * Turn any {@link TextSource} into a lazy async generator of string chunks.
 *
 * - `string` → yields the string once (if non-empty).
 * - `ReadableStream<string>` → yields each chunk directly.
 * - `ReadableStream<Uint8Array>` → decodes and parses as newline-delimited
 *   JSON (NDJSON) / SSE (`data: …` lines), extracting text from common AI
 *   response formats.
 * - `AsyncIterable<string>` → re-yields each chunk.
 */
async function* iterateText(source) {
  if (typeof source === "string") {
    if (source) yield source;
    return;
  }
  if (source instanceof ReadableStream) {
    const reader = source.getReader();
    const first = await reader.read();
    if (first.done || first.value === void 0) return;
    if (typeof first.value === "string") {
      if (first.value) yield first.value;
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (typeof value === "string" && value) yield value;
      }
    } else {
      const peeked = first.value;
      const combined = new ReadableStream({
        async start(controller) {
          controller.enqueue(peeked);
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            controller.enqueue(value);
          }
          controller.close();
        }
      });
      for await (const chunk of parseNDJSON(combined.getReader())) {
        const ai = chunk;
        if (ai.response) yield ai.response;
        else if (ai.choices && ai.choices.length > 0) {
          const choice = ai.choices[0];
          if (choice.delta?.content && choice.delta?.role === "assistant")
            yield choice.delta.content;
        }
      }
    }
    return;
  }
  if (Symbol.asyncIterator in source) {
    for await (const chunk of source)
      if (typeof chunk === "string" && chunk) yield chunk;
  }
}
/**
 * Parse a `ReadableStream<Uint8Array>` that contains newline-delimited JSON
 * or Server-Sent Events (`data: {…}` lines).  Yields each parsed JSON object.
 *
 * Handles the `data: [DONE]` sentinel used by OpenAI-compatible APIs.
 */
async function* parseNDJSON(reader, leftOverBuffer = "") {
  const decoder = new TextDecoder();
  let buffer = leftOverBuffer;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const parsed = parseLine(line);
      if (parsed === "DONE") return;
      if (parsed) yield parsed;
    }
  }
  if (buffer.trim()) {
    const remaining = buffer.split("\n").filter((l) => l.trim());
    for (const line of remaining) {
      const parsed = parseLine(line);
      if (parsed === "DONE") return;
      if (parsed) yield parsed;
    }
  }
}
function parseLine(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("data: ")) {
    const json = trimmed.slice(6).trim();
    if (json === "[DONE]") return "DONE";
    try {
      return JSON.parse(json);
    } catch {
      console.warn("[voice] Skipping malformed SSE data:", json);
      return null;
    }
  }
  return null;
}
//#endregion
//#region src/audio-pipeline.ts
function concatenateBuffers(buffers) {
  const totalLength = buffers.reduce((sum, buf) => sum + buf.byteLength, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const buf of buffers) {
    result.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }
  return result.buffer;
}
const DEFAULT_VAD_THRESHOLD = 0.5;
const DEFAULT_MIN_AUDIO_BYTES = 16e3;
const DEFAULT_VAD_RETRY_MS = 3e3;
function sendVoiceJSON(connection, data, _logPrefix, _skipLog = false) {
  const json = JSON.stringify(data);
  connection.send(json);
}
/**
 * Manages per-connection audio pipeline state for voice mixins.
 * Owns the Maps/Sets for audio buffers, STT sessions, timers, and abort controllers.
 * Does not own pipeline orchestration — that stays in each mixin.
 */
var AudioConnectionManager = class {
  #audioBuffers = /* @__PURE__ */ new Map();
  #sttSessions = /* @__PURE__ */ new Map();
  #vadRetryTimers = /* @__PURE__ */ new Map();
  #eotTriggered = /* @__PURE__ */ new Set();
  #activePipeline = /* @__PURE__ */ new Map();
  constructor(_logPrefix) {}
  initConnection(connectionId) {
    if (!this.#audioBuffers.has(connectionId))
      this.#audioBuffers.set(connectionId, []);
  }
  isInCall(connectionId) {
    return this.#audioBuffers.has(connectionId);
  }
  cleanup(connectionId) {
    this.abortPipeline(connectionId);
    this.#audioBuffers.delete(connectionId);
    this.abortSTTSession(connectionId);
    this.clearVadRetry(connectionId);
    this.#eotTriggered.delete(connectionId);
  }
  bufferAudio(connectionId, chunk) {
    const buffer = this.#audioBuffers.get(connectionId);
    if (!buffer) return;
    buffer.push(chunk);
    let totalBytes = 0;
    for (const buf of buffer) totalBytes += buf.byteLength;
    while (totalBytes > 96e4 && buffer.length > 1)
      totalBytes -= buffer.shift().byteLength;
    const session = this.#sttSessions.get(connectionId);
    if (session) session.feed(chunk);
  }
  /**
   * Concatenate and clear the audio buffer for a connection.
   * Returns null if no audio or buffer doesn't exist.
   */
  getAndClearAudio(connectionId) {
    const chunks = this.#audioBuffers.get(connectionId);
    if (!chunks || chunks.length === 0) return null;
    const audio = concatenateBuffers(chunks);
    this.#audioBuffers.set(connectionId, []);
    return audio;
  }
  clearAudioBuffer(connectionId) {
    if (this.#audioBuffers.has(connectionId))
      this.#audioBuffers.set(connectionId, []);
  }
  pushbackAudio(connectionId, audio) {
    const buffer = this.#audioBuffers.get(connectionId);
    if (buffer) buffer.unshift(audio);
    else this.#audioBuffers.set(connectionId, [audio]);
  }
  hasSTTSession(connectionId) {
    return this.#sttSessions.has(connectionId);
  }
  startSTTSession(connectionId, provider, options) {
    const session = provider.createSession(options);
    this.#sttSessions.set(connectionId, session);
  }
  async flushSTTSession(connectionId) {
    const session = this.#sttSessions.get(connectionId);
    if (!session) return "";
    const transcript = await session.finish();
    this.#sttSessions.delete(connectionId);
    return transcript;
  }
  abortSTTSession(connectionId) {
    const session = this.#sttSessions.get(connectionId);
    if (session) {
      session.abort();
      this.#sttSessions.delete(connectionId);
    }
  }
  /** Remove the STT session without aborting (used after provider-driven EOT). */
  removeSTTSession(connectionId) {
    this.#sttSessions.delete(connectionId);
  }
  isEOTTriggered(connectionId) {
    return this.#eotTriggered.has(connectionId);
  }
  setEOTTriggered(connectionId) {
    this.#eotTriggered.add(connectionId);
  }
  clearEOT(connectionId) {
    this.#eotTriggered.delete(connectionId);
  }
  /**
   * Abort any in-flight pipeline and create a new AbortController.
   * Returns the new AbortSignal.
   */
  createPipelineAbort(connectionId) {
    this.abortPipeline(connectionId);
    const controller = new AbortController();
    this.#activePipeline.set(connectionId, controller);
    return controller.signal;
  }
  abortPipeline(connectionId) {
    this.#activePipeline.get(connectionId)?.abort();
    this.#activePipeline.delete(connectionId);
  }
  clearPipelineAbort(connectionId) {
    this.#activePipeline.delete(connectionId);
  }
  scheduleVadRetry(connectionId, callback, retryMs) {
    this.clearVadRetry(connectionId);
    this.#vadRetryTimers.set(
      connectionId,
      setTimeout(() => {
        this.#vadRetryTimers.delete(connectionId);
        callback();
      }, retryMs)
    );
  }
  clearVadRetry(connectionId) {
    const timer = this.#vadRetryTimers.get(connectionId);
    if (timer) {
      clearTimeout(timer);
      this.#vadRetryTimers.delete(connectionId);
    }
  }
};
//#endregion
//#region src/voice-input.ts
/**
 * Voice-to-text input mixin. Adds STT-only voice input to an Agent class.
 *
 * Subclasses must set an `stt` or `streamingStt` provider property.
 * No TTS provider is needed. Override `onTranscript` to handle each
 * transcribed utterance.
 *
 * @param Base - The Agent class to extend (e.g. `Agent`).
 * @param voiceInputOptions - Optional pipeline configuration.
 *
 * @example
 * ```typescript
 * import { Agent } from "agents";
 * import { withVoiceInput, WorkersAIFluxSTT } from "@cloudflare/voice";
 *
 * const InputAgent = withVoiceInput(Agent);
 *
 * class MyAgent extends InputAgent<Env> {
 *   streamingStt = new WorkersAIFluxSTT(this.env.AI);
 *
 *   onTranscript(text, connection) {
 *     console.log("User said:", text);
 *   }
 * }
 * ```
 */
function withVoiceInput(Base, voiceInputOptions) {
  console.log(
    "[@cloudflare/voice] Note: The voice API is experimental and may change between releases. Pin your version to avoid surprises."
  );
  const opts = voiceInputOptions ?? {};
  function opt(key, fallback) {
    return opts[key] ?? fallback;
  }
  class VoiceInputMixin extends Base {
    #cm = new AudioConnectionManager("VoiceInput");
    static #VOICE_MESSAGES = new Set([
      "hello",
      "start_call",
      "end_call",
      "start_of_speech",
      "end_of_speech",
      "interrupt"
    ]);
    constructor(...args) {
      super(...args);
      const _onConnect = this.onConnect?.bind(this);
      const _onClose = this.onClose?.bind(this);
      const _onMessage = this.onMessage?.bind(this);
      this.onConnect = (connection, ...rest) => {
        sendVoiceJSON(
          connection,
          {
            type: "welcome",
            protocol_version: 1
          },
          "VoiceInput"
        );
        sendVoiceJSON(
          connection,
          {
            type: "status",
            status: "idle"
          },
          "VoiceInput"
        );
        return _onConnect?.(connection, ...rest);
      };
      this.onClose = (connection, ...rest) => {
        this.#cm.cleanup(connection.id);
        return _onClose?.(connection, ...rest);
      };
      this.onMessage = (connection, message) => {
        if (message instanceof ArrayBuffer) {
          this.#cm.bufferAudio(connection.id, message);
          return;
        }
        if (typeof message !== "string")
          return _onMessage?.(connection, message);
        let parsed;
        try {
          parsed = JSON.parse(message);
        } catch {
          return _onMessage?.(connection, message);
        }
        if (VoiceInputMixin.#VOICE_MESSAGES.has(parsed.type)) {
          switch (parsed.type) {
            case "hello":
              break;
            case "start_call":
              this.#handleStartCall(connection);
              break;
            case "end_call":
              this.#handleEndCall(connection);
              break;
            case "start_of_speech":
              this.#handleStartOfSpeech(connection);
              break;
            case "end_of_speech":
              this.#cm.clearVadRetry(connection.id);
              this.#handleEndOfSpeech(connection);
              break;
            case "interrupt":
              this.#handleInterrupt(connection);
              break;
          }
          return;
        }
        return _onMessage?.(connection, message);
      };
    }
    /**
     * Called after each utterance is transcribed.
     * Override this to process the transcript (e.g. save to storage,
     * trigger a search, or forward to another service).
     *
     * @param text - The transcribed text.
     * @param connection - The WebSocket connection that sent the audio.
     */
    onTranscript(_text, _connection) {}
    /**
     * Called before accepting a call. Return `false` to reject.
     */
    beforeCallStart(_connection) {
      return true;
    }
    onCallStart(_connection) {}
    onCallEnd(_connection) {}
    onInterrupt(_connection) {}
    /**
     * Hook to transform audio before STT. Return null to skip this utterance.
     */
    beforeTranscribe(audio, _connection) {
      return audio;
    }
    /**
     * Hook to transform or filter the transcript after STT.
     * Return null to discard this utterance.
     */
    afterTranscribe(transcript, _connection) {
      return transcript;
    }
    #handleStartOfSpeech(connection) {
      if (!this.streamingStt) return;
      if (this.#cm.hasSTTSession(connection.id)) return;
      if (!this.#cm.isInCall(connection.id)) return;
      this.#cm.clearEOT(connection.id);
      let accumulated = "";
      this.#cm.startSTTSession(connection.id, this.streamingStt, {
        onFinal: (text) => {
          accumulated += (accumulated ? " " : "") + text;
          sendVoiceJSON(
            connection,
            {
              type: "transcript_interim",
              text: accumulated
            },
            "VoiceInput"
          );
        },
        onInterim: (text) => {
          sendVoiceJSON(
            connection,
            {
              type: "transcript_interim",
              text: accumulated ? accumulated + " " + text : text
            },
            "VoiceInput"
          );
        },
        onEndOfTurn: (transcript) => {
          if (this.#cm.isEOTTriggered(connection.id)) return;
          this.#cm.setEOTTriggered(connection.id);
          this.#cm.removeSTTSession(connection.id);
          this.#cm.clearAudioBuffer(connection.id);
          this.#cm.clearVadRetry(connection.id);
          this.#emitTranscript(connection, transcript);
        }
      });
    }
    async #handleStartCall(connection) {
      if (!(await this.beforeCallStart(connection))) return;
      this.#cm.initConnection(connection.id);
      sendVoiceJSON(
        connection,
        {
          type: "status",
          status: "listening"
        },
        "VoiceInput"
      );
      await this.onCallStart(connection);
    }
    #handleEndCall(connection) {
      this.#cm.cleanup(connection.id);
      sendVoiceJSON(
        connection,
        {
          type: "status",
          status: "idle"
        },
        "VoiceInput"
      );
      this.onCallEnd(connection);
    }
    #handleInterrupt(connection) {
      this.#cm.abortPipeline(connection.id);
      this.#cm.abortSTTSession(connection.id);
      this.#cm.clearVadRetry(connection.id);
      this.#cm.clearEOT(connection.id);
      this.#cm.clearAudioBuffer(connection.id);
      sendVoiceJSON(
        connection,
        {
          type: "status",
          status: "listening"
        },
        "VoiceInput"
      );
      this.onInterrupt(connection);
    }
    async #handleEndOfSpeech(connection, skipVad = false) {
      if (this.#cm.isEOTTriggered(connection.id)) {
        this.#cm.clearEOT(connection.id);
        return;
      }
      const audioData = this.#cm.getAndClearAudio(connection.id);
      if (!audioData) return;
      const hasStreamingSession = this.#cm.hasSTTSession(connection.id);
      const minAudioBytes = opt("minAudioBytes", DEFAULT_MIN_AUDIO_BYTES);
      if (audioData.byteLength < minAudioBytes) {
        this.#cm.abortSTTSession(connection.id);
        sendVoiceJSON(
          connection,
          {
            type: "status",
            status: "listening"
          },
          "VoiceInput"
        );
        return;
      }
      if (this.vad && !skipVad) {
        const vadResult = await this.vad.checkEndOfTurn(audioData);
        const vadThreshold = opt("vadThreshold", DEFAULT_VAD_THRESHOLD);
        if (!(vadResult.isComplete || vadResult.probability > vadThreshold)) {
          const maxPushbackBytes = opt("vadPushbackSeconds", 2) * 16e3 * 2;
          const pushback =
            audioData.byteLength > maxPushbackBytes
              ? audioData.slice(audioData.byteLength - maxPushbackBytes)
              : audioData;
          this.#cm.pushbackAudio(connection.id, pushback);
          sendVoiceJSON(
            connection,
            {
              type: "status",
              status: "listening"
            },
            "VoiceInput"
          );
          this.#cm.scheduleVadRetry(
            connection.id,
            () => this.#handleEndOfSpeech(connection, true),
            opt("vadRetryMs", DEFAULT_VAD_RETRY_MS)
          );
          return;
        }
      }
      const signal = this.#cm.createPipelineAbort(connection.id);
      sendVoiceJSON(
        connection,
        {
          type: "status",
          status: "thinking"
        },
        "VoiceInput"
      );
      try {
        let userText;
        if (hasStreamingSession) {
          const rawTranscript = await this.#cm.flushSTTSession(connection.id);
          if (signal.aborted) return;
          if (!rawTranscript || rawTranscript.trim().length === 0) {
            sendVoiceJSON(
              connection,
              {
                type: "status",
                status: "listening"
              },
              "VoiceInput"
            );
            return;
          }
          userText = await this.afterTranscribe(rawTranscript, connection);
        } else {
          if (!this.stt) {
            sendVoiceJSON(
              connection,
              {
                type: "status",
                status: "listening"
              },
              "VoiceInput"
            );
            return;
          }
          const processedAudio = await this.beforeTranscribe(
            audioData,
            connection
          );
          if (!processedAudio || signal.aborted) {
            sendVoiceJSON(
              connection,
              {
                type: "status",
                status: "listening"
              },
              "VoiceInput"
            );
            return;
          }
          const rawTranscript = await this.stt.transcribe(
            processedAudio,
            signal
          );
          if (signal.aborted) return;
          if (!rawTranscript || rawTranscript.trim().length === 0) {
            sendVoiceJSON(
              connection,
              {
                type: "status",
                status: "listening"
              },
              "VoiceInput"
            );
            return;
          }
          userText = await this.afterTranscribe(rawTranscript, connection);
        }
        if (!userText || signal.aborted) {
          sendVoiceJSON(
            connection,
            {
              type: "status",
              status: "listening"
            },
            "VoiceInput"
          );
          return;
        }
        await this.#emitTranscript(connection, userText);
      } catch (error) {
        if (signal.aborted) return;
        console.error("[VoiceInput] STT pipeline error:", error);
        sendVoiceJSON(
          connection,
          {
            type: "error",
            message:
              error instanceof Error ? error.message : "Voice input failed"
          },
          "VoiceInput"
        );
        sendVoiceJSON(
          connection,
          {
            type: "status",
            status: "listening"
          },
          "VoiceInput"
        );
      } finally {
        this.#cm.clearPipelineAbort(connection.id);
      }
    }
    /**
     * Send the user transcript to the client and call the onTranscript hook.
     * Then immediately return to listening — no LLM/TTS pipeline.
     */
    async #emitTranscript(connection, text) {
      sendVoiceJSON(
        connection,
        {
          type: "transcript_interim",
          text: ""
        },
        "VoiceInput"
      );
      sendVoiceJSON(
        connection,
        {
          type: "transcript",
          role: "user",
          text
        },
        "VoiceInput"
      );
      try {
        await this.onTranscript(text, connection);
      } catch (err) {
        console.error("[VoiceInput] onTranscript error:", err);
      }
      sendVoiceJSON(
        connection,
        {
          type: "status",
          status: "listening"
        },
        "VoiceInput"
      );
    }
  }
  return VoiceInputMixin;
}
//#endregion
//#region src/sfu-utils.ts
/**
 * Pure utility functions for the Cloudflare Realtime SFU integration.
 *
 * Extracted from sfu.ts for testability. These handle:
 * - Protobuf varint encoding/decoding
 * - SFU WebSocket adapter protobuf packet encoding/decoding
 * - Audio format conversion (48kHz stereo ↔ 16kHz mono)
 */
function decodeVarint(buf, offset) {
  let value = 0;
  let shift = 0;
  let bytesRead = 0;
  while (offset + bytesRead < buf.length) {
    const byte = buf[offset + bytesRead];
    value |= (byte & 127) << shift;
    bytesRead++;
    if ((byte & 128) === 0) break;
    shift += 7;
  }
  return {
    value,
    bytesRead
  };
}
function encodeVarint(value) {
  const bytes = [];
  while (value > 127) {
    bytes.push((value & 127) | 128);
    value >>>= 7;
  }
  bytes.push(value & 127);
  return new Uint8Array(bytes);
}
/** Extract the PCM payload from a protobuf Packet message. */
function extractPayloadFromProtobuf(data) {
  const buf = new Uint8Array(data);
  let offset = 0;
  while (offset < buf.length) {
    const { value: tag, bytesRead: tagBytes } = decodeVarint(buf, offset);
    offset += tagBytes;
    const fieldNumber = tag >>> 3;
    const wireType = tag & 7;
    if (wireType === 0) {
      const { bytesRead } = decodeVarint(buf, offset);
      offset += bytesRead;
    } else if (wireType === 2) {
      const { value: length, bytesRead: lenBytes } = decodeVarint(buf, offset);
      offset += lenBytes;
      if (fieldNumber === 5) return buf.slice(offset, offset + length);
      offset += length;
    } else break;
  }
  return null;
}
/** Encode PCM payload into a protobuf Packet message (for ingest/buffer mode — just payload). */
function encodePayloadToProtobuf(payload) {
  const tagBytes = encodeVarint(42);
  const lengthBytes = encodeVarint(payload.length);
  const result = new Uint8Array(
    tagBytes.length + lengthBytes.length + payload.length
  );
  result.set(tagBytes, 0);
  result.set(lengthBytes, tagBytes.length);
  result.set(payload, tagBytes.length + lengthBytes.length);
  return result.buffer;
}
/** Downsample 48kHz stereo interleaved PCM to 16kHz mono PCM (both 16-bit LE). */
function downsample48kStereoTo16kMono(stereo48k) {
  const inputView = new DataView(
    stereo48k.buffer,
    stereo48k.byteOffset,
    stereo48k.byteLength
  );
  const inputSamples = stereo48k.byteLength / 4;
  const outputSamples = Math.floor(inputSamples / 3);
  const output = /* @__PURE__ */ new ArrayBuffer(outputSamples * 2);
  const outputView = new DataView(output);
  for (let i = 0; i < outputSamples; i++) {
    const srcOffset = i * 3 * 4;
    if (srcOffset + 3 >= stereo48k.byteLength) break;
    const left = inputView.getInt16(srcOffset, true);
    const right = inputView.getInt16(srcOffset + 2, true);
    const mono = Math.round((left + right) / 2);
    outputView.setInt16(i * 2, mono, true);
  }
  return output;
}
/** Upsample 16kHz mono PCM to 48kHz stereo interleaved PCM (both 16-bit LE). */
function upsample16kMonoTo48kStereo(mono16k) {
  const inputView = new DataView(mono16k);
  const inputSamples = mono16k.byteLength / 2;
  const outputSamples = inputSamples * 3;
  const output = /* @__PURE__ */ new ArrayBuffer(outputSamples * 4);
  const outputView = new DataView(output);
  for (let i = 0; i < inputSamples; i++) {
    const sample = inputView.getInt16(i * 2, true);
    for (let j = 0; j < 3; j++) {
      const outOffset = (i * 3 + j) * 4;
      outputView.setInt16(outOffset, sample, true);
      outputView.setInt16(outOffset + 2, sample, true);
    }
  }
  return new Uint8Array(output);
}
const SFU_API_BASE = "https://rtc.live.cloudflare.com/v1";
async function sfuFetch(config, path, body) {
  const url = `${SFU_API_BASE}/apps/${config.appId}${path}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SFU API error ${response.status}: ${text}`);
  }
  return response.json();
}
async function createSFUSession(config) {
  const url = `${SFU_API_BASE}/apps/${config.appId}/sessions/new`;
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiToken}` }
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SFU API error ${response.status}: ${text}`);
  }
  return response.json();
}
async function addSFUTracks(config, sessionId, body) {
  return sfuFetch(config, `/sessions/${sessionId}/tracks/new`, body);
}
async function renegotiateSFUSession(config, sessionId, sdp) {
  const url = `${SFU_API_BASE}/apps/${config.appId}/sessions/${sessionId}/renegotiate`;
  const response = await fetch(url, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${config.apiToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      sessionDescription: {
        type: "answer",
        sdp
      }
    })
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(`SFU renegotiate error ${response.status}: ${text}`);
  }
  return response.json();
}
async function createSFUWebSocketAdapter(config, tracks) {
  return sfuFetch(config, "/adapters/websocket/new", { tracks });
}
//#endregion
//#region src/workers-ai-providers.ts
function toStream(buffer) {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(buffer));
      controller.close();
    }
  });
}
function writeString(view, offset, str) {
  for (let i = 0; i < str.length; i++)
    view.setUint8(offset + i, str.charCodeAt(i));
}
/** Convert raw PCM audio to WAV format. Exported for custom providers. */
function pcmToWav(pcmData, sampleRate, channels, bitsPerSample) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const dataSize = pcmData.byteLength;
  const headerSize = 44;
  const buffer = new ArrayBuffer(headerSize + dataSize);
  const view = new DataView(buffer);
  writeString(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(view, 8, "WAVE");
  writeString(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitsPerSample, true);
  writeString(view, 36, "data");
  view.setUint32(40, dataSize, true);
  new Uint8Array(buffer, headerSize).set(new Uint8Array(pcmData));
  return buffer;
}
/**
 * Workers AI speech-to-text provider.
 *
 * @example
 * ```ts
 * class MyAgent extends VoiceAgent<Env> {
 *   stt = new WorkersAISTT(this.env.AI);
 * }
 * ```
 */
var WorkersAISTT = class {
  #ai;
  #model;
  #language;
  constructor(ai, options) {
    this.#ai = ai;
    this.#model = options?.model ?? "@cf/deepgram/nova-3";
    this.#language = options?.language ?? "en";
  }
  async transcribe(audioData, signal) {
    const wavBuffer = pcmToWav(audioData, 16e3, 1, 16);
    return (
      (
        await this.#ai.run(
          this.#model,
          {
            audio: {
              body: toStream(wavBuffer),
              contentType: "audio/wav"
            },
            language: this.#language,
            punctuate: true,
            smart_format: true
          },
          signal ? { signal } : void 0
        )
      )?.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? ""
    );
  }
};
/**
 * Workers AI text-to-speech provider.
 *
 * @example
 * ```ts
 * class MyAgent extends VoiceAgent<Env> {
 *   tts = new WorkersAITTS(this.env.AI);
 * }
 * ```
 */
var WorkersAITTS = class {
  #ai;
  #model;
  #speaker;
  constructor(ai, options) {
    this.#ai = ai;
    this.#model = options?.model ?? "@cf/deepgram/aura-1";
    this.#speaker = options?.speaker ?? "asteria";
  }
  async synthesize(text, signal) {
    return await (
      await this.#ai.run(
        this.#model,
        {
          text,
          speaker: this.#speaker
        },
        {
          returnRawResponse: true,
          ...(signal ? { signal } : {})
        }
      )
    ).arrayBuffer();
  }
};
/**
 * Workers AI streaming speech-to-text provider using the Flux model.
 *
 * Flux is a conversational STT model with built-in end-of-turn detection.
 * It transcribes audio incrementally via a WebSocket connection to the
 * Workers AI binding — no external API key required.
 *
 * When using Flux, the separate VAD provider is optional — Flux detects
 * end-of-turn natively. Client-side silence detection still triggers the
 * pipeline, but the server-side VAD call can be skipped for lower latency.
 *
 * @example
 * ```ts
 * import { Agent } from "agents";
 * import { withVoice, WorkersAIFluxSTT, WorkersAITTS } from "agents/experimental/voice";
 *
 * const VoiceAgent = withVoice(Agent);
 *
 * class MyAgent extends VoiceAgent<Env> {
 *   streamingStt = new WorkersAIFluxSTT(this.env.AI);
 *   tts = new WorkersAITTS(this.env.AI);
 *   // No VAD needed — Flux handles turn detection
 *
 *   async onTurn(transcript, context) { ... }
 * }
 * ```
 */
var WorkersAIFluxSTT = class {
  #ai;
  #sampleRate;
  #eotThreshold;
  #eagerEotThreshold;
  #eotTimeoutMs;
  #keyterms;
  constructor(ai, options) {
    this.#ai = ai;
    this.#sampleRate = options?.sampleRate ?? 16e3;
    this.#eotThreshold = options?.eotThreshold;
    this.#eagerEotThreshold = options?.eagerEotThreshold;
    this.#eotTimeoutMs = options?.eotTimeoutMs;
    this.#keyterms = options?.keyterms;
  }
  createSession(options) {
    return new FluxSTTSession(
      this.#ai,
      {
        sampleRate: this.#sampleRate,
        eotThreshold: this.#eotThreshold,
        eagerEotThreshold: this.#eagerEotThreshold,
        eotTimeoutMs: this.#eotTimeoutMs,
        keyterms: this.#keyterms
      },
      options
    );
  }
};
/**
 * A single streaming STT session backed by a Flux WebSocket via env.AI.
 *
 * Lifecycle: created at start-of-speech, receives audio via feed(),
 * flushed via finish() at end-of-speech, or aborted on interrupt.
 */
var FluxSTTSession = class {
  #onInterim;
  #onFinal;
  #onEndOfTurn;
  #ws = null;
  #connected = false;
  #aborted = false;
  #pendingChunks = [];
  #latestTranscript = "";
  #endOfTurnTranscript = null;
  #finishing = false;
  #finishResolve = null;
  #finishPromise = null;
  #finishTimeout = null;
  constructor(ai, config, options) {
    this.#onInterim = options?.onInterim;
    this.#onFinal = options?.onFinal;
    this.#onEndOfTurn = options?.onEndOfTurn;
    this.#connect(ai, config);
  }
  async #connect(ai, config) {
    try {
      const input = {
        encoding: "linear16",
        sample_rate: String(config.sampleRate)
      };
      if (config.eotThreshold != null)
        input.eot_threshold = String(config.eotThreshold);
      if (config.eagerEotThreshold != null)
        input.eager_eot_threshold = String(config.eagerEotThreshold);
      if (config.eotTimeoutMs != null)
        input.eot_timeout_ms = String(config.eotTimeoutMs);
      if (config.keyterms?.length) input.keyterm = config.keyterms[0];
      const resp = await ai.run("@cf/deepgram/flux", input, {
        websocket: true
      });
      if (this.#aborted) {
        const ws = resp.webSocket;
        if (ws) {
          ws.accept();
          ws.close();
        }
        return;
      }
      const ws = resp.webSocket;
      if (!ws) {
        console.error("[FluxSTT] Failed to establish WebSocket connection");
        this.#resolveFinish();
        return;
      }
      ws.accept();
      this.#ws = ws;
      this.#connected = true;
      ws.addEventListener("message", (event) => {
        this.#handleMessage(event);
      });
      ws.addEventListener("close", () => {
        this.#clearFinishTimeout();
        this.#connected = false;
        this.#resolveFinish();
      });
      ws.addEventListener("error", (event) => {
        console.error("[FluxSTT] WebSocket error:", event);
        this.#connected = false;
        this.#resolveFinish();
      });
      for (const chunk of this.#pendingChunks) ws.send(chunk);
      this.#pendingChunks = [];
      if (this.#finishing) this.#startFinishTimeout();
    } catch (err) {
      console.error("[FluxSTT] Connection error:", err);
      this.#resolveFinish();
    }
  }
  feed(chunk) {
    if (this.#aborted || this.#finishing) return;
    if (this.#connected && this.#ws) this.#ws.send(chunk);
    else this.#pendingChunks.push(chunk);
  }
  async finish() {
    if (this.#aborted) return "";
    this.#finishing = true;
    if (this.#endOfTurnTranscript !== null) {
      this.#close();
      return this.#endOfTurnTranscript;
    }
    if (!this.#finishPromise)
      this.#finishPromise = new Promise((resolve) => {
        this.#finishResolve = resolve;
      });
    if (this.#connected && this.#ws) this.#startFinishTimeout();
    return this.#finishPromise;
  }
  abort() {
    if (this.#aborted) return;
    this.#aborted = true;
    this.#clearFinishTimeout();
    this.#pendingChunks = [];
    this.#close();
    this.#resolveFinish();
  }
  #close() {
    if (this.#ws) {
      try {
        this.#ws.close();
      } catch {}
      this.#ws = null;
    }
    this.#connected = false;
  }
  #closeAndResolve() {
    this.#clearFinishTimeout();
    this.#close();
    this.#resolveFinish();
  }
  /**
   * Start a timeout that gives Flux time to process remaining audio.
   * If EndOfTurn arrives before the timeout, it resolves immediately
   * (via the EndOfTurn handler). If the WS closes, the close handler
   * resolves. The timeout is the safety net for neither happening.
   */
  #startFinishTimeout() {
    if (this.#finishTimeout) return;
    this.#finishTimeout = setTimeout(() => {
      this.#finishTimeout = null;
      this.#close();
      this.#resolveFinish();
    }, 3e3);
  }
  #clearFinishTimeout() {
    if (this.#finishTimeout) {
      clearTimeout(this.#finishTimeout);
      this.#finishTimeout = null;
    }
  }
  #resolveFinish() {
    if (this.#finishResolve) {
      const transcript = this.#endOfTurnTranscript ?? this.#latestTranscript;
      this.#finishResolve(transcript.trim());
      this.#finishResolve = null;
    }
  }
  #handleMessage(event) {
    if (this.#aborted) return;
    try {
      const data =
        typeof event.data === "string" ? JSON.parse(event.data) : null;
      if (!data || !data.event) return;
      const transcript = data.transcript ?? "";
      switch (data.event) {
        case "Update":
          if (transcript) {
            this.#latestTranscript = transcript;
            this.#onInterim?.(transcript);
          }
          break;
        case "EndOfTurn":
          if (transcript) {
            this.#endOfTurnTranscript = transcript;
            this.#latestTranscript = transcript;
            this.#onFinal?.(transcript);
            this.#onEndOfTurn?.(transcript);
          }
          if (this.#finishing) {
            this.#clearFinishTimeout();
            this.#closeAndResolve();
          }
          break;
        case "EagerEndOfTurn":
          if (transcript) {
            this.#latestTranscript = transcript;
            this.#onInterim?.(transcript);
          }
          break;
        case "TurnResumed":
          break;
        case "StartOfTurn":
          break;
      }
    } catch {}
  }
};
/**
 * Workers AI voice activity detection provider.
 *
 * @example
 * ```ts
 * class MyAgent extends VoiceAgent<Env> {
 *   vad = new WorkersAIVAD(this.env.AI);
 * }
 * ```
 */
var WorkersAIVAD = class {
  #ai;
  #model;
  #windowSeconds;
  constructor(ai, options) {
    this.#ai = ai;
    this.#model = options?.model ?? "@cf/pipecat-ai/smart-turn-v2";
    this.#windowSeconds = options?.windowSeconds ?? 2;
  }
  async checkEndOfTurn(audioData) {
    const maxBytes = this.#windowSeconds * 16e3 * 2;
    const wavBuffer = pcmToWav(
      audioData.byteLength > maxBytes
        ? audioData.slice(audioData.byteLength - maxBytes)
        : audioData,
      16e3,
      1,
      16
    );
    const result = await this.#ai.run(this.#model, {
      audio: {
        body: toStream(wavBuffer),
        contentType: "application/octet-stream"
      }
    });
    return {
      isComplete: result.is_complete ?? false,
      probability: result.probability ?? 0
    };
  }
};
//#endregion
//#region src/voice.ts
const DEFAULT_HISTORY_LIMIT = 20;
const DEFAULT_MAX_MESSAGE_COUNT = 1e3;
/**
 * Voice pipeline mixin. Adds the full voice pipeline to an Agent class.
 *
 * Subclasses must set `stt` and `tts` provider properties. VAD is optional.
 *
 * @param Base - The Agent class to extend (e.g. `Agent`).
 * @param voiceOptions - Optional pipeline configuration.
 *
 * @example
 * ```typescript
 * import { Agent } from "agents";
 * import { withVoice, WorkersAISTT, WorkersAITTS, WorkersAIVAD } from "agents/experimental/voice";
 *
 * const VoiceAgent = withVoice(Agent);
 *
 * class MyAgent extends VoiceAgent<Env> {
 *   stt = new WorkersAISTT(this.env.AI);
 *   tts = new WorkersAITTS(this.env.AI);
 *   vad = new WorkersAIVAD(this.env.AI);
 *
 *   async onTurn(transcript, context) {
 *     return "Hello! I heard you say: " + transcript;
 *   }
 * }
 * ```
 */
function withVoice(Base, voiceOptions) {
  console.log(
    "[@cloudflare/voice] Note: The voice API is experimental and may change between releases. Pin your version to avoid surprises."
  );
  const opts = voiceOptions ?? {};
  function opt(key, fallback) {
    return opts[key] ?? fallback;
  }
  class VoiceAgentMixin extends Base {
    #cm = new AudioConnectionManager("VoiceAgent");
    static #VOICE_MESSAGES = new Set([
      "hello",
      "start_call",
      "end_call",
      "start_of_speech",
      "end_of_speech",
      "interrupt",
      "text_message"
    ]);
    #setCallState(connection, inCall) {
      this._unsafe_setConnectionFlag(
        connection,
        "_cf_voiceInCall",
        inCall || void 0
      );
    }
    #getCallState(connection) {
      return (
        this._unsafe_getConnectionFlag(connection, "_cf_voiceInCall") === true
      );
    }
    /**
     * Restore in-memory call state after hibernation wake.
     * Called when we receive a message for a connection that the state
     * says is in a call, but we have no in-memory buffer for it.
     */
    #restoreCallState(connection) {
      this.#cm.initConnection(connection.id);
    }
    #schemaReady = false;
    #ensureSchema() {
      if (this.#schemaReady) return;
      this.sql`
        CREATE TABLE IF NOT EXISTS cf_voice_messages (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          role TEXT NOT NULL,
          text TEXT NOT NULL,
          timestamp INTEGER NOT NULL
        )
      `;
      this.#schemaReady = true;
    }
    constructor(...args) {
      super(...args);
      const _onConnect = this.onConnect?.bind(this);
      const _onClose = this.onClose?.bind(this);
      const _onMessage = this.onMessage?.bind(this);
      this.onConnect = (connection, ...rest) => {
        this.#sendJSON(connection, {
          type: "welcome",
          protocol_version: 1
        });
        this.#sendJSON(connection, {
          type: "status",
          status: "idle"
        });
        return _onConnect?.(connection, ...rest);
      };
      this.onClose = (connection, ...rest) => {
        this.#cm.cleanup(connection.id);
        this.#setCallState(connection, false);
        return _onClose?.(connection, ...rest);
      };
      this.onMessage = (connection, message) => {
        if (!this.#cm.isInCall(connection.id) && this.#getCallState(connection))
          this.#restoreCallState(connection);
        if (message instanceof ArrayBuffer) {
          this.#cm.bufferAudio(connection.id, message);
          return;
        }
        if (typeof message !== "string")
          return _onMessage?.(connection, message);
        let parsed;
        try {
          parsed = JSON.parse(message);
        } catch {
          return _onMessage?.(connection, message);
        }
        if (VoiceAgentMixin.#VOICE_MESSAGES.has(parsed.type)) {
          switch (parsed.type) {
            case "hello":
              break;
            case "start_call":
              this.#handleStartCall(connection, parsed.preferred_format);
              break;
            case "end_call":
              this.#handleEndCall(connection);
              break;
            case "start_of_speech":
              this.#handleStartOfSpeech(connection);
              break;
            case "end_of_speech":
              this.#cm.clearVadRetry(connection.id);
              this.#handleEndOfSpeech(connection);
              break;
            case "interrupt":
              this.#handleInterrupt(connection);
              break;
            case "text_message": {
              const text = parsed.text;
              if (typeof text === "string")
                this.#handleTextMessage(connection, text);
              break;
            }
          }
          return;
        }
        return _onMessage?.(connection, message);
      };
    }
    onTurn(_transcript, _context) {
      throw new Error(
        "VoiceAgent subclass must implement onTurn(). Return a string, AsyncIterable<string>, or ReadableStream."
      );
    }
    beforeCallStart(_connection) {
      return true;
    }
    onCallStart(_connection) {}
    onCallEnd(_connection) {}
    onInterrupt(_connection) {}
    beforeTranscribe(audio, _connection) {
      return audio;
    }
    afterTranscribe(transcript, _connection) {
      return transcript;
    }
    beforeSynthesize(text, _connection) {
      return text;
    }
    afterSynthesize(audio, _text, _connection) {
      return audio;
    }
    #handleStartOfSpeech(connection) {
      if (!this.streamingStt) return;
      if (this.#cm.hasSTTSession(connection.id)) return;
      if (!this.#cm.isInCall(connection.id)) return;
      this.#cm.clearEOT(connection.id);
      let accumulated = "";
      this.#cm.startSTTSession(connection.id, this.streamingStt, {
        onFinal: (text) => {
          accumulated += (accumulated ? " " : "") + text;
          this.#sendJSON(connection, {
            type: "transcript_interim",
            text: accumulated
          });
        },
        onInterim: (text) => {
          const display = accumulated ? accumulated + " " + text : text;
          this.#sendJSON(connection, {
            type: "transcript_interim",
            text: display
          });
        },
        onEndOfTurn: (transcript) => {
          if (this.#cm.isEOTTriggered(connection.id)) return;
          this.#cm.setEOTTriggered(connection.id);
          this.#cm.removeSTTSession(connection.id);
          this.#cm.clearAudioBuffer(connection.id);
          this.#cm.clearVadRetry(connection.id);
          this.#runPipeline(connection, transcript);
        }
      });
    }
    #requireTTS() {
      if (!this.tts)
        throw new Error(
          "No TTS provider configured. Set 'tts' on your VoiceAgent subclass."
        );
      return this.tts;
    }
    saveMessage(role, text) {
      this.#ensureSchema();
      this.sql`
        INSERT INTO cf_voice_messages (role, text, timestamp)
        VALUES (${role}, ${text}, ${Date.now()})
      `;
      const maxMessages = opt("maxMessageCount", DEFAULT_MAX_MESSAGE_COUNT);
      this.sql`
        DELETE FROM cf_voice_messages
        WHERE id NOT IN (
          SELECT id FROM cf_voice_messages
          ORDER BY id DESC LIMIT ${maxMessages}
        )
      `;
    }
    getConversationHistory(limit) {
      this.#ensureSchema();
      const historyLimit = limit ?? opt("historyLimit", DEFAULT_HISTORY_LIMIT);
      return this.sql`
        SELECT role, text FROM cf_voice_messages
        ORDER BY id DESC LIMIT ${historyLimit}
      `
        .reverse()
        .map((row) => ({
          role: row.role,
          content: row.text
        }));
    }
    /**
     * Programmatically end a call for a specific connection.
     * Cleans up server-side state (audio buffers, pipelines, STT sessions,
     * keepalives) and sends the idle status to the client.
     * Use this to kick a speaker or enforce call limits.
     */
    forceEndCall(connection) {
      if (!this.#cm.isInCall(connection.id)) return;
      this.#handleEndCall(connection);
    }
    async speak(connection, text) {
      const signal = this.#cm.createPipelineAbort(connection.id);
      try {
        this.#sendJSON(connection, {
          type: "status",
          status: "speaking"
        });
        this.#sendJSON(connection, {
          type: "transcript_start",
          role: "assistant"
        });
        this.#sendJSON(connection, {
          type: "transcript_end",
          text
        });
        const audio = await this.#synthesizeWithHooks(text, connection, signal);
        if (audio && !signal.aborted) connection.send(audio);
        if (!signal.aborted) {
          this.saveMessage("assistant", text);
          this.#sendJSON(connection, {
            type: "status",
            status: "listening"
          });
        }
      } finally {
        this.#cm.clearPipelineAbort(connection.id);
      }
    }
    async speakAll(text) {
      this.saveMessage("assistant", text);
      const connections = [...this.getConnections()];
      if (connections.length === 0) return;
      for (const connection of connections) {
        const signal = this.#cm.createPipelineAbort(connection.id);
        try {
          this.#sendJSON(connection, {
            type: "status",
            status: "speaking"
          });
          this.#sendJSON(connection, {
            type: "transcript_start",
            role: "assistant"
          });
          this.#sendJSON(connection, {
            type: "transcript_end",
            text
          });
          const audio = await this.#synthesizeWithHooks(
            text,
            connection,
            signal
          );
          if (audio && !signal.aborted) connection.send(audio);
          if (!signal.aborted)
            this.#sendJSON(connection, {
              type: "status",
              status: "listening"
            });
        } finally {
          this.#cm.clearPipelineAbort(connection.id);
        }
      }
    }
    async #synthesizeWithHooks(text, connection, signal) {
      const textToSpeak = await this.beforeSynthesize(text, connection);
      if (!textToSpeak) return null;
      const rawAudio = await this.#requireTTS().synthesize(textToSpeak, signal);
      return this.afterSynthesize(rawAudio, textToSpeak, connection);
    }
    async #handleStartCall(connection, _preferredFormat) {
      if (!(await this.beforeCallStart(connection))) return;
      this.#cm.initConnection(connection.id);
      this.#setCallState(connection, true);
      const configuredFormat = opt("audioFormat", "mp3");
      this.#sendJSON(connection, {
        type: "audio_config",
        format: configuredFormat
      });
      this.#sendJSON(connection, {
        type: "status",
        status: "listening"
      });
      await this.onCallStart(connection);
    }
    #handleEndCall(connection) {
      this.#cm.cleanup(connection.id);
      this.#setCallState(connection, false);
      this.#sendJSON(connection, {
        type: "status",
        status: "idle"
      });
      this.onCallEnd(connection);
    }
    #handleInterrupt(connection) {
      this.#cm.abortPipeline(connection.id);
      this.#cm.abortSTTSession(connection.id);
      this.#cm.clearVadRetry(connection.id);
      this.#cm.clearEOT(connection.id);
      this.#cm.clearAudioBuffer(connection.id);
      this.#sendJSON(connection, {
        type: "status",
        status: "listening"
      });
      this.onInterrupt(connection);
    }
    async #handleTextMessage(connection, text) {
      if (!text || text.trim().length === 0) return;
      const userText = text.trim();
      const signal = this.#cm.createPipelineAbort(connection.id);
      const pipelineStart = Date.now();
      this.#sendJSON(connection, {
        type: "status",
        status: "thinking"
      });
      this.saveMessage("user", userText);
      this.#sendJSON(connection, {
        type: "transcript",
        role: "user",
        text: userText
      });
      try {
        const context = {
          connection,
          messages: this.getConversationHistory(),
          signal
        };
        const llmStart = Date.now();
        const turnResult = await this.onTurn(userText, context);
        if (signal.aborted) return;
        if (this.#cm.isInCall(connection.id)) {
          this.#sendJSON(connection, {
            type: "status",
            status: "speaking"
          });
          const { text: fullText } = await this.#streamResponse(
            connection,
            turnResult,
            llmStart,
            pipelineStart,
            signal
          );
          if (signal.aborted) return;
          this.saveMessage("assistant", fullText);
          this.#sendJSON(connection, {
            type: "status",
            status: "listening"
          });
        } else {
          this.#sendJSON(connection, {
            type: "transcript_start",
            role: "assistant"
          });
          let fullText = "";
          for await (const token of iterateText(turnResult)) {
            if (signal.aborted) break;
            fullText += token;
            this.#sendJSON(connection, {
              type: "transcript_delta",
              text: token
            });
          }
          this.#sendJSON(connection, {
            type: "transcript_end",
            text: fullText
          });
          this.saveMessage("assistant", fullText);
          this.#sendJSON(connection, {
            type: "status",
            status: "idle"
          });
        }
      } catch (error) {
        if (signal.aborted) return;
        console.error("[VoiceAgent] Text pipeline error:", error);
        this.#sendJSON(connection, {
          type: "error",
          message:
            error instanceof Error ? error.message : "Text pipeline failed"
        });
        this.#sendJSON(connection, {
          type: "status",
          status: this.#cm.isInCall(connection.id) ? "listening" : "idle"
        });
      } finally {
        this.#cm.clearPipelineAbort(connection.id);
      }
    }
    async #handleEndOfSpeech(connection, skipVad = false) {
      if (this.#cm.isEOTTriggered(connection.id)) {
        this.#cm.clearEOT(connection.id);
        return;
      }
      const audioData = this.#cm.getAndClearAudio(connection.id);
      if (!audioData) return;
      const hasStreamingSession = this.#cm.hasSTTSession(connection.id);
      const minAudioBytes = opt("minAudioBytes", DEFAULT_MIN_AUDIO_BYTES);
      if (audioData.byteLength < minAudioBytes) {
        this.#cm.abortSTTSession(connection.id);
        this.#sendJSON(connection, {
          type: "status",
          status: "listening"
        });
        return;
      }
      let vadMs = 0;
      if (this.vad && !skipVad) {
        const vadStart = Date.now();
        const vadResult = await this.vad.checkEndOfTurn(audioData);
        vadMs = Date.now() - vadStart;
        const vadThreshold = opt("vadThreshold", DEFAULT_VAD_THRESHOLD);
        if (!(vadResult.isComplete || vadResult.probability > vadThreshold)) {
          const maxPushbackBytes = opt("vadPushbackSeconds", 2) * 16e3 * 2;
          const pushback =
            audioData.byteLength > maxPushbackBytes
              ? audioData.slice(audioData.byteLength - maxPushbackBytes)
              : audioData;
          this.#cm.pushbackAudio(connection.id, pushback);
          this.#sendJSON(connection, {
            type: "status",
            status: "listening"
          });
          this.#cm.scheduleVadRetry(
            connection.id,
            () => this.#handleEndOfSpeech(connection, true),
            opt("vadRetryMs", DEFAULT_VAD_RETRY_MS)
          );
          return;
        }
      }
      const signal = this.#cm.createPipelineAbort(connection.id);
      const sttStart = Date.now();
      this.#sendJSON(connection, {
        type: "status",
        status: "thinking"
      });
      try {
        let userText;
        let sttMs;
        if (hasStreamingSession) {
          const rawTranscript = await this.#cm.flushSTTSession(connection.id);
          sttMs = Date.now() - sttStart;
          if (signal.aborted) return;
          if (!rawTranscript || rawTranscript.trim().length === 0) {
            this.#sendJSON(connection, {
              type: "status",
              status: "listening"
            });
            return;
          }
          userText = await this.afterTranscribe(rawTranscript, connection);
        } else {
          if (!this.stt) {
            this.#sendJSON(connection, {
              type: "status",
              status: "listening"
            });
            return;
          }
          const processedAudio = await this.beforeTranscribe(
            audioData,
            connection
          );
          if (!processedAudio || signal.aborted) {
            this.#sendJSON(connection, {
              type: "status",
              status: "listening"
            });
            return;
          }
          const rawTranscript = await this.stt.transcribe(
            processedAudio,
            signal
          );
          sttMs = Date.now() - sttStart;
          if (signal.aborted) return;
          if (!rawTranscript || rawTranscript.trim().length === 0) {
            this.#sendJSON(connection, {
              type: "status",
              status: "listening"
            });
            return;
          }
          userText = await this.afterTranscribe(rawTranscript, connection);
        }
        if (!userText || signal.aborted) {
          this.#sendJSON(connection, {
            type: "status",
            status: "listening"
          });
          return;
        }
        await this.#runPipelineInner(
          connection,
          userText,
          sttStart,
          vadMs,
          sttMs,
          signal
        );
      } catch (error) {
        if (signal.aborted) return;
        console.error("[VoiceAgent] Pipeline error:", error);
        this.#sendJSON(connection, {
          type: "error",
          message:
            error instanceof Error ? error.message : "Voice pipeline failed"
        });
        this.#sendJSON(connection, {
          type: "status",
          status: "listening"
        });
      } finally {
        this.#cm.clearPipelineAbort(connection.id);
      }
    }
    /**
     * Start the voice pipeline from a stable transcript.
     * Called by provider-driven EOT (onEndOfTurn callback).
     * Handles: abort controller setup, LLM, TTS, metrics, persistence.
     */
    async #runPipeline(connection, transcript) {
      const signal = this.#cm.createPipelineAbort(connection.id);
      const pipelineStart = Date.now();
      try {
        const userText = await this.afterTranscribe(transcript, connection);
        if (!userText || signal.aborted) {
          this.#sendJSON(connection, {
            type: "status",
            status: "listening"
          });
          return;
        }
        await this.#runPipelineInner(
          connection,
          userText,
          pipelineStart,
          0,
          0,
          signal
        );
      } catch (error) {
        if (signal.aborted) return;
        console.error("[VoiceAgent] Pipeline error:", error);
        this.#sendJSON(connection, {
          type: "error",
          message:
            error instanceof Error ? error.message : "Voice pipeline failed"
        });
        this.#sendJSON(connection, {
          type: "status",
          status: "listening"
        });
      } finally {
        this.#cm.clearPipelineAbort(connection.id);
      }
    }
    /**
     * Shared inner pipeline: save transcript, run LLM, stream TTS, emit metrics.
     * Used by both #handleEndOfSpeech (after STT) and #runPipeline (after provider EOT).
     */
    async #runPipelineInner(
      connection,
      userText,
      pipelineStart,
      vadMs,
      sttMs,
      signal
    ) {
      this.saveMessage("user", userText);
      this.#sendJSON(connection, {
        type: "transcript",
        role: "user",
        text: userText
      });
      this.#sendJSON(connection, {
        type: "status",
        status: "speaking"
      });
      const context = {
        connection,
        messages: this.getConversationHistory(),
        signal
      };
      const llmStart = Date.now();
      const turnResult = await this.onTurn(userText, context);
      if (signal.aborted) return;
      const {
        text: fullText,
        llmMs,
        ttsMs,
        firstAudioMs
      } = await this.#streamResponse(
        connection,
        turnResult,
        llmStart,
        pipelineStart,
        signal
      );
      if (signal.aborted) return;
      const totalMs = Date.now() - pipelineStart;
      this.#sendJSON(connection, {
        type: "metrics",
        vad_ms: vadMs,
        stt_ms: sttMs,
        llm_ms: llmMs,
        tts_ms: ttsMs,
        first_audio_ms: firstAudioMs,
        total_ms: totalMs
      });
      this.saveMessage("assistant", fullText);
      this.#sendJSON(connection, {
        type: "status",
        status: "listening"
      });
    }
    async #streamResponse(
      connection,
      response,
      llmStart,
      pipelineStart,
      signal
    ) {
      if (typeof response === "string") {
        const llmMs = Date.now() - llmStart;
        this.#sendJSON(connection, {
          type: "transcript_start",
          role: "assistant"
        });
        this.#sendJSON(connection, {
          type: "transcript_end",
          text: response
        });
        const ttsStart = Date.now();
        const audio = await this.#synthesizeWithHooks(response, connection);
        const ttsMs = Date.now() - ttsStart;
        if (audio && !signal.aborted) connection.send(audio);
        return {
          text: response,
          llmMs,
          ttsMs,
          firstAudioMs: Date.now() - pipelineStart
        };
      }
      return this.#streamingTTSPipeline(
        connection,
        iterateText(response),
        llmStart,
        pipelineStart,
        signal
      );
    }
    async #streamingTTSPipeline(
      connection,
      tokenStream,
      llmStart,
      pipelineStart,
      signal
    ) {
      const chunker = new SentenceChunker();
      const ttsQueue = [];
      let fullText = "";
      let firstAudioSentAt = null;
      let cumulativeTtsMs = 0;
      let streamComplete = false;
      let drainNotify = null;
      let drainPending = false;
      const notifyDrain = () => {
        if (drainNotify) {
          const resolve = drainNotify;
          drainNotify = null;
          resolve();
        } else drainPending = true;
      };
      const tts = this.#requireTTS();
      const hasStreamingTTS = typeof tts.synthesizeStream === "function";
      const drainPromise = (async () => {
        let i = 0;
        while (true) {
          while (i >= ttsQueue.length) {
            if (streamComplete && i >= ttsQueue.length) return;
            if (drainPending) {
              drainPending = false;
              continue;
            }
            await new Promise((r) => {
              drainNotify = r;
            });
            if (streamComplete && i >= ttsQueue.length) return;
          }
          if (signal.aborted) return;
          try {
            for await (const chunk of ttsQueue[i]) {
              if (signal.aborted) return;
              connection.send(chunk);
              if (!firstAudioSentAt) firstAudioSentAt = Date.now();
            }
          } catch (err) {
            console.error("[VoiceAgent] TTS error for sentence:", err);
            this.#sendJSON(connection, {
              type: "error",
              message:
                err instanceof Error ? err.message : "TTS failed for a sentence"
            });
          }
          i++;
        }
      })();
      const makeSentenceTTS = (sentence) => {
        const self = this;
        async function* generate() {
          const ttsStart = Date.now();
          const text = await self.beforeSynthesize(sentence, connection);
          if (!text) return;
          if (hasStreamingTTS)
            for await (const chunk of tts.synthesizeStream(text, signal)) {
              const processed = await self.afterSynthesize(
                chunk,
                text,
                connection
              );
              if (processed) yield processed;
            }
          else {
            const rawAudio = await tts.synthesize(text, signal);
            const processed = await self.afterSynthesize(
              rawAudio,
              text,
              connection
            );
            if (processed) yield processed;
          }
          cumulativeTtsMs += Date.now() - ttsStart;
        }
        return eagerAsyncIterable(generate());
      };
      const enqueueSentence = (sentence) => {
        ttsQueue.push(makeSentenceTTS(sentence));
        notifyDrain();
      };
      this.#sendJSON(connection, {
        type: "transcript_start",
        role: "assistant"
      });
      for await (const token of tokenStream) {
        if (signal.aborted) break;
        fullText += token;
        this.#sendJSON(connection, {
          type: "transcript_delta",
          text: token
        });
        const sentences = chunker.add(token);
        for (const sentence of sentences) enqueueSentence(sentence);
      }
      const llmMs = Date.now() - llmStart;
      const remaining = chunker.flush();
      for (const sentence of remaining) enqueueSentence(sentence);
      streamComplete = true;
      notifyDrain();
      this.#sendJSON(connection, {
        type: "transcript_end",
        text: fullText
      });
      await drainPromise;
      const firstAudioMs = firstAudioSentAt
        ? firstAudioSentAt - pipelineStart
        : 0;
      return {
        text: fullText,
        llmMs,
        ttsMs: cumulativeTtsMs,
        firstAudioMs
      };
    }
    #sendJSON(connection, data) {
      sendVoiceJSON(
        connection,
        data,
        "VoiceAgent",
        data.type === "transcript_delta"
      );
    }
  }
  return VoiceAgentMixin;
}
function eagerAsyncIterable(source) {
  const buffer = [];
  let finished = false;
  let error = null;
  let waitResolve = null;
  const notify = () => {
    if (waitResolve) {
      const resolve = waitResolve;
      waitResolve = null;
      resolve();
    }
  };
  (async () => {
    try {
      for await (const item of source) {
        buffer.push(item);
        notify();
      }
    } catch (err) {
      error = err;
    } finally {
      finished = true;
      notify();
    }
  })();
  return {
    [Symbol.asyncIterator]() {
      let index = 0;
      return {
        async next() {
          while (index >= buffer.length && !finished)
            await new Promise((r) => {
              waitResolve = r;
            });
          if (error) throw error;
          if (index >= buffer.length)
            return {
              done: true,
              value: void 0
            };
          return {
            done: false,
            value: buffer[index++]
          };
        }
      };
    }
  };
}
//#endregion
export {
  SentenceChunker,
  VOICE_PROTOCOL_VERSION,
  WorkersAIFluxSTT,
  WorkersAISTT,
  WorkersAITTS,
  WorkersAIVAD,
  addSFUTracks,
  createSFUSession,
  createSFUWebSocketAdapter,
  decodeVarint,
  downsample48kStereoTo16kMono,
  encodePayloadToProtobuf,
  encodeVarint,
  extractPayloadFromProtobuf,
  iterateText,
  pcmToWav,
  renegotiateSFUSession,
  sfuFetch,
  upsample16kMonoTo48kStereo,
  withVoice,
  withVoiceInput
};

//# sourceMappingURL=voice.js.map
