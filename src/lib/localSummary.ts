import type { Recording, TimestampMode } from "../types";
import { formatDurationJa, timestampFormatter } from "./time";
import { normalizeSegments, sortMarkers } from "./transcript";

// API キーが無いときに使う、端末内だけで完結する簡易要約。
// AI は使わず、文字起こしから「よく出てくる言葉を多く含む発言」や
// 「決定・依頼の言い回しを含む発言」を抜き出して、Claude の要約と同じ見出し構成にまとめる。

export const LOCAL_SUMMARY_LABEL = "簡易要約（端末内）";

export interface Sentence {
  text: string;
  start: number;
  end: number;
  keywords: string[];
}

// 話し言葉のつなぎ言葉（後ろに読点・空白が続く場合だけ取り除く）
const FILLER_RE =
  /(^|[、。！？\s])(?:えーっと|えっと|えーと|えー+|あのー+|あの(?=[、\s])|そのー+|うーん|うん(?=[、\s])|あー+|まあ(?=[、\s])|まぁ(?=[、\s])|なんか(?=[、\s]))[、,\s]*/g;

export function cleanFillers(text: string): string {
  let prev = "";
  let out = text;
  // 連続したつなぎ言葉にも対応するため、変化がなくなるまで繰り返す
  while (out !== prev) {
    prev = out;
    out = out.replace(FILLER_RE, "$1");
  }
  return out.replace(/\s{2,}/g, " ").trim();
}

/** 区間を文に分ける。各文には元の区間の時刻を引き継ぐ。 */
export function splitSentences(rec: Recording): Sentence[] {
  const out: Sentence[] = [];
  for (const seg of normalizeSegments(rec.segments)) {
    // 日本語は「。！？」、英語は「. 」＋大文字で区切る
    const parts = (seg.text.match(/[^。！？!?\n]+[。！？!?]*/g) ?? [seg.text]).flatMap((p) => p.split(/(?<=\.)\s+(?=[A-Z])/));
    for (const part of parts) {
      const text = cleanFillers(part);
      if (text.replace(/[。、！？!?.,\s]/g, "").length === 0) continue;
      out.push({ text, start: seg.start, end: seg.end, keywords: extractTerms(text) });
    }
  }
  return out;
}

