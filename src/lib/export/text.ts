import type { Recording, TimestampMode } from "../../types";
import { LOCAL_SUMMARY_LABEL } from "../localSummary";
import { markdownToPlain } from "../markdown";
import { formatDateTime, formatDurationJa, formatSrtTime } from "../time";
import { markerLines, normalizeSegments, transcriptLines } from "../transcript";

const SOURCE_LABEL: Record<Recording["transcriptSource"], string> = {
  none: "なし",
  live: "ブラウザ音声認識（リアルタイム）",
  whisper: "OpenAI Whisper",
};

export function summaryLabel(rec: Recording): string {
  if (!rec.summary) return "";
  return rec.summary.kind === "local" ? LOCAL_SUMMARY_LABEL : `Claude（${rec.summary.model}）`;
}

export function metaLines(rec: Recording): [string, string][] {
  const lines: [string, string][] = [
    ["録音日時", formatDateTime(rec.createdAt)],
    ["録音時間", formatDurationJa(rec.duration)],
    ["文字起こし", SOURCE_LABEL[rec.transcriptSource]],
  ];
  if (rec.summary) lines.push(["要約", summaryLabel(rec)]);
  return lines;
}

/** Markdown ドキュメント（要約・マーカー・タイムスタンプ付き文字起こし）。 */
export function toMarkdown(rec: Recording, mode: TimestampMode): string {
  const out: string[] = [`# ${rec.title}`, ""];
  for (const [k, v] of metaLines(rec)) out.push(`- **${k}**: ${v}`);
  out.push("");
  if (rec.summary) {
    out.push("## 要約", "");
    // 要約内の見出しを 1 段下げて、ドキュメント全体の構造に合わせる
    out.push(rec.summary.text.replace(/^(#{1,5})(\s)/gm, "#$1$2"), "");
  }
  const markers = markerLines(rec, mode);
  if (markers.length) {
    out.push("## マーカー", "", ...markers.map((l) => `- ${l}`), "");
  }
  out.push("## 文字起こし", "");
  const lines = transcriptLines(rec, mode);
  out.push(...(lines.length ? lines.map((l) => `${l}  `) : ["（文字起こしはありません）"]), "");
  return out.join("\n");
}

/** プレーンテキスト。 */
export function toPlainText(rec: Recording, mode: TimestampMode): string {
  const out: string[] = [rec.title, "=".repeat(Math.min(40, Math.max(10, rec.title.length * 2))), ""];
  for (const [k, v] of metaLines(rec)) out.push(`${k}: ${v}`);
  out.push("");
  if (rec.summary) out.push("■ 要約", markdownToPlain(rec.summary.text), "");
  const markers = markerLines(rec, mode);
  if (markers.length) out.push("■ マーカー", ...markers, "");
  out.push("■ 文字起こし");
  const lines = transcriptLines(rec, mode);
  out.push(...(lines.length ? lines : ["（文字起こしはありません）"]), "");
  return out.join("\n");
}

/** SRT 字幕。動画編集ソフトや再生ソフトで、音声と文字を同期して表示できる。 */
export function toSrt(rec: Recording): string {
  const segs = normalizeSegments(rec.segments);
  return segs
    .map((s, i) => {
      // 終了時刻が開始以前、または長すぎる場合は表示時間を補正する
      const nextStart = segs[i + 1]?.start ?? Infinity;
      let end = s.end > s.start ? s.end : s.start + 3;
      end = Math.min(end, nextStart > s.start ? nextStart : end);
      return `${i + 1}\n${formatSrtTime(s.start)} --> ${formatSrtTime(end)}\n${s.text.trim()}\n`;
    })
    .join("\n");
}
