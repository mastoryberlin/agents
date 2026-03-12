import {
  _ as VoiceTransport,
  d as VoiceAudioInput,
  g as VoiceStatus,
  l as VOICE_PROTOCOL_VERSION,
  m as VoiceRole,
  p as VoicePipelineMetrics,
  s as TranscriptMessage,
  u as VoiceAudioFormat
} from "./types-BRlsx4uQ.js";

//#region src/voice-client.d.ts
interface VoiceClientOptions {
  /** Agent name (matches the server-side Durable Object class). */
  agent: string;
  /** Instance name for the agent. @default "default" */
  name?: string;
  /** Host to connect to. @default window.location.host */
  host?: string;
  /**
   * Custom transport for sending/receiving data.
   * Defaults to a WebSocket transport via PartySocket.
   * Provide a custom implementation for WebRTC, SFU, or other transports.
   */
  transport?: VoiceTransport;
  /**
   * Custom audio input source. When provided, VoiceClient does NOT
   * use its built-in AudioWorklet mic capture. The audio input is
   * responsible for capturing and routing audio to the server.
   * It must report audio levels via `onAudioLevel` for silence and
   * interrupt detection to work.
   */
  audioInput?: VoiceAudioInput;
  /**
   * Preferred audio format for server responses. Sent in `start_call`
   * as a hint — the server may ignore it if it cannot produce that format.
   * The actual format is declared in the server's `audio_config` message.
   */
  preferredFormat?: VoiceAudioFormat;
  /** RMS threshold below which audio is considered silence. @default 0.04 */
  silenceThreshold?: number;
  /** How long silence must last before sending end_of_speech (ms). @default 500 */
  silenceDurationMs?: number;
  /** RMS threshold for detecting user speech during agent playback. @default 0.05 */
  interruptThreshold?: number;
  /** Consecutive high-RMS chunks needed to trigger an interrupt. @default 2 */
  interruptChunks?: number;
  /** Maximum transcript messages to keep in memory. @default 200 */
  maxTranscriptMessages?: number;
}
/** Maps each event name to the data type passed to its listeners. */
interface VoiceClientEventMap {
  statuschange: VoiceStatus;
  transcriptchange: TranscriptMessage[];
  interimtranscript: string | null;
  metricschange: VoicePipelineMetrics | null;
  audiolevelchange: number;
  connectionchange: boolean;
  error: string | null;
  mutechange: boolean;
  custommessage: unknown;
}
type VoiceClientEvent = keyof VoiceClientEventMap;
/**
 * Default VoiceTransport backed by PartySocket (reconnecting WebSocket).
 * Created automatically when no custom transport is provided.
 */
declare class WebSocketVoiceTransport implements VoiceTransport {
  #private;
  onopen: (() => void) | null;
  onclose: (() => void) | null;
  onerror: ((error?: unknown) => void) | null;
  onmessage: ((data: string | ArrayBuffer | Blob) => void) | null;
  constructor(options: { agent: string; name?: string; host?: string });
  get connected(): boolean;
  sendJSON(data: Record<string, unknown>): void;
  sendBinary(data: ArrayBuffer): void;
  connect(): void;
  disconnect(): void;
}
declare class VoiceClient {
  #private;
  constructor(options: VoiceClientOptions);
  get status(): VoiceStatus;
  get transcript(): TranscriptMessage[];
  get metrics(): VoicePipelineMetrics | null;
  get audioLevel(): number;
  get isMuted(): boolean;
  get connected(): boolean;
  get error(): string | null;
  /**
   * The current interim (partial) transcript from streaming STT.
   * Updates in real time as the user speaks. Cleared when the final
   * transcript is produced. null when no interim text is available.
   */
  get interimTranscript(): string | null;
  /**
   * The protocol version reported by the server.
   * null until the server sends its welcome message.
   */
  get serverProtocolVersion(): number | null;
  addEventListener<K extends VoiceClientEvent>(
    event: K,
    listener: (data: VoiceClientEventMap[K]) => void
  ): void;
  removeEventListener<K extends VoiceClientEvent>(
    event: K,
    listener: (data: VoiceClientEventMap[K]) => void
  ): void;
  connect(): void;
  disconnect(): void;
  startCall(): Promise<void>;
  endCall(): void;
  toggleMute(): void;
  /**
   * Send a text message to the agent. The agent processes it through
   * `onTurn()` (bypassing STT) and responds with text transcript and
   * TTS audio (if in a call) or text-only (if not).
   */
  sendText(text: string): void;
  /**
   * Send arbitrary JSON to the agent. Use this for app-level messages
   * that are not part of the voice protocol (e.g. `{ type: "kick_speaker" }`).
   * The server receives these in the consumer's `onMessage()` handler.
   */
  sendJSON(data: Record<string, unknown>): void;
  /**
   * The last custom (non-voice-protocol) message received from the server.
   * Listen for the `"custommessage"` event to be notified when this changes.
   */
  get lastCustomMessage(): unknown;
  /**
   * The audio format the server declared for binary payloads.
   * Set when the server sends `audio_config` at call start.
   */
  get audioFormat(): VoiceAudioFormat | null;
}
//#endregion
export {
  type TranscriptMessage,
  VOICE_PROTOCOL_VERSION,
  type VoiceAudioFormat,
  type VoiceAudioInput,
  VoiceClient,
  VoiceClientEvent,
  VoiceClientEventMap,
  VoiceClientOptions,
  type VoicePipelineMetrics,
  type VoiceRole,
  type VoiceStatus,
  type VoiceTransport,
  WebSocketVoiceTransport
};
//# sourceMappingURL=voice-client.d.ts.map
