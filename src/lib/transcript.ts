import type { Marker, Recording, Segment, TimestampMode } from "../types";
import { timestampFormatter } from "./time";

/** 開始時刻順に並べ、空の区間を除く。 */
export function normalizeSegments(segments: Segment[]): Segment[] {
  return segments
    .filter((s) => s.text.trim().length > 0)
    .slice()
    .sort((a, b) => a.start - b.start);
}

export function sortMarkers(markers: Marker[]): Marker[] {
  return markers.slice().sort((a, b) => a.time - b.time);
}

/**
 * "[00:01:23] 発言内容" の行を並べたテキスト。
 * 要約プロンプト、テキスト出力、クリップボードコピーで共通に使う。
 */
export function transcriptLines(rec: Recording, mode: TimestampMode): string[] {
  const fmt = timestampFormatter(mode, rec.createdAt, rec.pauses, true);
  return normalizeSegments(rec.segments).map((s) => `[${fmt(s.start)}] ${s.text.trim()}`);
}

export function markerLines(rec: Recording, mode: TimestampMode): string[] {
  const fmt = timestampFormatter(mode, rec.createdAt, rec.pauses, true);
  return sortMarkers(rec.markers).map((m) => `[${fmt(m.time)}] ${m.note.trim() || "マーカー"}`);
}

/** 区間の中で、指定時刻に再生中のものの添字（無ければ -1）。 */
export function activeSegmentIndex(segments: Segment[], time: number): number {
  let idx = -1;
  for (let i = 0; i < segments.length; i++) {
    if (segments[i].start <= time + 0.05) idx = i;
    else break;
  }
  if (idx >= 0) {
    const s = segments[idx];
    const next = segments[idx + 1];
    // 次の区間が始まるまで、または終了時刻から少しの間は強調表示を続ける
    const until = Math.max(s.end, next ? Math.min(next.start, s.end + 5) : s.end + 5);
    if (time > until) return -1;
  }
  return idx;
}
