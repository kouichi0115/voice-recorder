import type { PauseSpan } from "../types";

// ブラウザごとに使える形式が違う（Chrome/Firefox: webm、Safari: mp4）
const MIME_CANDIDATES = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4;codecs=mp4a.40.2",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  return MIME_CANDIDATES.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

export function isRecordingSupported(): boolean {
  return typeof MediaRecorder !== "undefined" && !!navigator.mediaDevices?.getUserMedia;
}

export interface RecordingResult {
  blob: Blob;
  mimeType: string;
  duration: number;
  startedAt: number;
  pauses: PauseSpan[];
}

type State = "inactive" | "recording" | "paused";

/**
 * MediaRecorder のラッパー。一時停止中は進まない経過時間（秒）と入力レベルを提供する。
 */
export class AudioRecorder {
  state: State = "inactive";
  startedAt = 0;

  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private audioCtx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private levelBuf: Uint8Array<ArrayBuffer> | null = null;

  private accumulated = 0; // 直前の一時停止までに録音した秒数
  private segmentStart = 0; // 現在の録音区間の開始（performance.now）
  private pauseStartedWall = 0;
  private pauses: PauseSpan[] = [];

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
    const mimeType = pickMimeType();
    this.recorder = new MediaRecorder(this.stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: 48_000,
    });
    this.chunks = [];
    this.recorder.ondataavailable = (e) => {
      if (e.data.size > 0) this.chunks.push(e.data);
    };
    // 1秒ごとにデータを受け取り、長時間録音でもメモリ上に溜め込みすぎないようにする
    this.recorder.start(1000);

    this.setupAnalyser(this.stream);
    this.startedAt = Date.now();
    this.accumulated = 0;
    this.pauses = [];
    this.segmentStart = performance.now();
    this.state = "recording";
  }

  pause(): void {
    if (this.state !== "recording" || !this.recorder) return;
    this.recorder.pause();
    this.accumulated += (performance.now() - this.segmentStart) / 1000;
    this.pauseStartedWall = Date.now();
    this.state = "paused";
  }

  resume(): void {
    if (this.state !== "paused" || !this.recorder) return;
    this.recorder.resume();
    this.pauses.push({ at: this.accumulated, ms: Date.now() - this.pauseStartedWall });
    this.segmentStart = performance.now();
    this.state = "recording";
  }

  /** 録音開始からの経過秒（一時停止中は止まる）。 */
  elapsed(): number {
    if (this.state === "recording") {
      return this.accumulated + (performance.now() - this.segmentStart) / 1000;
    }
    return this.accumulated;
  }

  /** 入力音量 0〜1。 */
  level(): number {
    if (!this.analyser || !this.levelBuf || this.state !== "recording") return 0;
    this.analyser.getByteTimeDomainData(this.levelBuf);
    let sum = 0;
    for (const v of this.levelBuf) {
      const x = (v - 128) / 128;
      sum += x * x;
    }
    return Math.min(1, Math.sqrt(sum / this.levelBuf.length) * 3);
  }

  async stop(): Promise<RecordingResult> {
    const recorder = this.recorder;
    if (!recorder || this.state === "inactive") throw new Error("録音していません");
    if (this.state === "paused") this.resume();
    const duration = this.elapsed();

    const stopped = new Promise<void>((resolve) => {
      recorder.onstop = () => resolve();
    });
    recorder.stop();
    await stopped;

    const mimeType = recorder.mimeType || this.chunks[0]?.type || "audio/webm";
    const blob = new Blob(this.chunks, { type: mimeType });
    const result: RecordingResult = {
      blob,
      mimeType,
      duration,
      startedAt: this.startedAt,
      pauses: this.pauses,
    };
    this.cleanup();
    return result;
  }

  /** 録音を破棄する（画面離脱時など）。 */
  cancel(): void {
    if (this.recorder && this.recorder.state !== "inactive") this.recorder.stop();
    this.cleanup();
  }

  private setupAnalyser(stream: MediaStream) {
    try {
      this.audioCtx = new AudioContext();
      const src = this.audioCtx.createMediaStreamSource(stream);
      this.analyser = this.audioCtx.createAnalyser();
      this.analyser.fftSize = 1024;
      src.connect(this.analyser);
      this.levelBuf = new Uint8Array(new ArrayBuffer(this.analyser.fftSize));
    } catch {
      // レベルメーターは補助機能なので、失敗しても録音は続ける
      this.analyser = null;
    }
  }

  private cleanup() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.audioCtx?.close().catch(() => {});
    this.stream = null;
    this.recorder = null;
    this.audioCtx = null;
    this.analyser = null;
    this.chunks = [];
    this.state = "inactive";
  }
}
