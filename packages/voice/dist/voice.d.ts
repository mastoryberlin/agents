import {
  _ as VoiceTransport,
  a as StreamingTTSProvider,
  c as VADProvider,
  d as VoiceAudioInput,
  f as VoiceClientMessage,
  g as VoiceStatus,
  h as VoiceServerMessage,
  i as StreamingSTTSessionOptions,
  l as VOICE_PROTOCOL_VERSION,
  m as VoiceRole,
  n as StreamingSTTProvider,
  o as TTSProvider,
  p as VoicePipelineMetrics,
  r as StreamingSTTSession,
  s as TranscriptMessage,
  t as STTProvider,
  u as VoiceAudioFormat
} from "./types-BRlsx4uQ.js";
import { Agent, Connection } from "agents";

//#region src/text-stream.d.ts
/**
 * Utilities for normalising various text-producing sources into a uniform
 * `AsyncGenerator<string>`.  This lets `onTurn()` return any of:
 *
 *   - A plain `string`
 *   - An `AsyncIterable<string>` (e.g. AI SDK `textStream`)
 *   - A `ReadableStream<Uint8Array>` (e.g. a raw `fetch` response body
 *     containing newline-delimited JSON / SSE)
 *   - A `ReadableStream<string>`
 *
 * The generator yields individual text chunks as they become available.
 */
/** Union of every source type that {@link iterateText} accepts. */
type TextSource =
  | string
  | ReadableStream<Uint8Array>
  | ReadableStream<string>
  | AsyncIterable<string>;
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
declare function iterateText(source: TextSource): AsyncGenerator<string>;
//#endregion
//#region src/audio-pipeline.d.ts
/**
 * Manages per-connection audio pipeline state for voice mixins.
 * Owns the Maps/Sets for audio buffers, STT sessions, timers, and abort controllers.
 * Does not own pipeline orchestration — that stays in each mixin.
 */
