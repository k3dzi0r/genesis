/** Complete specimens have their own durable store, independent of lineage pruning. */
import { validateSpecimen, type Specimen } from '../engine/behavior';
export interface AtlasRecord { id: string; savedAt: number; specimen: Specimen }
let pending: Promise<IDBDatabase> | null = null;
function open(): Promise<IDBDatabase> {
  return pending ??= new Promise((resolve, reject) => {
    const req = indexedDB.open('genesis-atlas', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('specimens', { keyPath: 'id' });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { pending = null; reject(req.error); };
  });
}
export async function listSpecimens(): Promise<AtlasRecord[]> {
  const db = await open();
  return new Promise((resolve, reject) => {
    const req = db.transaction('specimens').objectStore('specimens').getAll();
    req.onsuccess = () => resolve((req.result as AtlasRecord[]).map(record=>{
      try { return {...record,specimen:validateSpecimen(record.specimen)}; } catch { return record; }
    }).sort((a, b) => b.savedAt - a.savedAt));
    req.onerror = () => reject(req.error);
  });
}
export async function putSpecimen(specimen: Specimen, id?: string): Promise<string> {
  const db = await open();
  const key = id ?? crypto.randomUUID();
  const record: AtlasRecord = { id: key, savedAt: Date.now(), specimen: validateSpecimen(specimen) };
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('specimens', 'readwrite');
    tx.objectStore('specimens').put(record);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
  return key;
}
export async function deleteSpecimen(id: string): Promise<void> {
  const db = await open();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction('specimens', 'readwrite'); tx.objectStore('specimens').delete(id);
    tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
  });
}
export function specimenToJson(specimen: Specimen): string { return JSON.stringify(validateSpecimen(specimen), (_key, val) => val === Infinity ? 'Infinity' : val === -Infinity ? '-Infinity' : val, 2); }
export function specimenFromJson(text: string): Specimen {
  if (text.length > 8_000_000) throw new Error('Plik okazu jest za duży.');
  return validateSpecimen(JSON.parse(text, (key, val) => key === 't' && val === 'Infinity' ? Infinity : key === 't' && val === '-Infinity' ? -Infinity : val));
}