// 漢字・カタカナの連続（複合名詞になりやすい）と、英単語を語として扱う
const TERM_RE = /[\p{Script=Han}々〆ヶ]{2,}|[\p{Script=Katakana}ー]{2,}|[A-Za-z][A-Za-z0-9'-]+/gu;

const STOPWORDS = new Set([
  // 日本語（意味の薄い語）
  "自分", "本当", "一応", "感じ", "結構", "大丈夫", "全然", "全部", "場合", "意味", "以上", "以下",
  "皆様", "皆さん", "一番", "普通", "多分", "確か", "基本", "基本的", "実際", "色々", "何か", "部分",
  "今日", "今回", "時間", "最初", "最後", "前回", "次回", "了解", "決定", "確認", "検討", "対応", "必要", "失礼", "オッケー", "オーケー",
  // 英語
  "the", "and", "for", "that", "this", "with", "you", "are", "was", "have", "but", "not", "they", "our",
  "your", "from", "what", "there", "about", "just", "like", "yeah", "okay", "can", "will", "would",
  "could", "should", "it's", "i'm", "we're", "don't", "going", "think", "know", "really", "very", "also",
  "then", "than", "them", "their", "been", "were", "which", "when", "where", "who", "how", "all", "any",
  "some", "one", "two", "get", "got", "out", "now", "here", "well", "right", "yes", "let's", "that's",
  "into", "more", "want", "need", "make", "say", "said", "thing", "things", "kind", "lot", "because",
]);

/** 文から語（重複なし・小文字化）を取り出す。 */
export function extractTerms(text: string): string[] {
  const terms = new Set<string>();
  for (const m of text.matchAll(TERM_RE)) {
    const raw = m[0];
    if (/^ー+$/.test(raw)) continue;
    if (/^[万億千百十円年月日時分秒個件人回度割]+$/.test(raw)) continue; // 「万円」など単位だけの語
    const isLatin = /^[A-Za-z]/.test(raw);
    // 英語は 3 文字以上（"AI" のような大文字の略語は 2 文字でも可）
    if (isLatin && raw.length < 3 && !/^[A-Z]{2,}$/.test(raw)) continue;
    const term = isLatin && !/^[A-Z0-9]{2,}$/.test(raw) ? raw.toLowerCase() : raw;
    if (!STOPWORDS.has(term.toLowerCase())) terms.add(term);
  }
  return [...terms];
}

const DECISION_RE =
  /決ま(?:り|っ|る|った)|決定|決めま|決めよう|決めた|合意|承認され|承認しま|確定|ことにな(?:り|っ)|ことにしま|ことにする|でいきましょう|で行きましょう|で進め|に決め|方針|\bagreed\b|\bdecided\b|\bdecision\b|\bapproved?\b|\bwe(?:'ll| will) go with\b/i;
const ACTION_RE =
  /お願いし|お願いでき|してください|して下さい|しておいて|までに|やっておき|対応し(?:ます|てお)|確認し(?:ます|てお|ておき)|準備し|宿題|担当|送りま|送っておき|共有し(?:ます|てお)|連絡し(?:ます|てお)|調整し(?:ます|てお)|検討し(?:ます|てお)|作成し(?:ます|てお)|提出|期限|締め切り|〆切|次回まで|\btodo\b|\bto-do\b|action item|\bfollow up\b|\bwill send\b|\bdeadline\b|\bby (?:monday|tuesday|wednesday|thursday|friday|tomorrow|next week)\b/i;
const NUMBER_RE = /\d|[一二三四五六七八九十百千万億]+(?:円|日|月|時|人|件|個|回|割|%)|％|%/;

export function isDecision(text: string): boolean {
  return DECISION_RE.test(text);
}

export function isAction(text: string): boolean {
  return ACTION_RE.test(text);
}

const MAX_CHARS = 120;
const shorten = (s: string) => (s.length > MAX_CHARS ? `${s.slice(0, MAX_CHARS - 1)}…` : s);

function jaccard(a: string[], b: string[]): number {
  if (a.length === 0 && b.length === 0) return 1;
  const sb = new Set(b);
  const inter = a.filter((x) => sb.has(x)).length;
  return inter / (a.length + b.length - inter);
}

/** 語ごとの出現回数（文単位で数える）。 */
export function termFrequencies(sentences: Sentence[]): Map<string, number> {
  const tf = new Map<string, number>();
  for (const s of sentences) for (const k of s.keywords) tf.set(k, (tf.get(k) ?? 0) + 1);
  return tf;
}

/** 録音者がマーカーを付けた時刻に最も近い文（マーカーは聞いた直後に押されやすいので、少し前を優先）。 */
function sentenceNear(sentences: Sentence[], time: number): Sentence | undefined {
  let best: Sentence | undefined;
  let bestCost = Infinity;
  for (const s of sentences) {
    let cost: number;
    if (s.start <= time && time <= Math.max(s.end, s.start + 1)) cost = 0;
    else if (s.start < time) cost = time - Math.max(s.end, s.start); // 前の発言
    else cost = (s.start - time) * 2; // 後の発言は少し不利に
    if (cost < bestCost) {
      bestCost = cost;
      best = s;
    }
  }
  return bestCost <= 30 ? best : undefined;
}

const uniqueByText = (list: Sentence[]) => list.filter((s, i) => list.findIndex((x) => x.text === s.text) === i);

export function localSummary(rec: Recording, mode: TimestampMode): string {
  const fmt = timestampFormatter(mode, rec.createdAt, rec.pauses, true);
  const sentences = splitSentences(rec);
  const tf = termFrequencies(sentences);
  const markers = sortMarkers(rec.markers);

  // 話題のキーワード（2 回以上出てきた語）
  const ranked = [...tf.entries()].sort((a, b) => b[1] - a[1] || b[0].length - a[0].length);
  const topTerms = ranked.filter(([, n]) => n >= 2).slice(0, 8);

  // 文の重要度: 頻出語をどれだけ含むか + 数字・決定・依頼・マーカー付近ならボーナス
  const markerSentences = new Set(markers.map((m) => sentenceNear(sentences, m.time)).filter((x) => x !== undefined));
  const scored = sentences.map((s, index) => {
    const weights = s.keywords.map((k) => ((tf.get(k) ?? 0) >= 2 ? Math.log2(1 + (tf.get(k) ?? 0)) : 0));
    let score = weights.reduce((a, b) => a + b, 0) / Math.sqrt(s.keywords.length + 1);
    if (NUMBER_RE.test(s.text)) score += 0.5;
    if (isDecision(s.text)) score += 1;
    if (isAction(s.text)) score += 0.7;
    if (markerSentences.has(s)) score += 2.5; // 録音者が印を付けた発言
    if (s.text.length < 10) score *= 0.3;
    return { s, score, index };
  });

  const decisions = uniqueByText(sentences.filter((s) => isDecision(s.text))).slice(0, 5);
  const actions = uniqueByText(sentences.filter((s) => isAction(s.text) && !isDecision(s.text))).slice(0, 6);

  // 決定事項・ToDo に載る発言は除き、それ以外から重要そうなものを選ぶ
  const listed = new Set([...decisions, ...actions].map((s) => s.text));
  const count = Math.min(10, Math.max(3, Math.round(sentences.length / 5)));
  const picked: typeof scored = [];
  for (const c of [...scored].sort((a, b) => b.score - a.score || a.index - b.index)) {
    if (picked.length >= count) break;
    if (c.s.text.length < 6 || listed.has(c.s.text)) continue;
    if (picked.some((p) => p.s.text === c.s.text || jaccard(p.s.keywords, c.s.keywords) >= 0.6)) continue;
    picked.push(c);
  }
  picked.sort((a, b) => a.index - b.index);

  const line = (s: Sentence) => `- [${fmt(s.start)}] ${shorten(s.text)}`;
  const none = "（該当する発言は見つかりませんでした）";

  const out: string[] = ["## 概要"];
  const topics = topTerms.slice(0, 5).map(([k]) => `「${k}」`).join("");
  out.push(
    `約${formatDurationJa(rec.duration)}の録音（発言 ${sentences.length} 件）です。` +
      (topics ? `主に${topics}について話されています。` : ""),
    "",
    "## 主なポイント",
    ...(picked.length ? picked.map((p) => line(p.s)) : [none]),
    "",
    "## 決定事項",
    ...(decisions.length ? decisions.map(line) : [none]),
    "",
    "## ToDo・次のアクション",
    ...(actions.length ? actions.map(line) : [none]),
    "",
  );

  if (markers.length) {
    out.push("## マーカー付近の発言");
    for (const m of markers) {
      const s = sentenceNear(sentences, m.time);
      const note = m.note.trim() ? `**${m.note.trim()}**: ` : "";
      out.push(s ? `- [${fmt(s.start)}] ${note}${shorten(s.text)}` : `- [${fmt(m.time)}] ${note}（近くに発言がありません）`);
    }
    out.push("");
  }

  if (topTerms.length) {
    out.push("## キーワード", topTerms.map(([k, n]) => `${k}（${n}）`).join("、"), "");
  }

  out.push("※ 端末内で文字起こしから重要そうな発言を自動で抜き出した簡易要約です（AI は使用していません）。");
  return out.join("\n");
}
