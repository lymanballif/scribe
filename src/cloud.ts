import type { Doc } from "./api";
import { idbGetAll, idbGet, idbRequest, openDb, txDone } from "./db";
import { sha256Hex } from "./images";
import { CLOUD_CHUNK_BYTES, CLOUD_MAX_DOCUMENT_BYTES, stableStringify, type CloudRecord } from "../shared/cloud";

export interface SyncState { id: string; version: number; baseHash: string | null; pending: boolean; deleted: boolean; mutationId: string; }
export interface LocalBackup { id: string; document: Doc; createdAt: string; reason: string; }
export interface CloudStatus { configured: boolean; authenticated: boolean; working: boolean; message: string; error?: string; }
let status: CloudStatus = { configured: false, authenticated: false, working: false, message: "Saved on this device" };
const listeners = new Set<() => void>();
export const cloudStatus = () => status;
export function subscribeCloud(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener); }; }
function publish(patch: Partial<CloudStatus>) { status = { ...status, ...patch }; listeners.forEach(fn => fn()); }
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("scribe-documents");
const notifyLocal = (ids: string[]) => window.dispatchEvent(new CustomEvent("scribe-cloud-documents", { detail: ids }));
if (channel) channel.onmessage = event => { if (Array.isArray(event.data)) notifyLocal(event.data); };
const changed = (ids: string[]) => { notifyLocal(ids); channel?.postMessage(ids); };
const mutation = () => crypto.randomUUID();
let activeDocument: string | null = null;
export function holdDocument(id: string | null) { activeDocument = id; }
export async function refreshCloud() {
  const previous = activeDocument; activeDocument = null;
  await syncCloud();
  if (activeDocument === null) activeDocument = previous;
}
const freshState = (id: string): SyncState => ({ id, version: 0, baseHash: null, pending: true, deleted: false, mutationId: mutation() });

/** Document, queue state and safety snapshot change in one durable transaction. */
async function atomic(id: string, fn: (doc: Doc | undefined, state: SyncState | undefined, tx: IDBTransaction) => void) {
  const tx = (await openDb()).transaction(["docs", "sync", "backups"], "readwrite");
  const done = txDone(tx);
  try {
    const [doc, state] = await Promise.all([
      idbRequest<Doc | undefined>(tx.objectStore("docs").get(id)),
      idbRequest<SyncState | undefined>(tx.objectStore("sync").get(id)),
    ]);
    fn(doc, state, tx);
  } catch (error) { tx.abort(); await done.catch(() => {}); throw error; }
  await done;
}
function snapshot(tx: IDBTransaction, doc: Doc, reason: string, suffix: string) {
  tx.objectStore("backups").put({ id: `${doc.id}:${suffix}`, document: doc, reason, createdAt: new Date().toISOString() } satisfies LocalBackup);
}
export async function changeDocument(id: string, update: (doc: Doc | undefined) => Doc | null): Promise<Doc | null> {
  let result: Doc | null = null;
  await atomic(id, (doc, state, tx) => {
    result = update(doc);
    if (doc && !state) snapshot(tx, doc, "Original before cloud migration", "original");
    if (!result && doc) snapshot(tx, doc, "Deleted document", mutation());
    if (result) tx.objectStore("docs").put(result); else tx.objectStore("docs").delete(id);
    tx.objectStore("sync").put({ ...(state ?? freshState(id)), pending: true, deleted: !result, mutationId: mutation() });
  });
  channel?.postMessage([id]);
  if (status.authenticated) publish({ message: "Saved here · waiting to sync" });
  scheduleSync();
  return result;
}

class CloudError extends Error { constructor(message: string, public status: number, public current?: CloudRecord | null) { super(message); } }
async function request(path: string, init: RequestInit = {}): Promise<Response> {
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30000);
  try {
    const res = await fetch(`/api/cloud${path}`, { ...init, credentials: "same-origin", cache: "no-store", signal: controller.signal });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) publish({ authenticated: false });
      throw new CloudError(body.error ?? `Cloud request failed (${res.status})`, res.status, body.current);
    }
    return res;
  } finally { clearTimeout(timer); }
}
const jsonOptions = (method: string, value: unknown): RequestInit => ({ method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(value) });
export async function checkCloud() {
  try {
    const response = await request("/status");
    const result = await response.json();
    if (typeof result.configured !== "boolean") throw new Error("Cloud is not configured");
    publish({ configured: result.configured, authenticated: result.authenticated, message: result.authenticated ? "Checking cloud…" : result.configured ? "Sign in to sync" : "Cloud not set up · saved here", error: undefined });
    if (result.authenticated) await syncCloud();
  } catch { publish({ message: "Offline · saved on this device" }); }
}
export async function loginCloud(key: string) {
  await request("/login", jsonOptions("POST", { key }));
  publish({ configured: true, authenticated: true, error: undefined });
  await syncCloud();
}
export async function logoutCloud() {
  await request("/logout", jsonOptions("POST", {}));
  publish({ authenticated: false, working: false, message: "Signed out · local copies kept" });
}

