import type { Settings } from "./types";

/** 各画面に渡す、アプリ共通の機能。 */
export interface AppContext {
  settings(): Settings;
  updateSettings(patch: Partial<Settings>): void;
  navigate(hash: string): void;
}
