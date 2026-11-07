import { describe, expect, it } from "vitest";
import { encodeWav, extensionFor, planChunks } from "../src/lib/audio";
import { buildSummaryPrompt } from "../src/lib/summarize";
import { sampleRecording } from "./fixtures";

describe("audio helpers", () => {
  it("encodes 16-bit mono WAV", async () => {
    const wav = encodeWav(new Float32Array([0, 1, -1, 0.5, 2]), 16000);
    const view = new DataView(await wav.arrayBuffer());
    const str = (o: number) => String.fromCharCode(...[0, 1, 2, 3].map((i) => view.getUint8(o + i)));
    expect(wav.size).toBe(44 + 5 * 2);
    expect(str(0)).toBe("RIFF");
    expect(str(8)).toBe("WAVE");
    expect(view.getUint32(24, true)).toBe(16000);
    expect(view.getUint32(40, true)).toBe(10);
    expect(view.getInt16(46, true)).toBe(32767);
    expect(view.getInt16(48, true)).toBe(-32768);
    expect(view.getInt16(52, true)).toBe(32767); // 範囲外はクリップ
  });

  it("splits audio into chunks", () => {
    expect(planChunks(25, 10)).toEqual([
      { start: 0, end: 10 },
      { start: 10, end: 20 },
      { start: 20, end: 25 },
    ]);
    expect(planChunks(0, 10)).toEqual([]);
    expect(() => planChunks(10, 0)).toThrow();
  });

  it("chooses upload file extensions", () => {
    expect(extensionFor("audio/webm;codecs=opus")).toBe("webm");
    expect(extensionFor("audio/mp4")).toBe("m4a");
    expect(extensionFor("audio/ogg;codecs=opus")).toBe("ogg");
  });
});

describe("summary prompt", () => {
  it("includes metadata, markers, transcript and the extra instruction", () => {
    const prompt = buildSummaryPrompt(sampleRecording(), "elapsed", "  顧客の要望を中心に ");
    expect(prompt).toContain("録音タイトル: 定例ミーティング");
    expect(prompt).toContain("<markers>\n[00:00:02] マーカー\n[00:01:12] 日程決定\n</markers>");
    expect(prompt).toContain("<transcript>\n[00:00:01] それでは会議を始めます。\n[00:01:10] 次回は金曜日に集まります。\n[01:01:40] お疲れさまでした。\n</transcript>");
    expect(prompt).toContain("要約にあたっての追加の指示: 顧客の要望を中心に");
  });

  it("omits the instruction line when empty", () => {
    const prompt = buildSummaryPrompt(sampleRecording({ markers: [] }), "elapsed", "   ");
    expect(prompt).not.toContain("追加の指示");
    expect(prompt).toContain("<markers>\n（なし）\n</markers>");
  });
});
