import type { PauseSpan, TimestampMode } from "../types";

const pad = (n: number, len = 2) => String(n).padStart(len, "0");

/** 経過秒を "MM:SS" または "H:MM:SS" に整形する。 */
export function formatElapsed(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

/** 経過秒を常に "HH:MM:SS" で返す（ドキュメント出力・要約プロンプト用）。 */
export function formatElapsedLong(seconds: number): string {
  const total = Math.max(0, Math.floor(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

/** SRT 字幕形式 "HH:MM:SS,mmm"。 */
export function formatSrtTime(seconds: number): string {
  const ms = Math.max(0, Math.round(seconds * 1000));
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  const s = Math.floor((ms % 60_000) / 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
}

/**
 * 経過秒を実際の時刻（エポックミリ秒）に変換する。
 * 一時停止していた時間はタイムスタンプに含まれないため、その分を足し戻す。
 */
export function elapsedToEpoch(createdAt: number, seconds: number, pauses: PauseSpan[]): number {
  let pausedMs = 0;
  for (const p of pauses) {
    if (p.at <= seconds) pausedMs += p.ms;
  }
  return createdAt + seconds * 1000 + pausedMs;
}

/** 時刻を "HH:MM:SS"（ローカル時刻）で返す。 */
export function formatClock(epochMs: number): string {
  const d = new Date(epochMs);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** 日時を "2026/11/07 14:03" 形式で返す。 */
export function formatDateTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getFullYear()}/${pad(d.getMonth() + 1)}/${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** 録音時間を "1時間2分3秒" のような読みやすい形にする。 */
export function formatDurationJa(seconds: number): string {
  const total = Math.max(0, Math.round(seconds));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  let out = "";
  if (h > 0) out += `${h}時間`;
  if (m > 0) out += `${m}分`;
  if (s > 0 || total === 0) out += `${s}秒`;
  return out;
}

/** 表示モードに応じたタイムスタンプ文字列を作る関数を返す。 */
export function timestampFormatter(
  mode: TimestampMode,
  createdAt: number,
  pauses: PauseSpan[],
  long = false,
): (seconds: number) => string {
  if (mode === "clock") {
    return (s) => formatClock(elapsedToEpoch(createdAt, s, pauses));
  }
  return long ? formatElapsedLong : formatElapsed;
}
