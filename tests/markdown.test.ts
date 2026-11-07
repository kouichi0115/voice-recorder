import { describe, expect, it } from "vitest";
import { escapeHtml, markdownToHtml, markdownToPlain, parseInline, parseMarkdown } from "../src/lib/markdown";

describe("markdown", () => {
  it("parses inline bold and code", () => {
    expect(parseInline("予算は **100万円** で `確定`")).toEqual([
      { text: "予算は " },
      { text: "100万円", bold: true },
      { text: " で " },
      { text: "確定", code: true },
    ]);
  });

  it("parses headings, lists, checkboxes and paragraphs", () => {
    const blocks = parseMarkdown("## 概要\n一行目\n二行目\n\n- 項目A\n  - 子項目\n- [x] 完了\n- [ ] 未完了\n\n1. 最初\n2) 次\n---\n### 終わり");
    expect(blocks.map((b) => b.type)).toEqual([
      "heading", "paragraph", "bullet", "bullet", "bullet", "bullet", "numbered", "numbered", "heading",
    ]);
    expect(blocks[0]).toMatchObject({ type: "heading", level: 2 });
    expect(blocks[1].runs[0].text).toBe("一行目 二行目");
    expect(blocks[3]).toMatchObject({ type: "bullet", level: 1 });
    expect(blocks[4].runs[0].text).toBe("☑ 完了");
    expect(blocks[5].runs[0].text).toBe("☐ 未完了");
    expect(blocks[7]).toMatchObject({ type: "numbered", number: 2 });
  });

  it("escapes HTML so transcript text cannot inject markup", () => {
    const html = markdownToHtml('- <img src=x onerror="alert(1)"> **<b>太字</b>**');
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).toContain("<strong>&lt;b&gt;太字&lt;/b&gt;</strong>");
    expect(escapeHtml(`'"&`)).toBe("&#39;&quot;&amp;");
  });

  it("groups list items and shifts headings for display", () => {
    expect(markdownToHtml("## 見出し\n- a\n- b\n\n本文")).toBe(
      "<h3>見出し</h3>\n<ul>\n<li class=\"lv0\">a</li>\n<li class=\"lv0\">b</li>\n</ul>\n<p>本文</p>",
    );
  });

  it("converts to plain text", () => {
    expect(markdownToPlain("## 概要\n**大事**な話\n- 項目\n1. 手順")).toBe("【概要】\n大事な話\n・項目\n1. 手順");
  });
});
