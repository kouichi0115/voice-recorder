import "./style.css";
import type { AppContext } from "./app";
import { clear, h, icon } from "./lib/dom";
import { session } from "./lib/session";
import { loadSettings, saveSettings } from "./lib/settings";
import type { Settings } from "./types";
import { renderDetail } from "./views/detail";
import { renderList } from "./views/list";
import { renderRecorder } from "./views/recorder";
import { renderSettings } from "./views/settings";

let settings: Settings = loadSettings();

const ctx: AppContext = {
  settings: () => settings,
  updateSettings(patch) {
    settings = { ...settings, ...patch };
    saveSettings(settings);
  },
  navigate(hash) {
    if (location.hash === hash) route();
    else location.hash = hash;
  },
};

const app = document.getElementById("app")!;
const main = h("main", { id: "main" });
const nav = h("nav", { class: "tabbar", "aria-label": "メインメニュー" });
app.append(main, nav);

const NAV_ITEMS = [
  { hash: "#/record", label: "録音", icon: "mic" },
  { hash: "#/list", label: "一覧", icon: "list" },
  { hash: "#/settings", label: "設定", icon: "settings" },
];

function renderNav(current: string) {
  clear(nav);
  for (const item of NAV_ITEMS) {
    const active = current === item.hash || (item.hash === "#/list" && current.startsWith("#/rec/"));
    const recording = item.hash === "#/record" && session.state !== "idle";
    nav.append(
      h("a", { href: item.hash, class: active ? "active" : "", "aria-current": active ? "page" : undefined },
        h("span", { class: "nav-icon" }, icon(item.icon, 22), recording && h("span", { class: "rec-indicator", "aria-label": "録音中" })),
        h("span", null, item.label),
      ),
    );
  }
}

let cleanup: () => void = () => {};

function route() {
  const hash = location.hash || "#/record";
  cleanup();
  clear(main);
  window.scrollTo(0, 0);
  const detail = /^#\/rec\/([\w-]+)$/.exec(hash);
  if (detail) cleanup = renderDetail(main, ctx, detail[1]);
  else if (hash === "#/list") cleanup = renderList(main, ctx);
  else if (hash === "#/settings") cleanup = renderSettings(main, ctx);
  else cleanup = renderRecorder(main, ctx);
  renderNav(hash);
}

window.addEventListener("hashchange", route);
session.subscribe(() => renderNav(location.hash || "#/record"));

// 録音中にページを閉じようとしたら確認する
window.addEventListener("beforeunload", (e) => {
  if (session.state !== "idle") e.preventDefault();
});

route();

// オフラインでも開けるようにサービスワーカーを登録（本番ビルドのみ）
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("./sw.js").catch(() => {});
  });
}
