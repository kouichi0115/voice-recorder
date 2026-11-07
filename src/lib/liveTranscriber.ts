import type { Segment } from "../types";
import { newId } from "./id";

// Web Speech API（ブラウザ標準の音声認識）でリアルタイムに文字起こしする。
// 型定義が標準 DOM に無いため、必要な部分だけ定義している。
interface SpeechRecognitionResultLike {
  readonly isFinal: boolean;
  readonly 0: { transcript: string };
}
interface SpeechRecognitionEventLike {
  readonly resultIndex: number;
  readonly results: { readonly length: number; [i: number]: SpeechRecognitionResultLike };
}
interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: SpeechRecognitionEventLike) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike;

function getCtor(): SpeechRecognitionCtor | undefined {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function isLiveTranscriptionSupported(): boolean {
  return typeof window !== "undefined" && !!getCtor();
}

export interface LiveTranscriberEvents {
  /** 確定した区間が増えた、または途中経過が変わったとき */
  onUpdate(segments: Segment[], interim: string): void;
  /** 継続できないエラー（マイク拒否など） */
  onFatal(message: string): void;
}

/**
 * 音声認識を録音と並行して動かし、確定した発話ごとにタイムスタンプ付きの区間を作る。
 * getTime は録音の経過秒を返す関数（一時停止を考慮した時間軸に揃えるため）。
 */
export class LiveTranscriber {
  readonly segments: Segment[] = [];
  private recognition: SpeechRecognitionLike | null = null;
  private active = false;
  private restartTimer: number | undefined;
  private failures = 0; // 連続して失敗した回数（再接続の間隔を延ばすのに使う）

  constructor(
    private lang: string,
    private getTime: () => number,
    private events: LiveTranscriberEvents,
  ) {}

  start(): void {
    this.active = true;
    this.launch();
  }

  pause(): void {
    this.active = false;
    this.halt();
  }

  resume(): void {
    this.start();
  }

  /** 停止する。停止直前の発話の確定結果が届くのを少し待ってから返す。 */
  async stop(): Promise<Segment[]> {
    this.active = false;
    window.clearTimeout(this.restartTimer);
    const rec = this.recognition;
    this.recognition = null;
    if (rec) {
      await new Promise<void>((resolve) => {
        const timer = window.setTimeout(resolve, 1500);
        rec.onend = () => {
          window.clearTimeout(timer);
          resolve();
        };
        try {
          rec.stop();
        } catch {
          window.clearTimeout(timer);
          resolve();
        }
      });
    }
    return this.segments;
  }

  private launch() {
    const Ctor = getCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    // 認識セッションごとに結果の番号が 0 から振り直されるので、セッション単位で管理する
    const startTimes = new Map<number, number>();
    const emitted = new Set<number>();

    let failed = false;

    rec.onresult = (e) => {
      this.failures = 0;
      const now = this.getTime();
      let interim = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (!startTimes.has(i)) startTimes.set(i, now);
        const text = r[0].transcript.trim();
        if (r.isFinal) {
          if (!emitted.has(i) && text) {
            emitted.add(i);
            const start = startTimes.get(i) ?? now;
            this.segments.push({ id: newId(), start, end: Math.max(now, start), text });
          }
        } else {
          interim += text;
        }
      }
      this.events.onUpdate(this.segments, interim);
    };

    rec.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        this.active = false;
        this.events.onFatal("音声認識が許可されていません。録音は続行します（録音後に Whisper で文字起こしできます）。");
      } else if (e.error === "language-not-supported") {
        this.active = false;
        this.events.onFatal("この言語はブラウザの音声認識に対応していません。");
      }
      if (e.error === "network" || e.error === "audio-capture") failed = true;
      // no-speech / aborted などは onend でそのまま再開する
    };

    // Chrome は無音が続くと認識を自動終了するため、録音中は再開し続ける
    rec.onend = () => {
      if (this.recognition !== rec) return;
      this.recognition = null;
      if (!this.active) return;
      if (failed) this.failures++;
      if (this.failures >= 6) {
        this.active = false;
        this.events.onFatal("音声認識サービスに接続できないため、リアルタイム文字起こしを停止しました。録音は続行します。");
        return;
      }
      const delay = Math.min(5000, 250 * 2 ** this.failures);
      this.restartTimer = window.setTimeout(() => {
        if (this.active) this.launch();
      }, delay);
    };

    this.recognition = rec;
    try {
      rec.start();
    } catch {
      this.recognition = null;
    }
  }

  private halt() {
    window.clearTimeout(this.restartTimer);
    const rec = this.recognition;
    this.recognition = null;
    if (rec) {
      rec.onend = null;
      try {
        rec.stop();
      } catch {
        // すでに停止済み
      }
    }
  }
}