async function listRemote(): Promise<CloudRecord[]> {
  const records: CloudRecord[] = []; let cursor: string | null = null;
  do {
    const page = await (await request(`/documents${cursor ? `?after=${encodeURIComponent(cursor)}` : ""}`)).json() as { documents: CloudRecord[]; nextCursor: string | null };
    records.push(...page.documents); cursor = page.nextCursor;
  } while (cursor);
  return records;
}
async function download(record: CloudRecord): Promise<Doc> {
  if (!record.hash || record.deleted) throw new Error("Document is deleted");
  if (record.byteLength > CLOUD_MAX_DOCUMENT_BYTES) throw new Error("Cloud document is too large");
  const bytes = new Uint8Array(record.byteLength); let offset = 0;
  for (const hash of record.chunkHashes) {
    const chunk = new Uint8Array(await (await request(`/chunks/${hash}`)).arrayBuffer());
    if (await sha256Hex(chunk) !== hash || offset + chunk.length > bytes.length) throw new Error("Photo/document verification failed; local copy kept");
    bytes.set(chunk, offset); offset += chunk.length;
  }
  if (offset !== bytes.length || await sha256Hex(bytes) !== record.hash) throw new Error("Document verification failed; local copy kept");
  const doc = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as Doc;
  if (doc.id !== record.id || typeof doc.title !== "string" || (doc.comments !== undefined && !Array.isArray(doc.comments))) throw new Error("Invalid cloud document; local copy kept");
  return doc;
}
async function upload(doc: Doc) {
  // Never rewrite image data URLs. Photos and comments round-trip byte-for-byte.
  const bytes = new TextEncoder().encode(stableStringify(doc));
  if (bytes.length > CLOUD_MAX_DOCUMENT_BYTES) throw new Error("This document exceeds 100 MB. It is safe locally but has not synced.");
  const hash = await sha256Hex(bytes); const chunkHashes: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += CLOUD_CHUNK_BYTES) {
    const chunk = bytes.slice(offset, offset + CLOUD_CHUNK_BYTES); const chunkHash = await sha256Hex(chunk);
    await request(`/chunks/${chunkHash}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: chunk });
    chunkHashes.push(chunkHash);
  }
  return { hash, chunkHashes, byteLength: bytes.length };
}

/** Check the local mutation again after every network round trip. Never replace newer typing. */
async function receive(record: CloudRecord, expected: SyncState | undefined, remote?: Doc) {
  const doc = record.deleted ? undefined : remote ?? await download(record);
  let applied = false;
  const apply = async () => atomic(record.id, (local, state, tx) => {
    if (activeDocument === record.id || state?.mutationId !== expected?.mutationId || state?.pending) return;
    if (local) snapshot(tx, local, "Before receiving a newer cloud version", `cloud-${record.version}`);
    if (doc) tx.objectStore("docs").put(doc); else tx.objectStore("docs").delete(record.id);
    tx.objectStore("sync").put({ id: record.id, version: record.version, baseHash: record.hash, pending: false, deleted: record.deleted, mutationId: mutation() } satisfies SyncState);
    applied = true;
  });
  if (navigator.locks) await navigator.locks.request(`scribe-edit-${record.id}`, { ifAvailable: true }, async lock => { if (lock) await apply(); });
  else await apply();
  if (applied) changed([record.id]);
}
async function conflict(local: Doc | undefined, state: SyncState, remote: CloudRecord) {
  const remoteDoc = remote.deleted ? undefined : await download(remote);
  const copyId = remoteDoc ? (await sha256Hex(new TextEncoder().encode(`cloud-conflict:${state.id}:${remote.version}:${remote.hash}`))).slice(0, 32) : null;
  let applied = false;
  await atomic(state.id, (current, currentState, tx) => {
    if (currentState?.mutationId !== state.mutationId) return;
    if (current) {
      // Keep the mounted editor's version in place. Preserve the other version
      // separately before retrying, so a late keystroke cannot destroy it.
      snapshot(tx, current, "Conflicting edits preserved", `conflict-${state.mutationId}`);
      if (remoteDoc && copyId) {
        tx.objectStore("docs").put({ ...remoteDoc, id: copyId, title: `${remoteDoc.title || "Untitled"} (cloud conflict copy)`, share: null });
        tx.objectStore("sync").put(freshState(copyId));
      }
      tx.objectStore("sync").put({ ...currentState, version: remote.version, baseHash: remote.hash, pending: true, mutationId: mutation() });
    } else {
      // A deletion may not erase a newer edit from another device.
      if (remoteDoc) tx.objectStore("docs").put(remoteDoc);
      tx.objectStore("sync").put({ id: state.id, version: remote.version, baseHash: remote.hash, pending: false, deleted: remote.deleted, mutationId: mutation() } satisfies SyncState);
    }
    applied = true;
  });
  if (applied) {
    publish({ message: local ? "Both edits kept · cloud conflict copy created" : "Deletion paused · newer cloud edit kept" });
    changed(local ? (copyId ? [copyId] : []) : [state.id]);
  }
}
let running: Promise<void> | null = null;
let rerun = false;
let timer: ReturnType<typeof setTimeout> | undefined;
export function scheduleSync() { if (timer) clearTimeout(timer); timer = setTimeout(() => void syncCloud(), 1200); }
export function syncCloud(): Promise<void> {
  if (!status.authenticated) return Promise.resolve();
  if (running) { rerun = true; return running; }
  running = (async () => {
    publish({ working: true, message: "Syncing…", error: undefined });
    try {
      // Web Locks prevents two tabs from importing the same legacy document simultaneously.
      const work = async () => {
        const initial = await idbGetAll<Doc>("docs");
        for (const doc of initial) await atomic(doc.id, (local, state, tx) => {
          if (local && !state) { snapshot(tx, local, "Original before cloud migration", "original"); tx.objectStore("sync").put(freshState(doc.id)); }
        });
        const documents = await listRemote();
        const remoteById = new Map(documents.map(record => [record.id, record]));
        for (const state of await idbGetAll<SyncState>("sync")) {
          if (!state.pending) continue;
          const local = await idbGet<Doc>("docs", state.id);
          if (!local && !state.deleted) throw new Error("Missing local document; sync stopped to protect it");
          const remote = remoteById.get(state.id);
          if (remote && remote.version !== state.version && remote.mutationId !== state.mutationId) {
            // Same original imported on another device: recognize bytes, don't create a duplicate.
            const same = local && !remote.deleted && await sha256Hex(new TextEncoder().encode(stableStringify(local))) === remote.hash;
            if (!same) { await conflict(local, state, remote); continue; }
          }
          let confirmed: CloudRecord;
          try {
            if (remote && remote.mutationId === state.mutationId) confirmed = remote;
            else if (remote && local && !remote.deleted && await sha256Hex(new TextEncoder().encode(stableStringify(local))) === remote.hash) confirmed = remote;
            else if (state.deleted) {
              if (!state.version && !remote) { await atomic(state.id, (_doc, current, tx) => { if (current?.mutationId === state.mutationId) tx.objectStore("sync").put({ ...current, pending: false }); }); continue; }
              confirmed = await (await request(`/documents/${state.id}`, jsonOptions("DELETE", { baseVersion: state.version, mutationId: state.mutationId }))).json();
            } else {
              const manifest = await upload(local!);
              confirmed = await (await request(`/documents/${state.id}`, jsonOptions("PUT", { ...manifest, baseVersion: state.version, mutationId: state.mutationId }))).json();
              // Verify server bytes before calling the upload complete, not merely HTTP success.
              const verified = await download(confirmed);
              if (stableStringify(verified) !== stableStringify(local)) throw new Error("Cloud verification failed; local copy kept");
            }
          } catch (error) {
            if (error instanceof CloudError && error.status === 409 && error.current) { await conflict(local, state, error.current); continue; }
            throw error;
          }
          await atomic(state.id, (_doc, current, tx) => {
            if (!current) return;
            tx.objectStore("sync").put({ ...current, version: confirmed.version, baseHash: confirmed.hash, pending: current.mutationId !== state.mutationId });
          });
          remoteById.set(state.id, confirmed);
        }
        // Refresh the manifest list, so a concurrent device's latest commit isn't missed.
        const latest = await listRemote();
        let newerActive = false;
        for (const remote of latest) {
          const state = await idbGet<SyncState>("sync", remote.id);
          if (!state?.pending && remote.version !== state?.version) {
            if (activeDocument === remote.id) newerActive = true;
            else await receive(remote, state);
          }
        }
        const pending = (await idbGetAll<SyncState>("sync")).filter(state => state.pending).length;
        publish({ message: newerActive ? "Newer cloud edit · use Sync now" : pending ? `${pending} document${pending === 1 ? "" : "s"} waiting to sync` : "All changes in cloud", working: false });
        if (pending) rerun = true;
      };
      if (navigator.locks) await navigator.locks.request("scribe-cloud-sync", work); else await work();
    } catch (error) {
      publish({ working: false, message: "Saved here · cloud sync paused", error: error instanceof Error ? error.message : "Cloud connection failed" });
    }
  })().finally(() => { running = null; if (rerun) { rerun = false; scheduleSync(); } });
  return running;
}
export function startCloud() {
  void checkCloud();
  const online = () => void checkCloud();
  const visibility = () => { if (document.visibilityState === "visible") void checkCloud(); };
  window.addEventListener("online", online); document.addEventListener("visibilitychange", visibility);
  const poll = setInterval(() => { if (document.visibilityState === "visible") void syncCloud(); }, 15000);
  return () => { clearInterval(poll); window.removeEventListener("online", online); document.removeEventListener("visibilitychange", visibility); };
}
export async function exportBackup() {
  const [documents, backups] = await Promise.all([idbGetAll<Doc>("docs"), idbGetAll<LocalBackup>("backups")]);
  const blob = new Blob([JSON.stringify({ format: "scribe-backup-v1", exportedAt: new Date().toISOString(), documents, backups })], { type: "application/json" });
  const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `scribe-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function listLocalBackups(): Promise<LocalBackup[]> {
  return (await idbGetAll<LocalBackup>("backups")).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
async function recoverCopy(doc: Doc, source: string) {
  const id = (await sha256Hex(new TextEncoder().encode(`recovered:${source}`))).slice(0, 32);
  // Repeated recovery of the same snapshot is idempotent.
  await changeDocument(id, current => current ?? ({ ...doc, id, title: `${doc.title || "Untitled"} (recovered)`, share: null, updatedAt: new Date().toISOString() }));
  changed([id]); return id;
}
export async function restoreLocalBackup(id: string) {
  const backup = await idbGet<LocalBackup>("backups", id);
  if (!backup) throw new Error("Backup not found");
  return recoverCopy(backup.document, id);
}
export async function cloudRevisions(id: string): Promise<CloudRecord[]> {
  return (await (await request(`/documents/${encodeURIComponent(id)}/revisions`)).json()).revisions;
}
export async function deletedCloudDocuments() { return (await listRemote()).filter(record => record.deleted); }
export async function restoreCloudRevision(record: CloudRecord) {
  const doc = await download({ ...record, deleted: false });
  return recoverCopy(doc, `${record.id}:cloud:${record.version}`);
}
export async function importBackup(file: File) {
  if (file.size > 200 * 1024 * 1024) throw new Error("Backup is too large to import in one step");
  const input = JSON.parse(await file.text());
  if (input.format !== "scribe-backup-v1" || !Array.isArray(input.documents)) throw new Error("Choose a Scribe safety backup JSON file");
  const documents: Doc[] = input.documents;
  if (!documents.every(doc => typeof doc.id === "string" && typeof doc.title === "string" && (doc.comments === undefined || Array.isArray(doc.comments)) && typeof doc.createdAt === "string")) throw new Error("Backup is incomplete. Nothing was imported.");
  const backups: LocalBackup[] = Array.isArray(input.backups) ? input.backups : [];
  if (!backups.every(backup => typeof backup.id === "string" && backup.document && typeof backup.document.id === "string" && typeof backup.document.title === "string" && (backup.document.comments === undefined || Array.isArray(backup.document.comments)))) throw new Error("Backup snapshots are incomplete. Nothing was imported.");
  // Preserve deleted documents and migration originals too, so Recover remains useful on another device.
  const tx = (await openDb()).transaction("backups", "readwrite"); const done = txDone(tx);
  for (const backup of backups) tx.objectStore("backups").put({ ...backup, id: `import:${backup.id}` });
  await done;
  for (const doc of documents) await recoverCopy(doc, `import:${await sha256Hex(new TextEncoder().encode(stableStringify(doc)))}`);
  return documents.length;
}
