import type { Marker, Recording, Segment, Settings } from "../types";
import { extensionFor } from "./audio";
import { addRecording } from "./db";
import { downloadBlob, safeFileName } from "./export/save";
import { newId } from "./id";
import { isLiveTranscriptionSupported, LiveTranscriber } from "./liveTranscriber";
import { AudioRecorder } from "./recorder";
import { formatDateTime } from "./time";
import { normalizeSegments } from "./transcript";

export type SessionState = "idle" | "recording" | "paused" | "saving";

/**
 * 録音中の状態をアプリ全体で 1 つだけ持つ。
 * 画面（タブ）を切り替えても録音が止まらないよう、画面とは独立させている。
 */
class RecordingSession {
  state: SessionState = "idle";
  segments: Segment[] = [];
  interim = "";
  markers: Marker[] = [];
  liveActive = false;
  liveNotice = "";

  private recorder: AudioRecorder | null = null;
  private live: LiveTranscriber | null = null;
  private language = "ja-JP";
  private listeners = new Set<() => void>();
  private wakeLock: { release(): Promise<void> } | null = null;

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  elapsed(): number {
    return this.recorder?.elapsed() ?? 0;
  }

  level(): number {
    return this.recorder?.level() ?? 0;
  }

  async start(settings: Settings): Promise<void> {
    if (this.state !== "idle") return;
    this.segments = [];
    this.interim = "";
    this.markers = [];
    this.liveNotice = "";
    this.language = settings.language;
    const recorder = new AudioRecorder();
    await recorder.start(); // マイクの許可が無い場合はここで例外
    this.recorder = recorder;
    this.state = "recording";

    this.liveActive = settings.liveTranscription && isLiveTranscriptionSupported();
    if (this.liveActive) {
      this.live = new LiveTranscriber(settings.language, () => recorder.elapsed(), {
        onUpdate: (segments, interim) => {
          this.segments = segments;
          this.interim = interim;
          this.emit();
        },
        onFatal: (message) => {
          this.liveActive = false;
          this.liveNotice = message;
          this.interim = "";
          this.emit();
        },
      });
      this.live.start();
    }
    void this.acquireWakeLock();
    document.addEventListener("visibilitychange", this.onVisibility);
    this.emit();
  }

  pause(): void {
    if (this.state !== "recording") return;
    this.recorder?.pause();
    this.live?.pause();
    this.interim = "";
    this.state = "paused";
    this.emit();
  }

  resume(): void {
    if (this.state !== "paused") return;
    this.recorder?.resume();
    if (this.liveActive) this.live?.resume();
    this.state = "recording";
    this.emit();
  }

  addMarker(note = ""): Marker | null {
    if (this.state !== "recording" && this.state !== "paused") return null;
    const marker = { id: newId(), time: this.elapsed(), note };
    this.markers.push(marker);
    this.emit();
    return marker;
  }

  updateMarker(id: string, note: string): void {
    const m = this.markers.find((x) => x.id === id);
    if (m) m.note = note;
  }

  removeMarker(id: string): void {
    this.markers = this.markers.filter((x) => x.id !== id);
    this.emit();
  }

  /** 録音を終了して保存し、保存した録音を返す。 */
  async stop(): Promise<Recording> {
    if (!this.recorder || (this.state !== "recording" && this.state !== "paused")) {
      throw new Error("録音していません");
    }
    this.state = "saving";
    this.emit();
    try {
      const [result, liveSegments] = await Promise.all([
        this.recorder.stop(),
        this.live ? this.live.stop() : Promise.resolve([] as Segment[]),
      ]);
      const segments = normalizeSegments(liveSegments);
      const rec: Recording = {
        id: newId(),
        title: `録音 ${formatDateTime(result.startedAt)}`,
        createdAt: result.startedAt,
        duration: result.duration,
        mimeType: result.mimeType,
        language: this.language,
        pauses: result.pauses,
        segments,
        transcriptSource: segments.length ? "live" : "none",
        markers: this.markers.slice().sort((a, b) => a.time - b.time),
      };
      try {
        await addRecording(rec, result.blob);
      } catch {
        // 保存できなかった（容量不足など）場合でも録音を失わないよう、音声をダウンロードさせる
        downloadBlob(result.blob, `${safeFileName(rec.title)}.${extensionFor(result.mimeType)}`);
        throw new Error("録音をアプリ内に保存できなかったため、音声ファイルとしてダウンロードしました。");
      }
      // ブラウザが容量不足時に自動削除しないよう、永続化をお願いしておく
      void navigator.storage?.persist?.().catch(() => false);
      return rec;
    } finally {
      this.reset();
    }
  }

  /** 保存せずに破棄する。 */
  discard(): void {
    this.recorder?.cancel();
    void this.live?.stop();
    this.reset();
  }

  private reset() {
    this.recorder = null;
    this.live = null;
    this.state = "idle";
    this.segments = [];
    this.interim = "";
    this.markers = [];
    this.liveActive = false;
    document.removeEventListener("visibilitychange", this.onVisibility);
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
    this.emit();
  }

  // 録音中に画面が消えないようにする（対応ブラウザのみ）
  private async acquireWakeLock() {
    try {
      const wl = (navigator as Navigator & { wakeLock?: { request(type: "screen"): Promise<{ release(): Promise<void> }> } })
        .wakeLock;
      if (wl) this.wakeLock = await wl.request("screen");
    } catch {
      // 省電力モードなどで取得できない場合は無視
    }
  }

  private onVisibility = () => {
    if (document.visibilityState === "visible" && (this.state === "recording" || this.state === "paused")) {
      void this.acquireWakeLock();
    }
  };
}

export const session = new RecordingSession();
