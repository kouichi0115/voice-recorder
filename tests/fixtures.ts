import type { Recording } from "../src/types";

/** テスト用の録音データ。2026/11/07 14:00:00 開始、65秒地点で 30 秒一時停止。 */
export function sampleRecording(overrides: Partial<Recording> = {}): Recording {
  return {
    id: "rec-1",
    title: "定例ミーティング",
    createdAt: new Date(2026, 10, 7, 14, 0, 0).getTime(),
    duration: 3725,
    mimeType: "audio/webm;codecs=opus",
    language: "ja-JP",
    pauses: [{ at: 65, ms: 30_000 }],
    transcriptSource: "whisper",
    segments: [
      { id: "s2", start: 70, end: 75, text: "次回は金曜日に集まります。" },
      { id: "s1", start: 1.2, end: 4.8, text: "それでは会議を始めます。" },
      { id: "s3", start: 3700, end: 3705, text: "お疲れさまでした。" },
      { id: "s4", start: 80, end: 81, text: "   " },
    ],
    markers: [
      { id: "m2", time: 72, note: "日程決定" },
      { id: "m1", time: 2, note: "" },
    ],
    summary: {
      text: "## 概要\n会議の**要点**です。\n\n## 決定事項\n- [00:01:10] 次回は金曜日\n- 予算は `100万円`\n\n1. 資料を送る\n2. 会場を予約",
      model: "claude-opus-5-5",
      createdAt: new Date(2026, 10, 7, 15, 10, 0).getTime(),
    },
    ...overrides,
  };
}
