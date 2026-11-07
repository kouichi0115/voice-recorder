import type { AppContext } from "../app";
import { listRecordings } from "../lib/db";
import { clear, h, icon } from "../lib/dom";
import { formatDateTime, formatElapsed } from "../lib/time";
import type { Recording } from "../types";

function matches(rec: Recording, q: string): boolean {
  if (!q) return true;
  const needle = q.toLowerCase();
  return (
    rec.title.toLowerCase().includes(needle) ||
    rec.segments.some((s) => s.text.toLowerCase().includes(needle)) ||
    (rec.summary?.text.toLowerCase().includes(needle) ?? false)
  );
}

export function renderList(root: HTMLElement, ctx: AppContext): () => void {
  const listEl = h("ul", { class: "rec-list" });
  const search = h("input", {
    type: "search",
    class: "search",
    placeholder: "タイトル・文字起こし・要約を検索",
    "aria-label": "録音を検索",
  });
  root.append(
    h("section", { class: "view" },
      h("header", { class: "page-head" }, h("h1", null, "録音一覧")),
      h("div", { class: "search-wrap" }, icon("search", 18), search),
      listEl,
    ),
  );

  let all: Recording[] = [];
  let alive = true;

  function render() {
    clear(listEl);
    const q = search.value.trim();
    const items = all.filter((r) => matches(r, q));
    if (all.length === 0) {
      listEl.append(
        h("li", { class: "empty" },
          h("p", null, "まだ録音がありません"),
          h("button", { class: "btn primary", type: "button", onclick: () => ctx.navigate("#/record") }, icon("mic", 18), "録音する"),
        ),
      );
      return;
    }
    if (items.length === 0) {
      listEl.append(h("li", { class: "empty" }, h("p", { class: "muted" }, "一致する録音はありません")));
      return;
    }
    for (const rec of items) {
      listEl.append(
        h("li", null,
          h("a", { class: "rec-item", href: `#/rec/${rec.id}` },
            h("div", { class: "rec-item-main" },
              h("div", { class: "rec-item-title" }, rec.title),
              h("div", { class: "rec-item-meta" }, `${formatDateTime(rec.createdAt)} ・ ${formatElapsed(rec.duration)}`),
            ),
            h("div", { class: "badges" },
              rec.segments.length > 0 && h("span", { class: "badge" }, "文字起こし"),
              rec.summary && h("span", { class: "badge accent" }, "要約"),
              rec.markers.length > 0 && h("span", { class: "badge" }, `マーカー ${rec.markers.length}`),
            ),
          ),
        ),
      );
    }
  }

  search.addEventListener("input", render);
  listRecordings()
    .then((recs) => {
      if (!alive) return;
      all = recs;
      render();
    })
    .catch(() => {
      if (alive) listEl.append(h("li", { class: "empty" }, h("p", null, "録音を読み込めませんでした。")));
    });

  return () => {
    alive = false;
  };
}
