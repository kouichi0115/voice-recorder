import type { AppContext } from "../app";
import { extensionFor } from "../lib/audio";
import { deleteRecording, getAudio, getRecording, updateRecording } from "../lib/db";
import { append, clear, copyText, h, icon, toast } from "../lib/dom";
import { canShareFiles, downloadBlob, safeFileName, shareOrDownload } from "../lib/export/save";
import { toMarkdown, toPlainText, toSrt } from "../lib/export/text";
import { newId } from "../lib/id";
import { markdownToHtml } from "../lib/markdown";
import { formatDateTime, formatDurationJa, timestampFormatter } from "../lib/time";
import { activeSegmentIndex, normalizeSegments, sortMarkers, transcriptLines } from "../lib/transcript";
import { transcribeWithWhisper } from "../lib/whisper";
import type { Recording } from "../types";

type Tab = "summary" | "transcript" | "markers";

const EXPORTS = [
  { id: "docx", label: "Word（.docx）" },
  { id: "md", label: "Markdown（.md）" },
  { id: "txt", label: "テキスト（.txt）" },
  { id: "srt", label: "字幕（.srt）" },
  { id: "audio", label: "音声ファイル" },
] as const;
type ExportId = (typeof EXPORTS)[number]["id"];

const SOURCE_LABEL: Record<Recording["transcriptSource"], string> = {
  none: "未文字起こし",
  live: "リアルタイム文字起こし",
  whisper: "Whisper 文字起こし",
};

