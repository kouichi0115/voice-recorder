/** 文字起こしの1区間。時間は録音開始からの経過秒（一時停止中は進まない）。 */
export interface Segment {
  id: string;
  start: number;
  end: number;
  text: string;
}

/** 録音中・再生中に付けたマーカー（しおり）。 */
export interface Marker {
  id: string;
  time: number;
  note: string;
}

/** 一時停止の記録。at: 停止した時点の経過秒、ms: 停止していた実時間（ミリ秒）。 */
export interface PauseSpan {
  at: number;
  ms: number;
}

export type TranscriptSource = "none" | "live" | "whisper";

export interface Summary {
  text: string;
  model: string;
  createdAt: number;
  instruction?: string;
}

/** 録音のメタデータ。音声データ本体は別ストアに保存する。 */
export interface Recording {
  id: string;
  title: string;
  /** 録音開始時刻（エポックミリ秒） */
  createdAt: number;
  /** 録音時間（秒） */
  duration: number;
  mimeType: string;
  language: string;
  pauses: PauseSpan[];
  segments: Segment[];
  transcriptSource: TranscriptSource;
  markers: Marker[];
  summary?: Summary;
}

export type TimestampMode = "elapsed" | "clock";

export interface Settings {
  anthropicApiKey: string;
  openaiApiKey: string;
  language: string;
  liveTranscription: boolean;
  timestampMode: TimestampMode;
}
