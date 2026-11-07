// 音声の変換ユーティリティ。長い録音を API のファイルサイズ上限に収まるよう分割するのに使う。

export const WHISPER_SAMPLE_RATE = 16_000;

/** 音声ファイルを 16kHz モノラルの PCM に変換する。 */
export async function decodeToMono(blob: Blob, sampleRate = WHISPER_SAMPLE_RATE): Promise<Float32Array> {
  const data = await blob.arrayBuffer();
  // OfflineAudioContext の decodeAudioData はコンテキストのサンプルレートへ変換して返す
  const ctx = new OfflineAudioContext(1, 1, sampleRate);
  const buf = await ctx.decodeAudioData(data);
  if (buf.numberOfChannels === 1) return buf.getChannelData(0);
  const out = new Float32Array(buf.length);
  for (let ch = 0; ch < buf.numberOfChannels; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < d.length; i++) out[i] += d[i] / buf.numberOfChannels;
  }
  return out;
}

/** 16bit PCM の WAV ファイルを作る。 */
export function encodeWav(samples: Float32Array, sampleRate: number): Blob {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeStr = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
  };
  writeStr(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeStr(8, "WAVE");
  writeStr(12, "fmt ");
  view.setUint32(16, 16, true); // fmt チャンクのサイズ
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // モノラル
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // バイトレート
  view.setUint16(32, 2, true); // ブロックサイズ
  view.setUint16(34, 16, true); // ビット深度
  writeStr(36, "data");
  view.setUint32(40, samples.length * 2, true);
  let offset = 44;
  for (const s of samples) {
    const v = Math.max(-1, Math.min(1, s));
    view.setInt16(offset, v < 0 ? v * 0x8000 : v * 0x7fff, true);
    offset += 2;
  }
  return new Blob([buffer], { type: "audio/wav" });
}

/** 全サンプル数を、1チャンク最大 chunkSamples の区間 [start, end) に分ける。 */
export function planChunks(totalSamples: number, chunkSamples: number): { start: number; end: number }[] {
  if (chunkSamples <= 0) throw new Error("chunkSamples must be positive");
  const chunks: { start: number; end: number }[] = [];
  for (let start = 0; start < totalSamples; start += chunkSamples) {
    chunks.push({ start, end: Math.min(totalSamples, start + chunkSamples) });
  }
  return chunks;
}

/** MIME タイプから API に渡すファイル拡張子を決める。 */
export function extensionFor(mimeType: string): string {
  if (mimeType.includes("webm")) return "webm";
  if (mimeType.includes("mp4") || mimeType.includes("aac") || mimeType.includes("m4a")) return "m4a";
  if (mimeType.includes("ogg")) return "ogg";
  if (mimeType.includes("wav")) return "wav";
  if (mimeType.includes("mpeg") || mimeType.includes("mp3")) return "mp3";
  return "webm";
}
