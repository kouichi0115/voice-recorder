import { Packer } from "docx";
import { strFromU8, unzipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { buildDocx } from "../src/lib/export/docx";
import { safeFileName } from "../src/lib/export/save";
import { toMarkdown, toPlainText, toSrt } from "../src/lib/export/text";
import { activeSegmentIndex, normalizeSegments, transcriptLines } from "../src/lib/transcript";
import { sampleRecording } from "./fixtures";

describe("transcript helpers", () => {
  it("sorts segments and drops empty ones", () => {
    expect(normalizeSegments(sampleRecording().segments).map((s) => s.id)).toEqual(["s1", "s2", "s3"]);
  });

  it("builds timestamped lines in both modes", () => {
    const rec = sampleRecording();
    expect(transcriptLines(rec, "elapsed")).toEqual([
      "[00:00:01] それでは会議を始めます。",
      "[00:01:10] 次回は金曜日に集まります。",
      "[01:01:40] お疲れさまでした。",
    ]);
    // 時刻表示では、65 秒地点の一時停止（30 秒）以降が 30 秒ずれる
    expect(transcriptLines(rec, "clock")).toEqual([
      "[14:00:01] それでは会議を始めます。",
      "[14:01:40] 次回は金曜日に集まります。",
      "[15:02:10] お疲れさまでした。",
    ]);
  });

  it("finds the segment being played", () => {
    const segs = normalizeSegments(sampleRecording().segments);
    expect(activeSegmentIndex(segs, 0)).toBe(-1);
    expect(activeSegmentIndex(segs, 2)).toBe(0);
    expect(activeSegmentIndex(segs, 72)).toBe(1);
    expect(activeSegmentIndex(segs, 200)).toBe(-1);
    expect(activeSegmentIndex(segs, 3702)).toBe(2);
  });
});

describe("text exports", () => {
  it("creates a Markdown document with summary, markers and transcript", () => {
    const md = toMarkdown(sampleRecording(), "elapsed");
    expect(md).toContain("# 定例ミーティング");
    expect(md).toContain("- **録音時間**: 1時間2分5秒");
    expect(md).toContain("## 要約\n\n### 概要");
    expect(md).toContain("## マーカー\n\n- [00:00:02] マーカー\n- [00:01:12] 日程決定");
    expect(md).toContain("[00:01:10] 次回は金曜日に集まります。  ");
  });

  it("creates plain text without Markdown syntax", () => {
    const txt = toPlainText(sampleRecording({ markers: [] }), "elapsed");
    expect(txt).toContain("■ 要約\n【概要】\n会議の要点です。");
    expect(txt).not.toContain("■ マーカー");
    expect(txt).not.toContain("**");
  });

  it("notes when there is no transcript", () => {
    const txt = toPlainText(sampleRecording({ segments: [], summary: undefined }), "elapsed");
    expect(txt).toContain("（文字起こしはありません）");
  });

  it("creates SRT subtitles with sane end times", () => {
    const rec = sampleRecording({
      segments: [
        { id: "a", start: 1, end: 1, text: "終了時刻なし" },
        { id: "b", start: 2.5, end: 9, text: "重なる区間" },
        { id: "c", start: 5, end: 6, text: "最後" },
      ],
    });
    expect(toSrt(rec)).toBe(
      "1\n00:00:01,000 --> 00:00:02,500\n終了時刻なし\n\n" +
        "2\n00:00:02,500 --> 00:00:05,000\n重なる区間\n\n" +
        "3\n00:00:05,000 --> 00:00:06,000\n最後\n",
    );
  });

  it("makes safe file names", () => {
    expect(safeFileName('会議: 1/2 "案"?')).toBe("会議_ 1_2 _案__");
    expect(safeFileName("   ")).toBe("recording");
  });
});

describe("docx export", () => {
  it("produces a Word file containing all sections", async () => {
    const buf = await Packer.toBuffer(buildDocx(sampleRecording(), "elapsed"));
    expect(buf.subarray(0, 2).toString()).toBe("PK"); // docx は zip 形式
    const xml = strFromU8(unzipSync(new Uint8Array(buf))["word/document.xml"]);
    for (const text of ["定例ミーティング", "要約", "概要", "マーカー", "日程決定", "文字起こし", "[00:01:10]", "次回は金曜日に集まります。", "100万円"]) {
      expect(xml).toContain(text);
    }
  });
});
