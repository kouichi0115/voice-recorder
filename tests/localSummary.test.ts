import { describe, expect, it } from "vitest";
import { metaLines, toMarkdown } from "../src/lib/export/text";
import {
  cleanFillers,
  extractTerms,
  isAction,
  isDecision,
  localSummary,
  splitSentences,
} from "../src/lib/localSummary";
import { parseMarkdown } from "../src/lib/markdown";
import type { Recording, Segment } from "../src/types";
import { sampleRecording } from "./fixtures";

let n = 0;
const seg = (start: number, text: string): Segment => ({ id: `x${n++}`, start, end: start + 4, text });

function meeting(overrides: Partial<Recording> = {}): Recording {
  return sampleRecording({
    title: "新商品の打ち合わせ",
    duration: 600,
    pauses: [],
    segments: [
      seg(2, "えー、それでは新商品の打ち合わせを始めます。"),
      seg(10, "まず予算についてですが、広告予算は300万円を想定しています。"),
      seg(25, "あの、予算の内訳は動画広告が中心です。"),
      seg(40, "はい。"),
      seg(55, "新商品のターゲットは20代の女性です。"),
      seg(70, "動画広告はSNS向けに15秒のものを3本作ります。"),
      seg(90, "発売日は4月1日に決定しました。"),
      seg(110, "うーん、価格はまだ検討が必要ですね。"),
      seg(130, "田中さんは来週金曜までに見積もりを送ってください。"),
      seg(150, "佐藤さんはSNS広告の配信スケジュールを確認しておきます。"),
      seg(170, "予算の承認は部長にお願いします。"),
      seg(190, "じゃあ、新商品のパッケージは青色でいくことになりました。"),
      seg(210, "今日はありがとうございました。"),
    ],
    markers: [{ id: "mk", time: 72, note: "動画の本数" }],
    ...overrides,
  });
}

describe("text helpers", () => {
  it("removes filler words but keeps meaningful あの", () => {
    expect(cleanFillers("えー、それでは始めます。")).toBe("それでは始めます。");
    expect(cleanFillers("えっと、あのー、うーん 予算です")).toBe("予算です");
    expect(cleanFillers("あの会社の件です")).toBe("あの会社の件です");
  });

  it("splits segments into sentences that keep the segment time", () => {
    const rec = meeting({ segments: [seg(30, "一つ目です。二つ目です！三つ目")] });
    expect(splitSentences(rec).map((s) => [s.text, s.start])).toEqual([
      ["一つ目です。", 30],
      ["二つ目です！", 30],
      ["三つ目", 30],
    ]);
  });

  it("extracts kanji / katakana compounds and English words", () => {
    expect(extractTerms("広告予算は300万円で、SNS向けのキャンペーンを行います")).toEqual(["広告予算", "SNS", "キャンペーン"]);
    expect(extractTerms("We decided the budget for the AI campaign")).toEqual(["decided", "budget", "AI", "campaign"]);
    expect(extractTerms("本当に大丈夫です")).toEqual([]);
  });

  it("detects decisions and action items", () => {
    expect(isDecision("発売日は4月1日に決定しました")).toBe(true);
    expect(isDecision("青色でいくことになりました")).toBe(true);
    expect(isDecision("We decided to launch in April")).toBe(true);
    expect(isAction("来週金曜までに見積もりを送ってください")).toBe(true);
    expect(isAction("Tom will send the draft by Friday")).toBe(true);
    expect(isAction("今日はいい天気です")).toBe(false);
  });
});