declare class AudioConnectionManager {
  #private;
  constructor(_logPrefix: string);
  initConnection(connectionId: string): void;
  isInCall(connectionId: string): boolean;
  cleanup(connectionId: string): void;
  bufferAudio(connectionId: string, chunk: ArrayBuffer): void;
  /**
   * Concatenate and clear the audio buffer for a connection.
   * Returns null if no audio or buffer doesn't exist.
   */
  getAndClearAudio(connectionId: string): ArrayBuffer | null;
  clearAudioBuffer(connectionId: string): void;
  pushbackAudio(connectionId: string, audio: ArrayBuffer): void;
  hasSTTSession(connectionId: string): boolean;
  startSTTSession(
    connectionId: string,
    provider: StreamingSTTProvider,
    options: StreamingSTTSessionOptions
  ): void;
  flushSTTSession(connectionId: string): Promise<string>;
  abortSTTSession(connectionId: string): void;
  /** Remove the STT session without aborting (used after provider-driven EOT). */
  removeSTTSession(connectionId: string): void;
  isEOTTriggered(connectionId: string): boolean;
  setEOTTriggered(connectionId: string): void;
  clearEOT(connectionId: string): void;
  /**
   * Abort any in-flight pipeline and create a new AbortController.
   * Returns the new AbortSignal.
   */
  createPipelineAbort(connectionId: string): AbortSignal;
  abortPipeline(connectionId: string): void;
  clearPipelineAbort(connectionId: string): void;
  scheduleVadRetry(
    connectionId: string,
    callback: () => void,
    retryMs: number
  ): void;
  clearVadRetry(connectionId: string): void;
}
//#endregion
//#region src/voice-input.d.ts
/** Configuration options for the voice input mixin. */
interface VoiceInputAgentOptions {
  /** Minimum audio bytes to process (16kHz mono 16-bit). @default 16000 (0.5s) */
  minAudioBytes?: number;
  /** VAD probability threshold — only used when `vad` is set. @default 0.5 */
  vadThreshold?: number;
  /** Seconds of audio to push back to buffer when VAD rejects. @default 2 */
  vadPushbackSeconds?: number;
  /** Milliseconds to wait after VAD rejects before retrying without VAD. @default 3000 */
  vadRetryMs?: number;
}
type Constructor$1<T = object> = new (...args: any[]) => T;
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
declare function withVoiceInput<TBase extends Constructor$1>(
  Base: TBase,
  voiceInputOptions?: VoiceInputAgentOptions
): {
  new (...args: any[]): {
    /** Speech-to-text provider (batch). Required unless streamingStt is set. */ stt?: STTProvider /** Streaming speech-to-text provider. Optional — if set, used instead of batch `stt`. */;
    streamingStt?: StreamingSTTProvider /** Voice activity detection provider. Optional. */;
    vad?: VADProvider;
    "__#private@#cm": AudioConnectionManager;
    /**
     * Called after each utterance is transcribed.
     * Override this to process the transcript (e.g. save to storage,
     * trigger a search, or forward to another service).
     *
     * @param text - The transcribed text.
     * @param connection - The WebSocket connection that sent the audio.
     */
    onTranscript(_text: string, _connection: Connection): void | Promise<void>;
    /**
     * Called before accepting a call. Return `false` to reject.
     */
    beforeCallStart(_connection: Connection): boolean | Promise<boolean>;
    onCallStart(_connection: Connection): void | Promise<void>;
    onCallEnd(_connection: Connection): void | Promise<void>;
    onInterrupt(_connection: Connection): void | Promise<void>;
    /**
     * Hook to transform audio before STT. Return null to skip this utterance.
     */
    beforeTranscribe(
      audio: ArrayBuffer,
      _connection: Connection
    ): ArrayBuffer | null | Promise<ArrayBuffer | null>;
    /**
     * Hook to transform or filter the transcript after STT.
     * Return null to discard this utterance.
     */
    afterTranscribe(
      transcript: string,
      _connection: Connection
    ): string | null | Promise<string | null>;
    "__#private@#handleStartOfSpeech"(connection: Connection): void;
    "__#private@#handleStartCall"(connection: Connection): Promise<void>;
    "__#private@#handleEndCall"(connection: Connection): void;
    "__#private@#handleInterrupt"(connection: Connection): void;
    "__#private@#handleEndOfSpeech"(
      connection: Connection,
      skipVad?: boolean
    ): Promise<void>;
    /**
     * Send the user transcript to the client and call the onTranscript hook.
     * Then immediately return to listening — no LLM/TTS pipeline.
     */
    "__#private@#emitTranscript"(
      connection: Connection,
      text: string
    ): Promise<void>;
  };
  "__#private@#VOICE_MESSAGES": Set<string>;
} & TBase;
//#endregion
//#region src/sentence-chunker.d.ts
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
declare class SentenceChunker {
  #private;
  /**
   * Add a chunk of text (e.g. a streamed LLM token).
   * Returns an array of complete sentences extracted from the buffer.
   * May return 0, 1, or multiple sentences depending on the input.
   */
  add(text: string): string[];
  /**
   * Flush any remaining text in the buffer as a final sentence.
   * Call this when the LLM stream ends.
   * Returns the remaining text (trimmed), or an empty array if nothing is left.
   */
  flush(): string[];
  /**
   * Reset the chunker, discarding any buffered text.
   */
  reset(): void;
}
//#endregion
//#region src/sfu-utils.d.ts
/**
 * Pure utility functions for the Cloudflare Realtime SFU integration.
 *
 * Extracted from sfu.ts for testability. These handle:
 * - Protobuf varint encoding/decoding
 * - SFU WebSocket adapter protobuf packet encoding/decoding
 * - Audio format conversion (48kHz stereo ↔ 16kHz mono)
 */
