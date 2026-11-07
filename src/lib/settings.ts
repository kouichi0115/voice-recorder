import type { Settings } from "../types";

const KEY = "voice-recorder:settings";

export const LANGUAGES: { code: string; label: string }[] = [
  { code: "ja-JP", label: "日本語" },
  { code: "en-US", label: "English (US)" },
  { code: "en-GB", label: "English (UK)" },
  { code: "zh-CN", label: "中文（简体）" },
  { code: "zh-TW", label: "中文（繁體）" },
  { code: "ko-KR", label: "한국어" },
  { code: "es-ES", label: "Español" },
  { code: "fr-FR", label: "Français" },
  { code: "de-DE", label: "Deutsch" },
];

export const DEFAULT_SETTINGS: Settings = {
  anthropicApiKey: "",
  openaiApiKey: "",
  language: "ja-JP",
  liveTranscription: true,
  timestampMode: "elapsed",
};

// API キーはこのブラウザの localStorage にだけ保存する（サーバーには送らない）。
export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(settings));
  } catch {
    // プライベートブラウズ等で保存できない場合は、このセッション中だけ有効
  }
}