describe("localSummary", () => {
  const md = localSummary(meeting(), "elapsed");
  const section = (title: string) => {
    const start = md.indexOf(`## ${title}`);
    const next = md.indexOf("\n## ", start + 1);
    return md.slice(start, next === -1 ? undefined : next);
  };

  it("has the same sections as the Claude summary", () => {
    const headings = parseMarkdown(md).filter((b) => b.type === "heading").map((b) => b.runs[0].text);
    expect(headings).toEqual(["概要", "主なポイント", "決定事項", "ToDo・次のアクション", "マーカー付近の発言", "キーワード"]);
  });

  it("describes the recording and its main topics", () => {
    expect(section("概要")).toContain("約10分の録音（発言 13 件）です。");
    expect(section("概要")).toContain("「予算」");
    expect(section("概要")).toContain("「新商品」");
  });

  it("picks decisions with timestamps", () => {
    const d = section("決定事項");
    expect(d).toContain("- [00:01:30] 発売日は4月1日に決定しました。");
    expect(d).toContain("[00:03:10] じゃあ、新商品のパッケージは青色でいくことになりました。");
    expect(d).not.toContain("見積もり");
  });

  it("picks action items", () => {
    const t = section("ToDo・次のアクション");
    expect(t).toContain("[00:02:10] 田中さんは来週金曜までに見積もりを送ってください。");
    expect(t).toContain("[00:02:30] 佐藤さんはSNS広告の配信スケジュールを確認しておきます。");
    expect(t).toContain("[00:02:50] 予算の承認は部長にお願いします。");
  });

  it("shows what was said around each marker", () => {
    expect(section("マーカー付近の発言")).toContain("- [00:01:10] **動画の本数**: 動画広告はSNS向けに15秒のものを3本作ります。");
  });

  it("chooses informative points, drops fillers and keeps them in time order", () => {
    const points = section("主なポイント").split("\n").filter((l) => l.startsWith("- "));
    expect(points.length).toBeGreaterThanOrEqual(3);
    expect(points.join("\n")).not.toContain("- [00:00:40] はい。");
    // 決定事項・ToDo に載せた発言は、主なポイントには重ねて出さない
    expect(points.join("\n")).not.toContain("決定しました");
    expect(points.join("\n")).not.toContain("見積もり");
    expect(points.join("\n")).toContain("広告予算は300万円");
    expect(points.join("\n")).not.toMatch(/えー|うーん|あの、/);
    const times = points.map((l) => l.slice(3, 11));
    expect([...times].sort()).toEqual(times);
  });

  it("lists keywords with counts", () => {
    expect(section("キーワード")).toMatch(/予算（\d+）/);
  });

  it("handles a transcript with nothing to extract", () => {
    const tiny = localSummary(meeting({ segments: [seg(1, "はい。"), seg(3, "ええ。")], markers: [] }), "elapsed");
    expect(tiny).toContain("## 決定事項\n（該当する発言は見つかりませんでした）");
    expect(tiny).not.toContain("## マーカー付近の発言");
    expect(tiny).not.toContain("## キーワード");
  });

  it("uses clock time when that display mode is selected", () => {
    const rec = meeting();
    const clock = localSummary(rec, "clock");
    expect(clock).toContain("[14:01:30] 発売日は4月1日に決定しました。");
  });

  it("works for English transcripts", () => {
    const en = localSummary(
      meeting({
        markers: [],
        segments: [
          seg(1, "Let's review the marketing budget for the spring campaign."),
          seg(9, "The campaign budget is fifty thousand dollars."),
          seg(20, "We decided to launch the campaign on April first."),
          seg(30, "Maria will send the campaign schedule by Friday."),
        ],
      }),
      "elapsed",
    );
    expect(en).toContain("「campaign」");
    expect(en).toContain("[00:00:20] We decided to launch the campaign on April first.");
    expect(en).toContain("[00:00:30] Maria will send the campaign schedule by Friday.");
  });

  it("labels the summary type in exported documents", () => {
    const rec = meeting();
    rec.summary = { text: md, kind: "local", model: "簡易要約（端末内）", createdAt: 0 };
    expect(metaLines(rec)).toContainEqual(["要約", "簡易要約（端末内）"]);
    expect(toMarkdown(rec, "elapsed")).toContain("### 決定事項");
    rec.summary = { text: md, model: "claude-opus-5-5", createdAt: 0 };
    expect(metaLines(rec)).toContainEqual(["要約", "Claude（claude-opus-5-5）"]);
  });
});
