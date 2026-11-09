const DB_NAME = "scribe";
const DB_VERSION = 2;
export type StoreName = "docs" | "published" | "uploads" | "sync" | "backups";
let opening: Promise<IDBDatabase> | undefined;
export function openDb(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of ["docs", "published", "uploads", "sync", "backups"] as StoreName[]) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath: name === "published" ? "slug" : "id" });
      }
    };
    req.onsuccess = () => {
      req.result.onversionchange = () => { req.result.close(); opening = undefined; };
      resolve(req.result);
    };
    req.onerror = () => { opening = undefined; reject(req.error); };
    req.onblocked = () => { console.warn("Close older Write tabs to finish the safe storage upgrade."); };
  });
  return opening;
}
export function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
}
export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => { tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error ?? new Error("Storage transaction aborted")); });
}
export async function idbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  return idbRequest((await openDb()).transaction(store, "readonly").objectStore(store).get(key));
}
export async function idbGetAll<T>(store: StoreName): Promise<T[]> {
  return idbRequest((await openDb()).transaction(store, "readonly").objectStore(store).getAll());
}
export async function idbPut<T>(store: StoreName, value: T): Promise<void> {
  const tx = (await openDb()).transaction(store, "readwrite"); const done = txDone(tx);
  tx.objectStore(store).put(value); await done;
}
export async function idbDelete(store: StoreName, key: string): Promise<void> {
  const tx = (await openDb()).transaction(store, "readwrite"); const done = txDone(tx);
  tx.objectStore(store).delete(key); await done;
}
