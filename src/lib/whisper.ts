import type { Segment } from "../types";
import { decodeToMono, encodeWav, extensionFor, planChunks, WHISPER_SAMPLE_RATE } from "./audio";
import { newId } from "./id";

// OpenAI の音声認識 API（Whisper）で、録音後に高精度な文字起こしを行う。
// verbose_json 形式で区間ごとの開始・終了時刻を受け取る。
const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
const MODEL = "whisper-1";
const MAX_UPLOAD_BYTES = 24 * 1024 * 1024; // API の上限は 25MB。余裕を持たせる
const CHUNK_SECONDS = 10 * 60; // 16kHz・16bit の WAV で 10 分 ≒ 19MB

interface WhisperSegment {
  start: number;
  end: number;
  text: string;
}

export class WhisperError extends Error {}

export interface WhisperOptions {
  apiKey: string;
  /** "ja-JP" のような BCP 47 形式。API には "ja" の部分だけ渡す */
  language: string;
  signal?: AbortSignal;
  onProgress?: (message: string) => void;
}

export async function transcribeWithWhisper(audio: Blob, mimeType: string, opts: WhisperOptions): Promise<Segment[]> {
  if (!opts.apiKey) throw new WhisperError("OpenAI API キーが設定されていません（設定画面で入力してください）。");

  if (audio.size <= MAX_UPLOAD_BYTES) {
    opts.onProgress?.("文字起こし中…");
    const file = new File([audio], `audio.${extensionFor(mimeType)}`, { type: mimeType });
    return toSegments(await requestTranscription(file, opts), 0);
  }

  // 大きなファイルは 16kHz モノラルに変換し、10 分ごとに分割して順番に送る
  opts.onProgress?.("音声を分割しています…");
  const samples = await decodeToMono(audio);
  const chunks = planChunks(samples.length, CHUNK_SECONDS * WHISPER_SAMPLE_RATE);
  const all: Segment[] = [];
  for (const [i, chunk] of chunks.entries()) {
    opts.onProgress?.(`文字起こし中…（${i + 1}/${chunks.length}）`);
    const wav = encodeWav(samples.subarray(chunk.start, chunk.end), WHISPER_SAMPLE_RATE);
    const file = new File([wav], `audio-${i + 1}.wav`, { type: "audio/wav" });
    const segs = await requestTranscription(file, opts);
    all.push(...toSegments(segs, chunk.start / WHISPER_SAMPLE_RATE));
  }
  return all;
}

function toSegments(segs: WhisperSegment[], offset: number): Segment[] {
  return segs
    .map((s) => ({ id: newId(), start: s.start + offset, end: s.end + offset, text: s.text.trim() }))
    .filter((s) => s.text.length > 0);
}

async function requestTranscription(file: File, opts: WhisperOptions): Promise<WhisperSegment[]> {
  const form = new FormData();
  form.append("file", file);
  form.append("model", MODEL);
  form.append("response_format", "verbose_json");
  form.append("timestamp_granularities[]", "segment");
  const lang = opts.language.split("-")[0];
  if (lang) form.append("language", lang);

  let res: Response;
  try {
    res = await fetch(ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.apiKey}` },
      body: form,
      signal: opts.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") throw e;
    throw new WhisperError("OpenAI API に接続できませんでした。ネットワークを確認してください。");
  }

  if (!res.ok) {
    let detail = "";
    try {
      const body = (await res.json()) as { error?: { message?: string } };
      detail = body.error?.message ?? "";
    } catch {
      // 本文が JSON でない場合は無視
    }
    if (res.status === 401) throw new WhisperError("OpenAI API キーが正しくありません。");
    if (res.status === 429) throw new WhisperError("OpenAI API の利用上限に達しました。時間をおいて再度お試しください。");
    throw new WhisperError(`文字起こしに失敗しました（${res.status}）${detail ? `: ${detail}` : ""}`);
  }

  const body = (await res.json()) as { text?: string; duration?: number; segments?: WhisperSegment[] };
  if (body.segments && body.segments.length > 0) return body.segments;
  // 区間情報が無い場合は全文を 1 区間として扱う
  return body.text ? [{ start: 0, end: body.duration ?? 0, text: body.text }] : [];
}
