import { useState, useSyncExternalStore } from "react";
import { Cloud, CloudOff, Download, RefreshCw } from "lucide-react";
import { checkCloud, cloudStatus, exportBackup, loginCloud, logoutCloud, subscribeCloud, listLocalBackups, restoreLocalBackup, cloudRevisions, deletedCloudDocuments, restoreCloudRevision, importBackup, type LocalBackup } from "./cloud";
import type { CloudRecord } from "../shared/cloud";
export default function CloudPanel({ currentId, onSync }: { currentId?: string; onSync: () => Promise<void> }) {
  const status = useSyncExternalStore(subscribeCloud, cloudStatus);
  const [expanded, setExpanded] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [recovery, setRecovery] = useState<{local: LocalBackup[]; remote: CloudRecord[]} | null>(null);
  const [notice, setNotice] = useState("");
  async function loadRecovery() {
    const local = await listLocalBackups();
    let remote: CloudRecord[] = [];
    if (status.authenticated) {
      remote = await deletedCloudDocuments();
      if (currentId) remote = [...await cloudRevisions(currentId).catch(() => []), ...remote];
    }
    setRecovery({ local, remote });
  }
  async function action(fn: () => Promise<unknown>) { setBusy(true); setError(""); try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : "Please try again."); } finally { setBusy(false); } }
  return <section className="cloud-panel" aria-label="Private cloud storage">
    <button className="cloud-toggle" onClick={() => setExpanded(!expanded)} aria-expanded={expanded}>
      {status.authenticated ? <Cloud size={15} /> : <CloudOff size={15} />}<span aria-live="polite">{status.message}</span>
    </button>
    {expanded && <div className="cloud-details">
      {status.configured ? status.authenticated ? <>
        <p>Your documents and photos sync privately. Share links are separate. Offline changes stay here until reconnected.</p>
        <button disabled={busy || status.working} onClick={() => action(onSync)}><RefreshCw size={14} /> Sync now</button>
        <button disabled={busy || status.working} onClick={() => action(logoutCloud)}>Sign out</button>
        <small>Signing out keeps cached documents on this device. Use only trusted devices.</small>
      </> : <form onSubmit={event => { event.preventDefault(); const value = key; setKey(""); void action(() => loginCloud(value)); }}>
        <p>Sign in with your private library key on each device. Existing documents, photos and author permissions will be backed up to your private library. Original local copies are kept.</p>
        <label htmlFor="cloud-key">Private library key</label>
        <input id="cloud-key" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} required />
        <button disabled={busy || !key}>{busy ? "Connecting…" : "Connect and back up documents"}</button>
      </form> : <>
        <p>Cloud storage has not been configured on this server. Your documents are safe on this device only.</p>
        <button disabled={busy} onClick={() => action(checkCloud)}>Check connection</button>
      </>}
      <button disabled={busy} onClick={() => action(exportBackup)}><Download size={14} /> Download safety backup</button>
      <button disabled={busy} onClick={() => action(loadRecovery)}>Recover a document</button>
      <label className="cloud-import">Import safety backup<input type="file" accept="application/json,.json" onChange={event => {
        const file = event.target.files?.[0]; event.target.value = "";
        if (file) void action(async () => { const count = await importBackup(file); setNotice(`${count} recovered copies added. Existing documents were kept.`); });
      }} /></label>
      {recovery && <div className="cloud-recovery">
        <p>Restore creates a separate copy. Existing work is never replaced.</p>
        {recovery.local.slice(0, 50).map(backup => <button key={backup.id} disabled={busy} onClick={() => action(async () => { await restoreLocalBackup(backup.id); setNotice("Recovered copy added to your documents."); })}>
          {backup.document.title || "Untitled"} · {new Date(backup.createdAt).toLocaleString()}
        </button>)}
        {recovery.remote.map(record => <button key={`${record.id}:${record.version}`} disabled={busy} onClick={() => action(async () => { await restoreCloudRevision(record); setNotice("Recovered copy added to your documents."); })}>
          {record.deleted ? "Deleted document" : "Cloud version"} {record.version} · {new Date(record.updatedAt).toLocaleString()}
        </button>)}
        {!recovery.local.length && !recovery.remote.length && <p>No saved versions yet.</p>}
      </div>}
      {notice && <p role="status">{notice}</p>}
      {(error || status.error) && <p className="cloud-error" role="alert">{error || status.error}</p>}
    </div>}
  </section>;
}
