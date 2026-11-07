// 要約（Markdown）を画面表示と Word 出力の両方で使うための、最小限の Markdown パーサー。
// 対応: 見出し(#〜######)、箇条書き(- * +)、番号付きリスト、チェックボックス、段落、**太字**、`コード`

export interface InlineRun {
  text: string;
  bold?: boolean;
  code?: boolean;
}

export type Block =
  | { type: "heading"; level: number; runs: InlineRun[] }
  | { type: "bullet"; level: number; runs: InlineRun[] }
  | { type: "numbered"; level: number; number: number; runs: InlineRun[] }
  | { type: "paragraph"; runs: InlineRun[] };

export function parseInline(text: string): InlineRun[] {
  const runs: InlineRun[] = [];
  const re = /\*\*(.+?)\*\*|__(.+?)__|`([^`]+)`/g;
  let last = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m.index > last) runs.push({ text: text.slice(last, m.index) });
    if (m[3] !== undefined) runs.push({ text: m[3], code: true });
    else runs.push({ text: m[1] ?? m[2], bold: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) runs.push({ text: text.slice(last) });
  return runs.filter((r) => r.text.length > 0);
}

const indentLevel = (spaces: string) => Math.min(3, Math.floor(spaces.replace(/\t/g, "  ").length / 2));

export function parseMarkdown(md: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flush = () => {
    if (para.length) {
      blocks.push({ type: "paragraph", runs: parseInline(para.join(" ")) });
      para = [];
    }
  };

  for (const raw of md.replace(/\r\n?/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    if (!line.trim()) {
      flush();
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush(); // 水平線は区切りとして扱う
      continue;
    }
    let m = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*$/.exec(line);
    if (m) {
      flush();
      blocks.push({ type: "heading", level: m[1].length, runs: parseInline(m[2]) });
      continue;
    }
    m = /^(\s*)[-*+]\s+(?:\[([ xX])\]\s+)?(.*)$/.exec(line);
    if (m) {
      flush();
      const box = m[2] === undefined ? "" : m[2].trim() ? "☑ " : "☐ ";
      blocks.push({ type: "bullet", level: indentLevel(m[1]), runs: parseInline(box + m[3]) });
      continue;
    }
    m = /^(\s*)(\d+)[.)]\s+(.*)$/.exec(line);
    if (m) {
      flush();
      blocks.push({ type: "numbered", level: indentLevel(m[1]), number: Number(m[2]), runs: parseInline(m[3]) });
      continue;
    }
    para.push(line.trim());
  }
  flush();
  return blocks;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function runsToHtml(runs: InlineRun[]): string {
  return runs
    .map((r) => {
      const t = escapeHtml(r.text);
      if (r.code) return `<code>${t}</code>`;
      if (r.bold) return `<strong>${t}</strong>`;
      return t;
    })
    .join("");
}

/** ブロック列を HTML に変換する（テキストはすべてエスケープ済み）。 */
export function blocksToHtml(blocks: Block[]): string {
  const out: string[] = [];
  let i = 0;
  while (i < blocks.length) {
    const b = blocks[i];
    if (b.type === "bullet" || b.type === "numbered") {
      // 連続するリスト項目をまとめて、インデントに応じて入れ子にする
      const tag = b.type === "bullet" ? "ul" : "ol";
      out.push(`<${tag}>`);
      while (i < blocks.length && blocks[i].type === b.type) {
        const item = blocks[i] as Extract<Block, { type: "bullet" | "numbered" }>;
        out.push(`<li class="lv${item.level}">${runsToHtml(item.runs)}</li>`);
        i++;
      }
      out.push(`</${tag}>`);
      continue;
    }
    if (b.type === "heading") {
      const level = Math.min(6, b.level + 1); // 画面上では h2 から始める
      out.push(`<h${level}>${runsToHtml(b.runs)}</h${level}>`);
    } else {
      out.push(`<p>${runsToHtml(b.runs)}</p>`);
    }
    i++;
  }
  return out.join("\n");
}

export function markdownToHtml(md: string): string {
  return blocksToHtml(parseMarkdown(md));
}

/** Markdown 記法を取り除いたプレーンテキスト。 */
export function markdownToPlain(md: string): string {
  return parseMarkdown(md)
    .map((b) => {
      const text = b.runs.map((r) => r.text).join("");
      const indent = "  ".repeat("level" in b && b.type !== "heading" ? b.level : 0);
      if (b.type === "heading") return `\n【${text}】`;
      if (b.type === "bullet") return `${indent}・${text}`;
      if (b.type === "numbered") return `${indent}${b.number}. ${text}`;
      return text;
    })
    .join("\n")
    .trim();
}