declare function decodeVarint(
  buf: Uint8Array,
  offset: number
): {
  value: number;
  bytesRead: number;
};
declare function encodeVarint(value: number): Uint8Array;
/** Extract the PCM payload from a protobuf Packet message. */
declare function extractPayloadFromProtobuf(
  data: ArrayBuffer
): Uint8Array | null;
/** Encode PCM payload into a protobuf Packet message (for ingest/buffer mode — just payload). */
declare function encodePayloadToProtobuf(payload: Uint8Array): ArrayBuffer;
/** Downsample 48kHz stereo interleaved PCM to 16kHz mono PCM (both 16-bit LE). */
declare function downsample48kStereoTo16kMono(
  stereo48k: Uint8Array
): ArrayBuffer;
/** Upsample 16kHz mono PCM to 48kHz stereo interleaved PCM (both 16-bit LE). */
declare function upsample16kMonoTo48kStereo(mono16k: ArrayBuffer): Uint8Array;
interface SFUConfig {
  appId: string;
  apiToken: string;
}
declare function sfuFetch(
  config: SFUConfig,
  path: string,
  body: unknown
): Promise<unknown>;
declare function createSFUSession(config: SFUConfig): Promise<{
  sessionId: string;
}>;
declare function addSFUTracks(
  config: SFUConfig,
  sessionId: string,
  body: unknown
): Promise<unknown>;
declare function renegotiateSFUSession(
  config: SFUConfig,
  sessionId: string,
  sdp: string
): Promise<unknown>;
declare function createSFUWebSocketAdapter(
  config: SFUConfig,
  tracks: unknown[]
): Promise<unknown>;
//#endregion
//#region src/workers-ai-providers.d.ts
/** Convert raw PCM audio to WAV format. Exported for custom providers. */
declare function pcmToWav(
  pcmData: ArrayBuffer,
  sampleRate: number,
  channels: number,
  bitsPerSample: number
): ArrayBuffer;
/** Loose type for the Workers AI binding — avoids hard dependency on @cloudflare/workers-types. */
interface AiLike {
  run(
    model: string,
    input: Record<string, unknown>,
    options?: Record<string, unknown>
  ): Promise<unknown>;
}
interface WorkersAISTTOptions {
  /** STT model name. @default "@cf/deepgram/nova-3" */
  model?: string;
  /** Language code (e.g. "en", "es", "fr"). @default "en" */
  language?: string;
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
declare class WorkersAISTT implements STTProvider {
  #private;
  constructor(ai: AiLike, options?: WorkersAISTTOptions);
  transcribe(audioData: ArrayBuffer, signal?: AbortSignal): Promise<string>;
}
interface WorkersAITTSOptions {
  /** TTS model name. @default "@cf/deepgram/aura-1" */
  model?: string;
  /** TTS speaker voice. @default "asteria" */
  speaker?: string;
}
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
declare class WorkersAITTS implements TTSProvider {
  #private;
  constructor(ai: AiLike, options?: WorkersAITTSOptions);
  synthesize(text: string, signal?: AbortSignal): Promise<ArrayBuffer | null>;
}
interface WorkersAIFluxSTTOptions {
  /** End-of-turn confidence threshold (0.5-0.9). @default 0.7 */
  eotThreshold?: number;
  /**
   * Eager end-of-turn threshold (0.3-0.9). When set, enables
   * EagerEndOfTurn and TurnResumed events for speculative processing.
   */
  eagerEotThreshold?: number;
  /** EOT timeout in milliseconds. @default 5000 */
  eotTimeoutMs?: number;
  /** Keyterms to boost recognition of specialized terminology. */
  keyterms?: string[];
  /** Sample rate in Hz. @default 16000 */
  sampleRate?: number;
}
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
declare class WorkersAIFluxSTT implements StreamingSTTProvider {
  #private;
  constructor(ai: AiLike, options?: WorkersAIFluxSTTOptions);
  createSession(options?: StreamingSTTSessionOptions): StreamingSTTSession;
}
interface WorkersAIVADOptions {
  /** VAD model name. @default "@cf/pipecat-ai/smart-turn-v2" */
  model?: string;
  /** Audio window in seconds (uses last N seconds of audio). @default 2 */
  windowSeconds?: number;
}
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
declare class WorkersAIVAD implements VADProvider {
  #private;
  constructor(ai: AiLike, options?: WorkersAIVADOptions);
  checkEndOfTurn(audioData: ArrayBuffer): Promise<{
    isComplete: boolean;
    probability: number;
  }>;
}
//#endregion
//#region src/voice.d.ts
/** Result from a VAD (Voice Activity Detection) provider. */
interface VADResult {
  isComplete: boolean;
  probability: number;
}
/** Context passed to the `onTurn()` hook. */
interface VoiceTurnContext {
  /**
   * The WebSocket connection that sent the audio.
   * Useful for sending custom JSON messages (e.g. tool progress).
   * WARNING: sending raw binary on this connection will interleave with
   * the TTS audio stream. Use `connection.send(JSON.stringify(...))` only.
   */
  connection: Connection;
  /** Conversation history from SQLite (chronological order). */
  messages: Array<{
    role: VoiceRole;
    content: string;
  }>;
  /** AbortSignal — aborted if user interrupts or disconnects. */
  signal: AbortSignal;
}
/** Configuration options for the voice mixin. Passed to `withVoice()`. */
interface VoiceAgentOptions extends VoiceInputAgentOptions {
  /** Max conversation history messages loaded for context. @default 20 */
  historyLimit?: number;
  /** Audio format used for binary audio payloads sent to the client. @default "mp3" */
  audioFormat?: VoiceAudioFormat;
  /** Max conversation messages to keep in SQLite. Oldest are pruned. @default 1000 */
  maxMessageCount?: number;
}
type Constructor<T = object> = new (...args: any[]) => T;
type AgentLike = Constructor<
  Pick<
    Agent<Cloudflare.Env>,
    | "sql"
    | "getConnections"
    | "_unsafe_getConnectionFlag"
    | "_unsafe_setConnectionFlag"
  >
>;
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
declare function withVoice<TBase extends AgentLike>(
  Base: TBase,
  voiceOptions?: VoiceAgentOptions
): {
  new (...args: any[]): {
    /** Speech-to-text provider (batch). Required unless streamingStt is set. */ stt?: STTProvider /** Streaming speech-to-text provider. Optional — if set, used instead of batch `stt`. */;
    streamingStt?: StreamingSTTProvider /** Text-to-speech provider. Required. May also implement StreamingTTSProvider. */;
    tts?: TTSProvider &
      Partial<StreamingTTSProvider> /** Voice activity detection provider. Optional — if unset, every end_of_speech is treated as confirmed. */;
    vad?: VADProvider;
    "__#private@#cm": AudioConnectionManager;
    "__#private@#setCallState"(connection: Connection, inCall: boolean): void;
    "__#private@#getCallState"(connection: Connection): boolean;
    /**
     * Restore in-memory call state after hibernation wake.
     * Called when we receive a message for a connection that the state
     * says is in a call, but we have no in-memory buffer for it.
     */
    "__#private@#restoreCallState"(connection: Connection): void;
    "__#private@#schemaReady": boolean;
    "__#private@#ensureSchema"(): void;
    onTurn(
      _transcript: string,
      _context: VoiceTurnContext
    ): Promise<TextSource>;
    beforeCallStart(_connection: Connection): boolean | Promise<boolean>;
    onCallStart(_connection: Connection): void | Promise<void>;
    onCallEnd(_connection: Connection): void | Promise<void>;
    onInterrupt(_connection: Connection): void | Promise<void>;
    beforeTranscribe(
      audio: ArrayBuffer,
      _connection: Connection
    ): ArrayBuffer | null | Promise<ArrayBuffer | null>;
    afterTranscribe(
      transcript: string,
      _connection: Connection
    ): string | null | Promise<string | null>;
    beforeSynthesize(
      text: string,
      _connection: Connection
    ): string | null | Promise<string | null>;
    afterSynthesize(
      audio: ArrayBuffer | null,
      _text: string,
      _connection: Connection
    ): ArrayBuffer | null | Promise<ArrayBuffer | null>;
    "__#private@#handleStartOfSpeech"(connection: Connection): void;
    "__#private@#requireTTS"(): TTSProvider & Partial<StreamingTTSProvider>;
    saveMessage(role: "user" | "assistant", text: string): void;
    getConversationHistory(limit?: number): Array<{
      role: VoiceRole;
      content: string;
    }>;
    /**
     * Programmatically end a call for a specific connection.
     * Cleans up server-side state (audio buffers, pipelines, STT sessions,
     * keepalives) and sends the idle status to the client.
     * Use this to kick a speaker or enforce call limits.
     */
    forceEndCall(connection: Connection): void;
    speak(connection: Connection, text: string): Promise<void>;
    speakAll(text: string): Promise<void>;
    "__#private@#synthesizeWithHooks"(
      text: string,
      connection: Connection,
      signal?: AbortSignal
    ): Promise<ArrayBuffer | null>;
    "__#private@#handleStartCall"(
      connection: Connection,
      _preferredFormat?: string
    ): Promise<void>;
    "__#private@#handleEndCall"(connection: Connection): void;
    "__#private@#handleInterrupt"(connection: Connection): void;
    "__#private@#handleTextMessage"(
      connection: Connection,
      text: string
    ): Promise<void>;
    "__#private@#handleEndOfSpeech"(
      connection: Connection,
      skipVad?: boolean
    ): Promise<void>;
    /**
     * Start the voice pipeline from a stable transcript.
     * Called by provider-driven EOT (onEndOfTurn callback).
     * Handles: abort controller setup, LLM, TTS, metrics, persistence.
     */
    "__#private@#runPipeline"(
      connection: Connection,
      transcript: string
    ): Promise<void>;
    /**
     * Shared inner pipeline: save transcript, run LLM, stream TTS, emit metrics.
     * Used by both #handleEndOfSpeech (after STT) and #runPipeline (after provider EOT).
     */
    "__#private@#runPipelineInner"(
      connection: Connection,
      userText: string,
      pipelineStart: number,
      vadMs: number,
      sttMs: number,
      signal: AbortSignal
    ): Promise<void>;
    "__#private@#streamResponse"(
      connection: Connection,
      response: TextSource,
      llmStart: number,
      pipelineStart: number,
      signal: AbortSignal
    ): Promise<{
      text: string;
      llmMs: number;
      ttsMs: number;
      firstAudioMs: number;
    }>;
    "__#private@#streamingTTSPipeline"(
      connection: Connection,
      tokenStream: AsyncIterable<string>,
      llmStart: number,
      pipelineStart: number,
      signal: AbortSignal
    ): Promise<{
      text: string;
      llmMs: number;
      ttsMs: number;
      firstAudioMs: number;
    }>;
    "__#private@#sendJSON"(connection: Connection, data: unknown): void;
    sql: <T = Record<string, string | number | boolean | null>>(
      strings: TemplateStringsArray,
      ...values: (string | number | boolean | null)[]
    ) => T[];
    getConnections: <TState = unknown>(
      tag?: string
    ) => Iterable<Connection<TState>>;
    _unsafe_getConnectionFlag: (connection: Connection, key: string) => unknown;
    _unsafe_setConnectionFlag: (
      connection: Connection,
      key: string,
      value: unknown
    ) => void;
  };
  "__#private@#VOICE_MESSAGES": Set<string>;
} & TBase;
//#endregion
export {
  type SFUConfig,
  type STTProvider,
  SentenceChunker,
  type StreamingSTTProvider,
  type StreamingSTTSession,
  type StreamingSTTSessionOptions,
  type StreamingTTSProvider,
  type TTSProvider,
  type TextSource,
  type TranscriptMessage,
  type VADProvider,
  VADResult,
  VOICE_PROTOCOL_VERSION,
  VoiceAgentOptions,
  type VoiceAudioFormat,
  type VoiceAudioInput,
  type VoiceClientMessage,
  type VoiceInputAgentOptions,
  type VoicePipelineMetrics,
  type VoiceRole,
  type VoiceServerMessage,
  type VoiceStatus,
  type VoiceTransport,
  VoiceTurnContext,
  WorkersAIFluxSTT,
  type WorkersAIFluxSTTOptions,
  WorkersAISTT,
  type WorkersAISTTOptions,
  WorkersAITTS,
  type WorkersAITTSOptions,
  WorkersAIVAD,
  type WorkersAIVADOptions,
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
//# sourceMappingURL=voice.d.ts.map