export function renderDetail(root: HTMLElement, ctx: AppContext, id: string): () => void {
  const view = h("section", { class: "view detail" });
  root.append(view);

  let alive = true;
  let audioUrl = "";
  let transcribeAbort: AbortController | null = null;
  let summaryAbort: AbortController | null = null;

  void (async () => {
    const [rec, audio] = await Promise.all([getRecording(id), getAudio(id)]);
    if (!alive) return;
    if (!rec) {
      view.append(
        h("header", { class: "page-head" }, backLink()),
        h("div", { class: "empty" }, h("p", null, "録音が見つかりません。"), h("a", { href: "#/list" }, "一覧に戻る")),
      );
      return;
    }
    mount(rec, audio);
  })();

  function backLink() {
    return h("a", { class: "back", href: "#/list", "aria-label": "一覧に戻る" }, icon("back", 22));
  }

  function mount(rec: Recording, audio: Blob | undefined) {
    let tab: Tab = rec.summary ? "summary" : "transcript";
    let editing = false;
    let transcribing = false;
    let progress = "";
    let summarizing = false;
    let streamText = "";
    let instruction = rec.summary?.instruction ?? "";

    const mode = () => ctx.settings().timestampMode;
    const fmt = () => timestampFormatter(mode(), rec.createdAt, rec.pauses);

    async function save() {
      try {
        await updateRecording(rec);
      } catch {
        toast("保存に失敗しました", "error");
      }
    }
    let saveTimer: number | undefined;
    const saveSoon = () => {
      window.clearTimeout(saveTimer);
      saveTimer = window.setTimeout(save, 500);
    };

    // ---- ヘッダー ----
    const titleInput = h("input", {
      class: "title-input",
      type: "text",
      value: rec.title,
      "aria-label": "タイトル",
      onchange: () => {
        rec.title = titleInput.value.trim() || `録音 ${formatDateTime(rec.createdAt)}`;
        titleInput.value = rec.title;
        void save();
      },
    });
    const metaEl = h("div", { class: "detail-meta" });
    const renderMeta = () => {
      metaEl.textContent = `${formatDateTime(rec.createdAt)} ・ ${formatDurationJa(rec.duration)} ・ ${SOURCE_LABEL[rec.transcriptSource]}`;
    };
    renderMeta();

    // ---- プレーヤー ----
    const player = h("audio", { controls: true, preload: "metadata", class: "player" });
    if (audio) {
      audioUrl = URL.createObjectURL(audio);
      player.src = audioUrl;
      // MediaRecorder の webm は長さ情報が無く、シークバーが使えないことがあるための対策
      player.addEventListener("loadedmetadata", () => {
        if (player.duration === Infinity) {
          player.currentTime = 1e101;
          player.addEventListener("timeupdate", function reset() {
            player.removeEventListener("timeupdate", reset);
            player.currentTime = 0;
          });
        }
      });
    }
    const speed = h("select", { class: "speed", "aria-label": "再生速度" },
      ...[0.75, 1, 1.25, 1.5, 2].map((r) => h("option", { value: String(r), selected: r === 1 }, `${r}x`)));
    speed.addEventListener("change", () => (player.playbackRate = Number(speed.value)));

    function seek(seconds: number) {
      if (!audio) return;
      player.currentTime = Math.max(0, seconds - 0.5); // 発話の頭が切れないよう少し前から
      void player.play().catch(() => {});
    }

    // ---- タブ ----
    const tabsEl = h("div", { class: "tabs", role: "tablist" });
    const panel = h("div", { class: "tab-panel" });

    function renderTabs() {
      clear(tabsEl);
      const items: [Tab, string][] = [
        ["summary", "要約"],
        ["transcript", `文字起こし${rec.segments.length ? `（${rec.segments.length}）` : ""}`],
        ["markers", `マーカー${rec.markers.length ? `（${rec.markers.length}）` : ""}`],
      ];
      for (const [key, label] of items) {
        tabsEl.append(
          h("button", {
            type: "button",
            role: "tab",
            class: key === tab ? "tab active" : "tab",
            "aria-selected": String(key === tab),
            onclick: () => {
              tab = key;
              editing = false;
              renderAll();
            },
          }, label),
        );
      }
    }

    function renderPanel() {
      clear(panel);
      if (tab === "summary") renderSummary();
      else if (tab === "transcript") renderTranscript();
      else renderMarkers();
    }

    function renderAll() {
      renderTabs();
      renderPanel();
      renderMeta();
    }

    // ---- 文字起こし ----
    let rowEls: HTMLElement[] = [];

    function renderTranscript() {
      const segs = normalizeSegments(rec.segments);
      const key = ctx.settings().openaiApiKey;
      const toolbar = h("div", { class: "toolbar" });
      if (transcribing) {
        toolbar.append(
          h("span", { class: "progress" }, h("span", { class: "spinner" }), progress),
          h("button", { class: "btn", type: "button", onclick: () => transcribeAbort?.abort() }, "中止"),
        );
      } else if (editing) {
        toolbar.append(h("button", { class: "btn primary", type: "button", onclick: () => { editing = false; void save(); renderAll(); } }, icon("check", 18), "完了"));
      } else {
        append(toolbar, [
          h("button", { class: segs.length ? "btn" : "btn primary", type: "button", onclick: runWhisper, disabled: !audio },
            icon("sparkles", 18), segs.length ? "Whisperでやり直す" : "Whisperで文字起こし"),
          segs.length > 0 && h("button", { class: "btn", type: "button", onclick: () => { editing = true; renderPanel(); } }, icon("edit", 18), "編集"),
          segs.length > 0 && h("button", { class: "btn", type: "button", onclick: () => copyText(transcriptLines(rec, mode()).join("\n")) }, icon("copy", 18), "コピー"),
        ]);
      }
      panel.append(toolbar);
      if (!key && !transcribing && !editing) {
        panel.append(h("p", { class: "hint-box" },
          "Whisper（高精度な文字起こし）を使うには、", h("a", { href: "#/settings" }, "設定"), "で OpenAI API キーを入力してください。"));
      }

      if (segs.length === 0) {
        panel.append(h("div", { class: "empty" }, h("p", { class: "muted" },
          transcribing ? "文字起こしの完了をお待ちください…" : "文字起こしはまだありません。")));
        return;
      }

      const list = h("div", { class: "transcript" });
      const f = fmt();
      rowEls = segs.map((seg) => {
        if (editing) {
          const ta = h("textarea", { class: "seg-edit", rows: 1, value: seg.text, "aria-label": `${f(seg.start)} の文字起こし` });
          const autosize = () => {
            ta.style.height = "auto";
            ta.style.height = `${ta.scrollHeight}px`;
          };
          ta.addEventListener("input", () => {
            seg.text = ta.value;
            autosize();
            saveSoon();
          });
          requestAnimationFrame(autosize);
          return h("div", { class: "seg-row editing" },
            h("span", { class: "ts" }, f(seg.start)),
            ta,
            h("button", {
              class: "icon-btn", type: "button", "aria-label": "この行を削除",
              onclick: () => {
                rec.segments = rec.segments.filter((s) => s.id !== seg.id);
                void save();
                renderAll();
              },
            }, icon("trash", 18)),
          );
        }
        return h("div", { class: "seg-row" },
          h("button", { class: "ts ts-btn", type: "button", "aria-label": `${f(seg.start)} から再生`, onclick: () => seek(seg.start) }, f(seg.start)),
          h("p", null, seg.text),
        );
      });
      list.append(...rowEls);
      panel.append(list);
      highlight();
    }

    function highlight() {
      if (tab !== "transcript" || editing || rowEls.length === 0) return;
      const idx = activeSegmentIndex(normalizeSegments(rec.segments), player.currentTime);
      rowEls.forEach((el, i) => el.classList.toggle("active", i === idx && !player.paused));
    }
    player.addEventListener("timeupdate", highlight);
    player.addEventListener("pause", highlight);

    async function runWhisper() {
      const s = ctx.settings();
      if (!s.openaiApiKey) {
        toast("設定で OpenAI API キーを入力してください", "error");
        return;
      }
      if (!audio) return;
      if (rec.segments.length && !confirm("現在の文字起こしを Whisper の結果で置き換えます。よろしいですか？")) return;
      transcribing = true;
      progress = "準備中…";
      transcribeAbort = new AbortController();
      renderPanel();
      try {
        const segs = await transcribeWithWhisper(audio, rec.mimeType, {
          apiKey: s.openaiApiKey,
          language: rec.language,
          signal: transcribeAbort.signal,
          onProgress: (m) => {
            progress = m;
            const el = panel.querySelector(".progress");
            if (el) el.lastChild!.textContent = m;
          },
        });
        if (!alive) return;
        rec.segments = segs;
        rec.transcriptSource = "whisper";
        await save();
        toast(segs.length ? "文字起こしが完了しました" : "音声から文字を検出できませんでした", segs.length ? "success" : "info");
      } catch (e) {
        if ((e as Error).name === "AbortError") toast("中止しました");
        else toast((e as Error).message, "error");
      } finally {
        transcribing = false;
        transcribeAbort = null;
        if (alive) renderAll();
      }
    }

    // ---- 要約 ----
    function linkTimestamps(html: string): string {
      // 要約中の [00:12:34] を、その位置から再生できるボタンにする
      const lookup = new Map<string, number>();
      const f = timestampFormatter(mode(), rec.createdAt, rec.pauses, true);
      for (const s of rec.segments) if (!lookup.has(f(s.start))) lookup.set(f(s.start), s.start);
      for (const m of rec.markers) if (!lookup.has(f(m.time))) lookup.set(f(m.time), m.time);
      return html.replace(/\[(\d{1,2}:\d{2}(?::\d{2})?)\]/g, (whole, label: string) => {
        let t = lookup.get(label.length === 5 ? `00:${label}` : label.padStart(8, "0"));
        if (t === undefined && mode() === "elapsed") {
          const p = label.split(":").map(Number);
          t = p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1];
        }
        return t === undefined ? whole : `<button type="button" class="ts-link" data-t="${t}">${whole}</button>`;
      });
    }

    function renderSummary() {
      const s = ctx.settings();
      const hasTranscript = rec.segments.length > 0;
      const instructionBox = h("textarea", {
        class: "instruction",
        rows: 2,
        placeholder: "例: 営業会議として、顧客の要望と次回までの宿題を中心にまとめて",
        value: instruction,
        oninput: (e: Event) => (instruction = (e.target as HTMLTextAreaElement).value),
      });
      const details = h("details", { class: "instruction-wrap", open: !!instruction },
        h("summary", null, "要約の指示（任意）"), instructionBox);

      const toolbar = h("div", { class: "toolbar" });
      if (summarizing) {
        toolbar.append(
          h("span", { class: "progress" }, h("span", { class: "spinner" }), "要約を作成中…"),
          h("button", { class: "btn", type: "button", onclick: () => summaryAbort?.abort() }, "中止"),
        );
      } else {
        append(toolbar, [
          h("button", { class: rec.summary ? "btn" : "btn primary", type: "button", onclick: runSummary, disabled: !hasTranscript },
            icon("sparkles", 18), rec.summary ? "要約し直す" : "要約する"),
          rec.summary && h("button", { class: "btn", type: "button", onclick: () => copyText(rec.summary!.text) }, icon("copy", 18), "コピー"),
        ]);
      }
      panel.append(toolbar);
      if (!summarizing) panel.append(details);

      if (!s.anthropicApiKey && !summarizing) {
        panel.append(h("p", { class: "hint-box" },
          "要約には Claude を使います。", h("a", { href: "#/settings" }, "設定"), "で Anthropic API キーを入力してください。"));
      }
      if (!hasTranscript) {
        panel.append(h("div", { class: "empty" }, h("p", { class: "muted" }, "要約するには、先に文字起こしが必要です。")));
        return;
      }

      const body = h("div", { class: "summary md" });
      body.addEventListener("click", (e) => {
        const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".ts-link");
        if (btn) seek(Number(btn.dataset.t));
      });
      if (summarizing) {
        body.innerHTML = streamText ? markdownToHtml(streamText) : "";
        body.classList.add("streaming");
      } else if (rec.summary) {
        body.innerHTML = linkTimestamps(markdownToHtml(rec.summary.text));
        panel.append(body, h("p", { class: "summary-meta muted" }, `Claude（${rec.summary.model}）・ ${formatDateTime(rec.summary.createdAt)}`));
        return;
      } else {
        body.append(h("p", { class: "muted" }, "「要約する」を押すと、概要・主なポイント・決定事項・ToDo をタイムスタンプ付きでまとめます。"));
      }
      panel.append(body);
    }

    async function runSummary() {
      const s = ctx.settings();
      if (!s.anthropicApiKey) {
        toast("設定で Anthropic API キーを入力してください", "error");
        return;
      }
      summarizing = true;
      streamText = "";
      summaryAbort = new AbortController();
      tab = "summary";
      renderAll();
      let pending = false;
      try {
        const { summarize, SUMMARY_MODEL } = await import("../lib/summarize");
        const text = await summarize({
          apiKey: s.anthropicApiKey,
          recording: rec,
          timestampMode: s.timestampMode,
          instruction,
          signal: summaryAbort.signal,
          onText: (t) => {
            streamText = t;
            if (pending) return;
            pending = true;
            requestAnimationFrame(() => {
              pending = false;
              const el = panel.querySelector(".summary.streaming");
              if (el) el.innerHTML = markdownToHtml(streamText);
            });
          },
        });
        if (!alive) return;
        rec.summary = { text, model: SUMMARY_MODEL, createdAt: Date.now(), instruction: instruction.trim() || undefined };
        await save();
        toast("要約が完了しました", "success");
      } catch (e) {
        const err = e as Error;
        if (err.name === "AbortError") toast("中止しました");
        else toast(err.message, "error");
      } finally {
        summarizing = false;
        summaryAbort = null;
        if (alive) renderAll();
      }
    }

    // ---- マーカー ----
    function renderMarkers() {
      const f = fmt();
      panel.append(
        h("div", { class: "toolbar" },
          h("button", {
            class: "btn", type: "button", disabled: !audio,
            onclick: () => {
              rec.markers.push({ id: newId(), time: player.currentTime || 0, note: "" });
              rec.markers = sortMarkers(rec.markers);
              void save();
              renderAll();
            },
          }, icon("plus", 18), "再生位置にマーカーを追加"),
        ),
      );
      if (rec.markers.length === 0) {
        panel.append(h("div", { class: "empty" }, h("p", { class: "muted" }, "マーカーはありません。録音中や再生中に重要な場面へ印を付けられます。")));
        return;
      }
      panel.append(
        h("ul", { class: "marker-list" },
          ...sortMarkers(rec.markers).map((m) =>
            h("li", null,
              h("button", { class: "ts ts-btn", type: "button", onclick: () => seek(m.time) }, f(m.time)),
              h("input", {
                class: "marker-note", type: "text", placeholder: "メモ（任意）", value: m.note,
                oninput: (e: Event) => {
                  m.note = (e.target as HTMLInputElement).value;
                  saveSoon();
                },
              }),
              h("button", {
                class: "icon-btn", type: "button", "aria-label": "マーカーを削除",
                onclick: () => {
                  rec.markers = rec.markers.filter((x) => x.id !== m.id);
                  void save();
                  renderAll();
                },
              }, icon("trash", 18)),
            ),
          ),
        ),
      );
    }

    // ---- 出力 ----
    const formatSelect = h("select", { class: "export-select", "aria-label": "出力形式" },
      ...EXPORTS.map((e) => h("option", { value: e.id }, e.label)));

    async function buildExport(kind: ExportId): Promise<{ blob: Blob; name: string } | null> {
      const base = safeFileName(rec.title);
      const m = mode();
      switch (kind) {
        case "docx": {
          // Word 出力ライブラリは大きいので、使う時に読み込む
          const { toDocxBlob } = await import("../lib/export/docx");
          return { blob: await toDocxBlob(rec, m), name: `${base}.docx` };
        }
        case "md":
          return { blob: new Blob([toMarkdown(rec, m)], { type: "text/markdown;charset=utf-8" }), name: `${base}.md` };
        case "txt":
          return { blob: new Blob([toPlainText(rec, m)], { type: "text/plain;charset=utf-8" }), name: `${base}.txt` };
        case "srt":
          if (!rec.segments.length) {
            toast("字幕にする文字起こしがありません", "error");
            return null;
          }
          // BOM 付きにすると、文字化けしやすい再生ソフトでも日本語が正しく表示される
          return { blob: new Blob(["﻿", toSrt(rec)], { type: "application/x-subrip;charset=utf-8" }), name: `${base}.srt` };
        case "audio":
          if (!audio) return null;
          return { blob: audio, name: `${base}.${extensionFor(rec.mimeType)}` };
      }
    }

    async function doExport(share: boolean) {
      try {
        const out = await buildExport(formatSelect.value as ExportId);
        if (!out) return;
        if (share) await shareOrDownload(out.blob, out.name, rec.title);
        else downloadBlob(out.blob, out.name);
      } catch (e) {
        toast(`出力に失敗しました: ${(e as Error).message}`, "error");
      }
    }

    const exportCard = h("section", { class: "panel export" },
      h("h2", null, icon("file", 18), "ドキュメントに出力"),
      h("p", { class: "muted small" }, "要約・マーカー・タイムスタンプ付きの文字起こしをまとめて出力します。"),
      h("div", { class: "export-row" },
        formatSelect,
        h("button", { class: "btn primary", type: "button", onclick: () => doExport(false) }, icon("download", 18), "保存"),
        canShareFiles() && h("button", { class: "btn", type: "button", onclick: () => doExport(true) }, icon("share", 18), "共有"),
      ),
    );

    const deleteBtn = h("button", {
      class: "btn danger", type: "button",
      onclick: async () => {
        if (!confirm(`「${rec.title}」を削除します。元に戻せません。よろしいですか？`)) return;
        await deleteRecording(rec.id);
        toast("削除しました");
        ctx.navigate("#/list");
      },
    }, icon("trash", 18), "この録音を削除");

    view.append(
      h("header", { class: "page-head detail-head" }, backLink(), titleInput),
      metaEl,
      h("div", { class: "player-card" }, audio ? player : h("p", { class: "muted" }, "音声データが見つかりません。"), audio && speed),
      tabsEl,
      panel,
      exportCard,
      h("div", { class: "danger-zone" }, deleteBtn),
    );
    renderAll();
  }

  return () => {
    alive = false;
    transcribeAbort?.abort();
    summaryAbort?.abort();
    if (audioUrl) URL.revokeObjectURL(audioUrl);
  };
}
