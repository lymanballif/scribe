import { useEffect, useState, useRef, type ReactNode } from "react";
import { api, type Doc } from "./api";
/** A mounted editor owns its document. Another tab must not edit a stale snapshot. */
export default function EditorLease({ id, onLoad, children }: { id: string; onLoad: (doc: Doc) => void; children: (doc: Doc) => ReactNode }) {
  const [owned, setOwned] = useState(false);
  const [document, setDocument] = useState<Doc | null>(null);
  const loaded = useRef(onLoad); loaded.current = onLoad;
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let cancelled = false; let release: (() => void) | undefined;
    setOwned(false);
    if (navigator.locks) void navigator.locks.request(`scribe-edit-${id}`, { ifAvailable: true }, async lock => {
      if (!lock || cancelled) return;
      // Read under the editing lease, never promote a pre-lock snapshot.
      const fresh = await api.get(id).catch(() => null);
      if (!fresh || cancelled) return;
      loaded.current(fresh); setDocument(fresh); setOwned(true);
      await new Promise<void>(resolve => { release = resolve; if (cancelled) resolve(); });
    });
    return () => { cancelled = true; release?.(); };
  }, [id, attempt]);
  if (owned && document) return children(document);
  return <div className="welcome"><p>{navigator.locks ? "This document is open in another tab, or is finishing a sync." : "Use an up-to-date browser to edit documents safely."}</p><button onClick={() => setAttempt(value => value + 1)}>Try again</button></div>;
}
