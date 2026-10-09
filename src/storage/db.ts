/**
 * Lokalny magazyn zapisów w IndexedDB. Metadane i bloby są w osobnych magazynach,
 * żeby lista zapisów nie ładowała do pamięci wielomegabajtowych stanów świata.
 */
export interface SaveMeta {
  id: string;
  name: string;
  worldName: string;
  seed: number;
  tick: number;
  pop: number;
  savedAt: number;
  kind: 'auto' | 'manual';
  size: number;
  /** wersja silnika, która zapisała stan (brak = zapis sprzed wersjonowania metadanych) */
  engine?: string;
}

const DB_NAME = 'genesis';
const DB_VERSION = 1;

let dbp: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function putSave(meta: SaveMeta, bytes: Uint8Array): Promise<void> {
  const db = await open();
  const tx = db.transaction(['meta', 'blobs'], 'readwrite');
  tx.objectStore('meta').put(meta);
  tx.objectStore('blobs').put(bytes, meta.id);
  await new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

export async function listSaves(): Promise<SaveMeta[]> {
  const db = await open();
  const all = await wrap(db.transaction('meta').objectStore('meta').getAll() as IDBRequest<SaveMeta[]>);
  return all.sort((a, b) => b.savedAt - a.savedAt);
}

export async function getSaveBytes(id: string): Promise<Uint8Array | null> {
  const db = await open();
  const v = await wrap(db.transaction('blobs').objectStore('blobs').get(id) as IDBRequest<Uint8Array | undefined>);
  return v ?? null;
}

export async function deleteSave(id: string): Promise<void> {
  const db = await open();
  const tx = db.transaction(['meta', 'blobs'], 'readwrite');
  tx.objectStore('meta').delete(id);
  tx.objectStore('blobs').delete(id);
  await new Promise<void>((res, rej) => {
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}

/** Zostawia tylko `keep` najnowszych autozapisów danego świata. */
export async function pruneAuto(worldKey: string, keep: number): Promise<void> {
  const all = (await listSaves()).filter((s) => s.kind === 'auto' && s.worldName === worldKey);
  for (const s of all.slice(keep)) await deleteSave(s.id);
}

export function downloadBytes(name: string, data: Uint8Array | string, mime = 'application/octet-stream'): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
