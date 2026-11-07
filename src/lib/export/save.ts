/** ファイル名に使えない文字を置き換える。 */
export function safeFileName(name: string): string {
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim();
  return cleaned.slice(0, 80) || "recording";
}

/** ブラウザのダウンロードとして保存する。 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.rel = "noopener";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** スマホの共有シート（メール・ドライブ・メッセージアプリ等）でファイルを送れるか。 */
export function canShareFiles(): boolean {
  try {
    const probe = new File(["x"], "probe.txt", { type: "text/plain" });
    return typeof navigator.share === "function" && !!navigator.canShare?.({ files: [probe] });
  } catch {
    return false;
  }
}

/** 共有シートで送る。共有できない形式・環境ではダウンロードにする。 */
export async function shareOrDownload(blob: Blob, filename: string, title: string): Promise<void> {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title });
      return;
    } catch (e) {
      if ((e as Error).name === "AbortError") return; // ユーザーが共有をキャンセル
    }
  }
  downloadBlob(blob, filename);
}
