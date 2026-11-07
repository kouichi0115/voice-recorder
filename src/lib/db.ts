import type { Recording } from "../types";

// 録音は IndexedDB に保存する。一覧表示で音声を読み込まないよう、
// メタデータ（recordings）と音声本体（audio）を別ストアに分けている。
const DB_NAME = "voice-recorder";
const DB_VERSION = 1;
const META = "recordings";
const AUDIO = "audio";

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "id" });
        if (!db.objectStoreNames.contains(AUDIO)) db.createObjectStore(AUDIO);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function addRecording(rec: Recording, audio: Blob): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META, AUDIO], "readwrite");
  tx.objectStore(META).put(rec);
  tx.objectStore(AUDIO).put(audio, rec.id);
  await done(tx);
}

export async function updateRecording(rec: Recording): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(META, "readwrite");
  tx.objectStore(META).put(rec);
  await done(tx);
}

export async function getRecording(id: string): Promise<Recording | undefined> {
  const db = await openDb();
  return result(db.transaction(META).objectStore(META).get(id) as IDBRequest<Recording | undefined>);
}

export async function getAudio(id: string): Promise<Blob | undefined> {
  const db = await openDb();
  return result(db.transaction(AUDIO).objectStore(AUDIO).get(id) as IDBRequest<Blob | undefined>);
}

/** 新しい順に返す。 */
export async function listRecordings(): Promise<Recording[]> {
  const db = await openDb();
  const all = await result(db.transaction(META).objectStore(META).getAll() as IDBRequest<Recording[]>);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function deleteRecording(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction([META, AUDIO], "readwrite");
  tx.objectStore(META).delete(id);
  tx.objectStore(AUDIO).delete(id);
  await done(tx);
}
