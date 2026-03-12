import { t as VOICE_PROTOCOL_VERSION } from "./types-CMD_tb0L.js";
import { PartySocket } from "partysocket";
//#region src/voice-client.ts
function camelCaseToKebabCase(str) {
  if (str === str.toUpperCase() && str !== str.toLowerCase())
    return str.toLowerCase().replace(/_/g, "-");
  let kebabified = str.replace(
    /[A-Z]/g,
    (letter) => `-${letter.toLowerCase()}`
  );
  kebabified = kebabified.startsWith("-") ? kebabified.slice(1) : kebabified;
  return kebabified.replace(/_/g, "-").replace(/-$/, "");
}
const WORKLET_PROCESSOR = `
class AudioCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = [];
    this.sampleRate = sampleRate;
    this.targetRate = 16000;
    this.ratio = this.sampleRate / this.targetRate;
  }

  process(inputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];

    // Linear interpolation resampling (e.g. 48kHz → 16kHz).
    // Nearest-neighbor (picking every Nth sample) introduces aliasing
    // artifacts, especially on sibilants (s, f, th). Linear interpolation
    // blends adjacent samples, acting as a basic low-pass filter.
    for (let i = 0; i < channelData.length; i += this.ratio) {
      const idx = Math.floor(i);
      const frac = i - idx;
      if (idx + 1 < channelData.length) {
        this.buffer.push(channelData[idx] * (1 - frac) + channelData[idx + 1] * frac);
      } else if (idx < channelData.length) {
        this.buffer.push(channelData[idx]);
      }
    }

    if (this.buffer.length >= 1600) {
      const chunk = new Float32Array(this.buffer);
      this.port.postMessage({ type: 'audio', samples: chunk }, [chunk.buffer]);
      this.buffer = [];
    }

    return true;
  }
}

registerProcessor('audio-capture-processor', AudioCaptureProcessor);
`;
function floatTo16BitPCM(samples) {
  const buffer = /* @__PURE__ */ new ArrayBuffer(samples.length * 2);
  const view = new DataView(buffer);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(i * 2, s < 0 ? s * 32768 : s * 32767, true);
  }
  return buffer;
}
function computeRMS(samples) {
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
/**
 * Default VoiceTransport backed by PartySocket (reconnecting WebSocket).
 * Created automatically when no custom transport is provided.
 */
var WebSocketVoiceTransport = class {
  #socket = null;
  #options;
  constructor(options) {
    this.onopen = null;
    this.onclose = null;
    this.onerror = null;
    this.onmessage = null;
    this.#options = options;
  }
  get connected() {
    return this.#socket?.readyState === WebSocket.OPEN;
  }
  sendJSON(data) {
    if (this.#socket?.readyState === WebSocket.OPEN)
      this.#socket.send(JSON.stringify(data));
  }
  sendBinary(data) {
    if (this.#socket?.readyState === WebSocket.OPEN) this.#socket.send(data);
  }
  connect() {
    if (this.#socket) return;
    const socket = new PartySocket({
      party: camelCaseToKebabCase(this.#options.agent),
      room: this.#options.name ?? "default",
      host: this.#options.host ?? window.location.host,
      prefix: "agents"
    });
    socket.onopen = () => this.onopen?.();
    socket.onclose = () => this.onclose?.();
    socket.onerror = () => this.onerror?.();
    socket.onmessage = (event) => {
      this.onmessage?.(event.data);
    };
    this.#socket = socket;
  }
  disconnect() {
    this.#socket?.close();
    this.#socket = null;
  }
};
var VoiceClient = class {
  #status = "idle";
  #transcript = [];
  #metrics = null;
  #audioLevel = 0;
  #isMuted = false;
  #connected = false;
  #error = null;
  #lastCustomMessage = null;
  #audioFormat = null;
  #interimTranscript = null;
  #serverProtocolVersion = null;
  #inCall = false;
  #silenceThreshold;
  #silenceDurationMs;
  #interruptThreshold;
  #interruptChunks;
  #maxTranscriptMessages;
  #transport = null;
  #options;
  #audioContext = null;
  #workletRegistered = false;
  #workletNode = null;
  #stream = null;
  #silenceTimer = null;
  #isSpeaking = false;
  #playbackQueue = [];
  #isPlaying = false;
  #activeSource = null;
  #interruptChunkCount = 0;
  #listeners = /* @__PURE__ */ new Map();
  constructor(options) {
    this.#options = options;
    this.#silenceThreshold = options.silenceThreshold ?? 0.04;
    this.#silenceDurationMs = options.silenceDurationMs ?? 500;
    this.#interruptThreshold = options.interruptThreshold ?? 0.05;
    this.#interruptChunks = options.interruptChunks ?? 2;
    this.#maxTranscriptMessages = options.maxTranscriptMessages ?? 200;
  }
  get status() {
    return this.#status;
  }
  get transcript() {
    return this.#transcript;
  }
  get metrics() {
    return this.#metrics;
  }
  get audioLevel() {
    return this.#audioLevel;
  }
  get isMuted() {
    return this.#isMuted;
  }
  get connected() {
    return this.#connected;
  }
  get error() {
    return this.#error;
  }
  /**
   * The current interim (partial) transcript from streaming STT.
   * Updates in real time as the user speaks. Cleared when the final
   * transcript is produced. null when no interim text is available.
   */
  get interimTranscript() {
    return this.#interimTranscript;
  }
  /**
   * The protocol version reported by the server.
   * null until the server sends its welcome message.
   */
  get serverProtocolVersion() {
    return this.#serverProtocolVersion;
  }
  addEventListener(event, listener) {
    let set = this.#listeners.get(event);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.#listeners.set(event, set);
    }
    set.add(listener);
  }
  removeEventListener(event, listener) {
    this.#listeners.get(event)?.delete(listener);
  }
  #emit(event, data) {
    const set = this.#listeners.get(event);
    if (set) for (const listener of set) listener(data);
  }
  #trimTranscript() {
    if (this.#transcript.length > this.#maxTranscriptMessages)
      this.#transcript = this.#transcript.slice(-this.#maxTranscriptMessages);
  }
  connect() {
    if (this.#transport) return;
    const transport =
      this.#options.transport ??
      new WebSocketVoiceTransport({
        agent: this.#options.agent,
        name: this.#options.name,
        host: this.#options.host
      });
    transport.onopen = () => {
      this.#connected = true;
      this.#error = null;
      transport.sendJSON({
        type: "hello",
        protocol_version: 1
      });
      this.#emit("connectionchange", true);
      this.#emit("error", null);
      if (this.#inCall) transport.sendJSON({ type: "start_call" });
    };
    transport.onclose = () => {
      this.#connected = false;
      this.#emit("connectionchange", false);
    };
    transport.onerror = () => {
      this.#error = "Connection lost. Reconnecting...";
      this.#emit("error", this.#error);
    };
    transport.onmessage = (data) => {
      if (typeof data === "string") this.#handleJSONMessage(data);
      else if (data instanceof Blob)
        data.arrayBuffer().then((buffer) => {
          this.#playbackQueue.push(buffer);
          this.#processPlaybackQueue();
        });
      else if (data instanceof ArrayBuffer) {
        this.#playbackQueue.push(data);
        this.#processPlaybackQueue();
      }
    };
    this.#transport = transport;
    transport.connect();
  }
  disconnect() {
    this.endCall();
    this.#transport?.disconnect();
    this.#transport = null;
    this.#connected = false;
    this.#emit("connectionchange", false);
  }
  async startCall() {
    if (!this.#transport?.connected) {
      this.#error = "Cannot start call: not connected. Call connect() first.";
      this.#emit("error", this.#error);
      return;
    }
    this.#inCall = true;
    this.#error = null;
    this.#metrics = null;
    this.#emit("error", null);
    this.#emit("metricschange", null);
    const startMsg = { type: "start_call" };
    if (this.#options.preferredFormat)
      startMsg.preferred_format = this.#options.preferredFormat;
    this.#transport.sendJSON(startMsg);
    if (this.#options.audioInput) {
      this.#options.audioInput.onAudioLevel = (rms) =>
        this.#processAudioLevel(rms);
      this.#options.audioInput.onAudioData = (pcm) => {
        if (this.#transport?.connected && !this.#isMuted)
          this.#transport.sendBinary(pcm);
      };
      await this.#options.audioInput.start();
    } else await this.#startMic();
  }
  endCall() {
    this.#inCall = false;
    if (this.#transport?.connected)
      this.#transport.sendJSON({ type: "end_call" });
    if (this.#options.audioInput) {
      this.#options.audioInput.stop();
      this.#options.audioInput.onAudioLevel = null;
      this.#options.audioInput.onAudioData = null;
    } else this.#stopMic();
    this.#activeSource?.stop();
    this.#activeSource = null;
    this.#playbackQueue = [];
    this.#isPlaying = false;
    this.#closeAudioContext();
    this.#resetDetection();
    this.#status = "idle";
    this.#emit("statuschange", "idle");
  }
  toggleMute() {
    this.#isMuted = !this.#isMuted;
    if (this.#isMuted) {
      this.#audioLevel = 0;
      this.#emit("audiolevelchange", 0);
    }
    if (this.#isMuted && this.#isSpeaking) {
      this.#isSpeaking = false;
      if (this.#silenceTimer) {
        clearTimeout(this.#silenceTimer);
        this.#silenceTimer = null;
      }
      if (this.#transport?.connected)
        this.#transport.sendJSON({ type: "end_of_speech" });
    }
    this.#emit("mutechange", this.#isMuted);
  }
  /**
   * Send a text message to the agent. The agent processes it through
   * `onTurn()` (bypassing STT) and responds with text transcript and
   * TTS audio (if in a call) or text-only (if not).
   */
  sendText(text) {
    if (this.#transport?.connected)
      this.#transport.sendJSON({
        type: "text_message",
        text
      });
  }
  /**
   * Send arbitrary JSON to the agent. Use this for app-level messages
   * that are not part of the voice protocol (e.g. `{ type: "kick_speaker" }`).
   * The server receives these in the consumer's `onMessage()` handler.
   */
  sendJSON(data) {
    if (this.#transport?.connected) this.#transport.sendJSON(data);
  }
  /**
   * The last custom (non-voice-protocol) message received from the server.
   * Listen for the `"custommessage"` event to be notified when this changes.
   */
  get lastCustomMessage() {
    return this.#lastCustomMessage;
  }
  /**
   * The audio format the server declared for binary payloads.
   * Set when the server sends `audio_config` at call start.
   */
  get audioFormat() {
    return this.#audioFormat;
  }
  #handleJSONMessage(data) {
    let msg;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    switch (msg.type) {
      case "welcome":
        this.#serverProtocolVersion = msg.protocol_version;
        if (msg.protocol_version !== 1)
          console.warn(
            `[VoiceClient] Protocol version mismatch: client=1, server=${msg.protocol_version}`
          );
        break;
      case "audio_config":
        this.#audioFormat = msg.format;
        break;
      case "status":
        this.#status = msg.status;
        if (msg.status === "listening" || msg.status === "idle") {
          this.#error = null;
          this.#emit("error", null);
        }
        this.#emit("statuschange", this.#status);
        break;
      case "transcript_interim":
        this.#interimTranscript = msg.text;
        this.#emit("interimtranscript", this.#interimTranscript);
        break;
      case "transcript":
        this.#interimTranscript = null;
        this.#emit("interimtranscript", null);
        this.#transcript = [
          ...this.#transcript,
          {
            role: msg.role,
            text: msg.text,
            timestamp: Date.now()
          }
        ];
        this.#trimTranscript();
        this.#emit("transcriptchange", this.#transcript);
        break;
      case "transcript_start":
        this.#transcript = [
          ...this.#transcript,
          {
            role: "assistant",
            text: "",
            timestamp: Date.now()
          }
        ];
        this.#trimTranscript();
        this.#emit("transcriptchange", this.#transcript);
        break;
      case "transcript_delta": {
        if (this.#transcript.length === 0) break;
        const updated = [...this.#transcript];
        const last = updated[updated.length - 1];
        if (last.role === "assistant") {
          updated[updated.length - 1] = {
            ...last,
            text: last.text + msg.text
          };
          this.#transcript = updated;
          this.#emit("transcriptchange", this.#transcript);
        }
        break;
      }
      case "transcript_end": {
        if (this.#transcript.length === 0) break;
        const updated = [...this.#transcript];
        const last = updated[updated.length - 1];
        if (last.role === "assistant") {
          updated[updated.length - 1] = {
            ...last,
            text: msg.text
          };
          this.#transcript = updated;
          this.#emit("transcriptchange", this.#transcript);
        }
        break;
      }
      case "metrics":
        this.#metrics = {
          vad_ms: msg.vad_ms,
          stt_ms: msg.stt_ms,
          llm_ms: msg.llm_ms,
          tts_ms: msg.tts_ms,
          first_audio_ms: msg.first_audio_ms,
          total_ms: msg.total_ms
        };
        this.#emit("metricschange", this.#metrics);
        break;
      case "error":
        this.#error = msg.message;
        this.#emit("error", this.#error);
        break;
      default:
        this.#lastCustomMessage = msg;
        this.#emit("custommessage", msg);
        break;
    }
  }
  /** Get or create the shared AudioContext. */
  async #getAudioContext() {
    if (!this.#audioContext)
      this.#audioContext = new AudioContext({ sampleRate: 48e3 });
    if (this.#audioContext.state === "suspended")
      await this.#audioContext.resume();
    return this.#audioContext;
  }
  /** Close the AudioContext and release resources. */
  #closeAudioContext() {
    if (this.#audioContext) {
      this.#audioContext.close().catch(() => {});
      this.#audioContext = null;
      this.#workletRegistered = false;
    }
  }
  async #playAudio(audioData) {
    try {
      const ctx = await this.#getAudioContext();
      let audioBuffer;
      if (this.#audioFormat === "pcm16") {
        const int16 = new Int16Array(audioData);
        audioBuffer = ctx.createBuffer(1, int16.length, 16e3);
        const channel = audioBuffer.getChannelData(0);
        for (let i = 0; i < int16.length; i++) channel[i] = int16[i] / 32768;
      } else audioBuffer = await ctx.decodeAudioData(audioData.slice(0));
      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);
      this.#activeSource = source;
      return new Promise((resolve) => {
        source.onended = () => {
          if (this.#activeSource === source) this.#activeSource = null;
          resolve();
        };
        source.start();
      });
    } catch (err) {
      console.error("[VoiceClient] Audio playback error:", err);
    }
  }
  async #processPlaybackQueue() {
    if (this.#isPlaying || this.#playbackQueue.length === 0) return;
    this.#isPlaying = true;
    while (this.#playbackQueue.length > 0) {
      const audioData = this.#playbackQueue.shift();
      await this.#playAudio(audioData);
    }
    this.#isPlaying = false;
  }
  async #startMic() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: { ideal: 48e3 },
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      this.#stream = stream;
      const ctx = await this.#getAudioContext();
      if (!this.#workletRegistered) {
        const blob = new Blob([WORKLET_PROCESSOR], {
          type: "application/javascript"
        });
        const workletUrl = URL.createObjectURL(blob);
        await ctx.audioWorklet.addModule(workletUrl);
        URL.revokeObjectURL(workletUrl);
        this.#workletRegistered = true;
      }
      const source = ctx.createMediaStreamSource(stream);
      const workletNode = new AudioWorkletNode(ctx, "audio-capture-processor");
      this.#workletNode = workletNode;
      workletNode.port.onmessage = (event) => {
        if (event.data.type === "audio" && !this.#isMuted) {
          const samples = event.data.samples;
          const rms = computeRMS(samples);
          const pcm = floatTo16BitPCM(samples);
          if (this.#transport?.connected) this.#transport.sendBinary(pcm);
          this.#processAudioLevel(rms);
        }
      };
      source.connect(workletNode);
      workletNode.connect(ctx.destination);
    } catch (err) {
      console.error("[VoiceClient] Mic error:", err);
      this.#error =
        "Microphone access denied. Please allow microphone access and try again.";
      this.#emit("error", this.#error);
    }
  }
  #stopMic() {
    this.#workletNode?.disconnect();
    this.#workletNode = null;
    this.#stream?.getTracks().forEach((track) => track.stop());
    this.#stream = null;
    this.#resetDetection();
  }
  #processAudioLevel(rms) {
    if (this.#isMuted) return;
    this.#audioLevel = rms;
    this.#emit("audiolevelchange", rms);
    if (this.#isPlaying && rms > this.#interruptThreshold) {
      this.#interruptChunkCount++;
      if (this.#interruptChunkCount >= this.#interruptChunks) {
        this.#activeSource?.stop();
        this.#activeSource = null;
        this.#playbackQueue = [];
        this.#isPlaying = false;
        this.#interruptChunkCount = 0;
        if (this.#transport?.connected)
          this.#transport.sendJSON({ type: "interrupt" });
      }
    } else this.#interruptChunkCount = 0;
    if (rms > this.#silenceThreshold) {
      if (!this.#isSpeaking) {
        this.#isSpeaking = true;
        if (this.#transport?.connected)
          this.#transport.sendJSON({ type: "start_of_speech" });
      }
      if (this.#silenceTimer) {
        clearTimeout(this.#silenceTimer);
        this.#silenceTimer = null;
      }
    } else if (this.#isSpeaking) {
      if (!this.#silenceTimer)
        this.#silenceTimer = setTimeout(() => {
          this.#isSpeaking = false;
          this.#silenceTimer = null;
          if (this.#transport?.connected)
            this.#transport.sendJSON({ type: "end_of_speech" });
        }, this.#silenceDurationMs);
    }
  }
  #resetDetection() {
    if (this.#silenceTimer) {
      clearTimeout(this.#silenceTimer);
      this.#silenceTimer = null;
    }
    this.#isSpeaking = false;
    this.#interruptChunkCount = 0;
    this.#audioLevel = 0;
    this.#emit("audiolevelchange", 0);
  }
};
//#endregion
export { VOICE_PROTOCOL_VERSION, VoiceClient, WebSocketVoiceTransport };

//# sourceMappingURL=voice-client.js.map
