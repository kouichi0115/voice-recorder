import type { AppContext } from "../app";
import { h, toast } from "../lib/dom";
import { isLiveTranscriptionSupported } from "../lib/liveTranscriber";
import { LANGUAGES } from "../lib/settings";
import type { Settings, TimestampMode } from "../types";

function keyField(label: string, key: "anthropicApiKey" | "openaiApiKey", ctx: AppContext, placeholder: string) {
  const input = h("input", {
    type: "password",
    class: "key-input",
    value: ctx.settings()[key],
    placeholder,
    autocomplete: "off",
    spellcheck: false,
    "aria-label": label,
  });
  input.addEventListener("change", () => {
    ctx.updateSettings({ [key]: input.value.trim() } as Partial<Settings>);
    toast(input.value.trim() ? "保存しました" : "削除しました", "success");
  });
  const toggle = h("button", {
    type: "button",
    class: "btn small",
    onclick: () => {
      input.type = input.type === "password" ? "text" : "password";
      toggle.textContent = input.type === "password" ? "表示" : "隠す";
    },
  }, "表示");
  return h("div", { class: "key-row" }, input, toggle);
}

export function renderSettings(root: HTMLElement, ctx: AppContext): () => void {
  const s = ctx.settings();

  const lang = h("select", { "aria-label": "言語" },
    ...LANGUAGES.map((l) => h("option", { value: l.code, selected: l.code === s.language }, l.label)));
  lang.addEventListener("change", () => ctx.updateSettings({ language: lang.value }));

  const live = h("input", {
    type: "checkbox",
    role: "switch",
    checked: s.liveTranscription && isLiveTranscriptionSupported(),
    disabled: !isLiveTranscriptionSupported(),
  });
  live.addEventListener("change", () => ctx.updateSettings({ liveTranscription: live.checked }));

  const tsMode = h("select", { "aria-label": "タイムスタンプの表示" },
    h("option", { value: "elapsed", selected: s.timestampMode === "elapsed" }, "経過時間（00:12:34）"),
    h("option", { value: "clock", selected: s.timestampMode === "clock" }, "時刻（14:03:21）"));
  tsMode.addEventListener("change", () => ctx.updateSettings({ timestampMode: tsMode.value as TimestampMode }));

  const storageInfo = h("p", { class: "muted small" });
  void navigator.storage?.estimate?.().then((est) => {
    if (!est.usage) return;
    const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)}MB`;
    storageInfo.textContent = `使用中: ${mb(est.usage)}${est.quota ? ` / 上限の目安 ${mb(est.quota)}` : ""}`;
  });

  root.append(
    h("section", { class: "view settings" },
      h("header", { class: "page-head" }, h("h1", null, "設定")),

      h("section", { class: "panel" },
        h("h2", null, "要約（Claude）"),
        h("p", { class: "muted small" },
          "要約には Anthropic の Claude API を使います。API キーは ",
          h("a", { href: "https://platform.claude.com/", target: "_blank", rel: "noopener" }, "Claude Console"),
          " で発行できます。"),
        keyField("Anthropic API キー", "anthropicApiKey", ctx, "sk-ant-..."),
      ),

      h("section", { class: "panel" },
        h("h2", null, "高精度な文字起こし（Whisper・任意）"),
        h("p", { class: "muted small" },
          "録音後に OpenAI の Whisper で文字起こしできます（1分あたり約0.006ドル）。API キーは ",
          h("a", { href: "https://platform.openai.com/api-keys", target: "_blank", rel: "noopener" }, "OpenAI Platform"),
          " で発行できます。"),
        keyField("OpenAI API キー", "openaiApiKey", ctx, "sk-..."),
      ),

      h("section", { class: "panel" },
        h("h2", null, "録音・文字起こし"),
        h("label", { class: "field" }, h("span", null, "言語"), lang),
        h("label", { class: "switch-row" },
          h("span", null, "リアルタイム文字起こし",
            h("small", { class: "muted block" },
              isLiveTranscriptionSupported()
                ? "録音中にブラウザの音声認識で文字起こしします（無料）"
                : "このブラウザは非対応です（Chrome・Edge・Safari で利用できます）")),
          live),
        h("label", { class: "field" }, h("span", null, "タイムスタンプの表示"), tsMode),
      ),

      h("section", { class: "panel" },
        h("h2", null, "データとプライバシー"),
        h("ul", { class: "notes" },
          h("li", null, "録音・文字起こし・要約は、この端末のブラウザ内にだけ保存されます。"),
          h("li", null, "API キーもこのブラウザ内にだけ保存され、Anthropic / OpenAI へ直接送信されます。共用の端末では入力しないでください。"),
          h("li", null, "ブラウザのサイトデータを消去すると録音も消えます。大事な録音は「ドキュメントに出力」で保存してください。"),
        ),
        storageInfo,
      ),
    ),
  );
  return () => {};
}
