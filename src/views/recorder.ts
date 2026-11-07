import type { AppContext } from "../app";
import { clear, h, icon, toast } from "../lib/dom";
import { isLiveTranscriptionSupported } from "../lib/liveTranscriber";
import { isRecordingSupported } from "../lib/recorder";
import { session } from "../lib/session";
import { LANGUAGES } from "../lib/settings";
import { formatElapsed } from "../lib/time";

function micErrorMessage(e: unknown): string {
  const name = (e as Error)?.name;
  if (name === "NotAllowedError" || name === "SecurityError")
    return "マイクの使用が許可されていません。ブラウザの設定でこのサイトのマイクを許可してください。";
  if (name === "NotFoundError") return "マイクが見つかりません。";
  if (name === "NotReadableError") return "マイクを使用できません。他のアプリが使用中でないか確認してください。";
  return `録音を開始できませんでした: ${(e as Error)?.message ?? e}`;
}

export function renderRecorder(root: HTMLElement, ctx: AppContext): () => void {
  if (!isRecordingSupported()) {
    root.append(
      h("section", { class: "view" },
        h("header", { class: "page-head" }, h("h1", null, "録音")),
        h("div", { class: "empty" },
          h("p", null, "このブラウザでは録音できません。"),
          h("p", { class: "muted" },
            window.isSecureContext
              ? "最新の Chrome / Safari / Edge / Firefox でお試しください。"
              : "マイクを使うには HTTPS（または localhost）で開く必要があります。"),
        ),
      ),
    );
    return () => {};
  }

  const statusEl = h("div", { class: "rec-status" });
  const timerEl = h("div", { class: "rec-timer", "aria-live": "off" }, "00:00");
  const canvas = h("canvas", { class: "meter", "aria-hidden": "true" });
  const mainBtn = h("button", { class: "rec-main", type: "button" });
  const stopBtn = h("button", { class: "rec-side", type: "button", "aria-label": "停止して保存" }, icon("stop", 22), h("span", null, "停止"));
  const markerBtn = h("button", { class: "rec-side", type: "button", "aria-label": "マーカーを追加" }, icon("bookmark", 22), h("span", null, "マーカー"));
  const hintEl = h("p", { class: "rec-hint muted" });

  const markerList = h("ul", { class: "marker-list" });
  const markerPanel = h("section", { class: "panel" }, h("h2", null, "マーカー"), markerList);

  const liveList = h("div", { class: "live-list" });
  const liveHead = h("div", { class: "panel-head" }, h("h2", null, "リアルタイム文字起こし"));
  const livePanel = h("section", { class: "panel" }, liveHead, liveList);

  const optionsEl = h("div", { class: "rec-options" });

  root.append(
    h("section", { class: "view recorder" },
      h("header", { class: "page-head" }, h("h1", null, "録音")),
      h("div", { class: "rec-card" },
        statusEl, timerEl, canvas,
        h("div", { class: "rec-controls" }, markerBtn, mainBtn, stopBtn),
        hintEl,
      ),
      optionsEl,
      markerPanel,
      livePanel,
    ),
  );

  // ---- 操作 ----
  mainBtn.addEventListener("click", async () => {
    if (session.state === "idle") {
      try {
        await session.start(ctx.settings());
      } catch (e) {
        toast(micErrorMessage(e), "error");
      }
    } else if (session.state === "recording") {
      session.pause();
    } else if (session.state === "paused") {
      session.resume();
    }
  });

  stopBtn.addEventListener("click", async () => {
    try {
      const rec = await session.stop();
      toast("保存しました", "success");
      ctx.navigate(`#/rec/${rec.id}`);
    } catch (e) {
      toast((e as Error).message, "error");
    }
  });

  markerBtn.addEventListener("click", () => {
    const m = session.addMarker();
    if (m) toast(`${formatElapsed(m.time)} にマーカーを付けました`, "success");
  });

  // ---- 表示の更新 ----
  let renderedMarkerIds: string | null = null;

  function renderMarkers() {
    const ids = session.markers.map((m) => m.id).join(",");
    if (ids === renderedMarkerIds) return; // 入力中のメモを消さないよう、増減した時だけ描き直す
    renderedMarkerIds = ids;
    clear(markerList);
    markerPanel.hidden = session.markers.length === 0;
    for (const m of session.markers) {
      markerList.append(
        h("li", null,
          h("span", { class: "ts" }, formatElapsed(m.time)),
          h("input", {
            class: "marker-note",
            type: "text",
            placeholder: "メモ（任意）",
            value: m.note,
            oninput: (e: Event) => session.updateMarker(m.id, (e.target as HTMLInputElement).value),
          }),
          h("button", { class: "icon-btn", type: "button", "aria-label": "マーカーを削除", onclick: () => session.removeMarker(m.id) }, icon("x", 18)),
        ),
      );
    }
  }

  function renderLive() {
    const s = ctx.settings();
    const active = session.state !== "idle";
    clear(liveList);
    if (!isLiveTranscriptionSupported()) {
      liveList.append(h("p", { class: "muted" },
        "このブラウザはリアルタイム文字起こしに対応していません（Chrome・Edge・Safari で利用できます）。録音後に Whisper で文字起こしできます。"));
      return;
    }
    if (session.liveNotice) liveList.append(h("p", { class: "notice" }, session.liveNotice));
    if (!active) {
      if (!s.liveTranscription) liveList.append(h("p", { class: "muted" }, "オフになっています。録音後に Whisper で文字起こしできます。"));
      else liveList.append(h("p", { class: "muted" }, "録音を始めると、話した内容がタイムスタンプ付きでここに表示されます。"));
      return;
    }
    if (!session.liveActive && !session.liveNotice) {
      liveList.append(h("p", { class: "muted" }, "リアルタイム文字起こしはオフです。"));
      return;
    }
    const nearBottom = liveList.scrollHeight - liveList.scrollTop - liveList.clientHeight < 40;
    for (const seg of session.segments) {
      liveList.append(h("p", { class: "seg" }, h("span", { class: "ts" }, formatElapsed(seg.start)), h("span", null, seg.text)));
    }
    if (session.interim) liveList.append(h("p", { class: "seg interim" }, h("span", { class: "ts" }, "…"), h("span", null, session.interim)));
    if (session.segments.length === 0 && !session.interim) {
      liveList.append(h("p", { class: "muted" }, session.state === "paused" ? "一時停止中" : "聞き取り中…"));
    }
    if (nearBottom) liveList.scrollTop = liveList.scrollHeight;
  }

  function renderOptions() {
    clear(optionsEl);
    if (session.state !== "idle") return;
    const s = ctx.settings();
    const lang = LANGUAGES.find((l) => l.code === s.language)?.label ?? s.language;
    optionsEl.append(
      h("label", { class: "switch-row" },
        h("span", null, "リアルタイム文字起こし", h("small", { class: "muted block" }, `言語: ${lang}（設定で変更できます）`)),
        h("input", {
          type: "checkbox",
          role: "switch",
          checked: s.liveTranscription && isLiveTranscriptionSupported(),
          disabled: !isLiveTranscriptionSupported(),
          onchange: (e: Event) => {
            ctx.updateSettings({ liveTranscription: (e.target as HTMLInputElement).checked });
            renderLive();
          },
        }),
      ),
    );
  }

  function renderState() {
    const st = session.state;
    statusEl.textContent = { idle: "待機中", recording: "● 録音中", paused: "一時停止中", saving: "保存中…" }[st];
    statusEl.dataset.state = st;
    clear(mainBtn);
    if (st === "recording") {
      mainBtn.append(icon("pause", 34));
      mainBtn.setAttribute("aria-label", "一時停止");
    } else if (st === "paused") {
      mainBtn.append(h("span", { class: "rec-dot" }));
      mainBtn.setAttribute("aria-label", "録音を再開");
    } else {
      mainBtn.append(h("span", { class: "rec-dot" }));
      mainBtn.setAttribute("aria-label", "録音を開始");
    }
    mainBtn.dataset.state = st;
    mainBtn.disabled = st === "saving";
    const active = st === "recording" || st === "paused";
    stopBtn.disabled = !active;
    markerBtn.disabled = !active;
    stopBtn.classList.toggle("invisible", st === "idle");
    markerBtn.classList.toggle("invisible", st === "idle");
    hintEl.textContent =
      st === "idle" ? "ボタンを押すと録音を開始します"
        : st === "recording" ? "マーカーで重要な場面に印を付けられます"
          : st === "paused" ? "● を押すと録音を再開します"
            : "";
    if (st === "idle") timerEl.textContent = "00:00";
    renderOptions();
    renderMarkers();
    renderLive();
  }

  // ---- レベルメーター ----
  const levels: number[] = [];
  let lastSample = 0;
  let raf = 0;
  function frame(t: number) {
    raf = requestAnimationFrame(frame);
    if (session.state === "idle") return;
    timerEl.textContent = formatElapsed(session.elapsed());
    if (t - lastSample > 60) {
      lastSample = t;
      levels.push(session.level());
      if (levels.length > 120) levels.shift();
      drawMeter();
    }
  }
  function drawMeter() {
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const hgt = canvas.clientHeight;
    if (canvas.width !== Math.round(w * dpr)) canvas.width = Math.round(w * dpr);
    if (canvas.height !== Math.round(hgt * dpr)) canvas.height = Math.round(hgt * dpr);
    const g = canvas.getContext("2d");
    if (!g) return;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, hgt);
    const bar = 3;
    const gap = 2;
    const count = Math.floor(w / (bar + gap));
    const color = getComputedStyle(canvas).color;
    g.fillStyle = color;
    const recent = levels.slice(-count);
    const offset = count - recent.length;
    recent.forEach((lv, i) => {
      const bh = Math.max(2, lv * hgt);
      g.globalAlpha = session.state === "paused" ? 0.35 : 0.9;
      g.fillRect((offset + i) * (bar + gap), (hgt - bh) / 2, bar, bh);
    });
  }

  const unsubscribe = session.subscribe(renderState);
  renderState();
  raf = requestAnimationFrame(frame);

  return () => {
    unsubscribe();
    cancelAnimationFrame(raf);
  };
}
