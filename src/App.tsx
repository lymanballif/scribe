import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Sun, Moon, PanelLeft, X, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type DocMeta, type Doc, type CommentRecord } from "./api";
import Editor, { type SaveState, type ShareSnapshot } from "./Editor";
import SharedView from "./SharedView";
import { publishShare, deleteShare, type ShareProgress } from "./share";

type Theme = "light" | "dark";

function initialTheme(): Theme {
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function sharePathId(): string | null {
  const m = /^\/s\/([a-z0-9]{6,32})\/?$/i.exec(window.location.pathname);
  return m ? m[1].toLowerCase() : null;
}

function requestedDocId(): string | null {
  const id = new URLSearchParams(window.location.search).get("doc");
  return id && /^[a-f0-9]{8,32}$/i.test(id) ? id : null;
}

export default function App() {
  const [shareId] = useState(sharePathId);
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [current, setCurrent] = useState<Doc | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const [sharedIds, setSharedIds] = useState<Set<string>>(new Set());
  const currentRef = useRef<Doc | null>(null);
  currentRef.current = current;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  const refresh = useCallback(async () => {
    const list = await api.list();
    setDocs(list);
    setSharedIds(new Set(list.filter((m) => m.shared).map((m) => m.id)));
  }, []);

  useEffect(() => {
    if (shareId) return;
    (async () => {
      await refresh();
      const list = await api.list();
      const wanted = requestedDocId();
      if (wanted) {
        window.history.replaceState({}, "", "/");
        const doc = await api.get(wanted).catch(() => null);
        if (doc) {
          setCurrent(doc);
          return;
        }
      }
      if (list[0] && window.innerWidth > 720) setCurrent(await api.get(list[0].id));
    })();
  }, [shareId, refresh]);

  const open = async (id: string) => {
    setMenuOpen(false);
    if (currentRef.current?.id === id) return;
    setSaveState("saved");
    setCurrent(await api.get(id));
  };

  const createDoc = async () => {
    const doc = await api.create();
    await refresh();
    setSaveState("saved");
    setMenuOpen(false);
    setCurrent(doc);
  };

  const removeDoc = async (id: string) => {
    const doc = await api.get(id).catch(() => null);
    if (doc?.share) await deleteShare(doc.share).catch(() => {});
    await api.remove(id);
    const list = await api.list();
    setDocs(list);
    setSharedIds((s) => {
      const n = new Set(s);
      n.delete(id);
      return n;
    });
    if (currentRef.current?.id === id) {
      setSaveState("saved");
      setCurrent(list[0] && window.innerWidth > 720 ? await api.get(list[0].id) : null);
    }
  };

  const save = useCallback(async (title: string, content: unknown, comments: CommentRecord[]) => {
    const doc = currentRef.current;
    if (!doc) return;
    setSaveState("saving");
    try {
      const { updatedAt } = await api.save(doc.id, title, content, comments);
      setSaveState("saved");
      setCurrent((c) => (c && c.id === doc.id ? { ...c, title, content, comments, updatedAt } : c));
      setDocs((d) =>
        d
          ? d
              .map((m) => (m.id === doc.id ? { ...m, title, updatedAt } : m))
              .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          : d
      );
    } catch {
      setSaveState("unsaved");
    }
  }, []);

  const share = useCallback(async (snapshot: ShareSnapshot, author: string, onProgress: (p: ShareProgress) => void) => {
    const doc = currentRef.current;
    if (!doc) return;
    // Flush what's on screen first so the link matches exactly what the author sees.
    const { updatedAt } = await api.save(doc.id, snapshot.title, snapshot.content, doc.comments);
    const fresh: Doc = { ...doc, title: snapshot.title, content: snapshot.content, updatedAt };
    const info = await publishShare(fresh, author, onProgress);
    await api.setShare(doc.id, info);
    setCurrent((c) => (c && c.id === doc.id ? { ...c, title: fresh.title, content: fresh.content, updatedAt, share: info } : c));
    setDocs((d) => (d ? d.map((m) => (m.id === doc.id ? { ...m, title: fresh.title, updatedAt } : m)) : d));
    setSharedIds((s) => new Set(s).add(doc.id));
  }, []);

  const unshare = useCallback(async () => {
    const doc = currentRef.current;
    if (!doc?.share) return;
    await deleteShare(doc.share);
    await api.setShare(doc.id, null);
    setCurrent((c) => (c && c.id === doc.id ? { ...c, share: null } : c));
    setSharedIds((s) => {
      const n = new Set(s);
      n.delete(doc.id);
      return n;
    });
  }, []);

  const seenComments = useCallback(async () => {
    const doc = currentRef.current;
    if (!doc?.share) return;
    const info = { ...doc.share, seenCommentsAt: new Date().toISOString() };
    await api.setShare(doc.id, info);
    setCurrent((c) => (c && c.id === doc.id ? { ...c, share: info } : c));
  }, []);

  const status = current
    ? saveState === "saved"
      ? "Saved"
      : saveState === "saving"
        ? "Saving…"
        : "Editing…"
    : "";

  if (shareId) {
    return <SharedView id={shareId} />;
  }

  return (
    <div className="app">
      {menuOpen && <div className="backdrop" onClick={() => setMenuOpen(false)} />}

      <aside className={"sidebar" + (menuOpen ? " open" : "")} aria-label="Documents">
        <div className="sidebar-top">
          <Button variant="outline" size="sm" className="new-doc-btn" onClick={createDoc}>
            <Plus data-icon="inline-start" />
            New document
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="sidebar-close size-8"
            onClick={() => setMenuOpen(false)}
            aria-label="Close menu"
          >
            <X />
          </Button>
        </div>
        <div className="doc-list">
          {docs === null ? null : docs.length === 0 ? (
            <div className="empty">No documents yet.</div>
          ) : (
            docs.map((d) => (
              <div
                key={d.id}
                className={"doc-item" + (current?.id === d.id ? " active" : "")}
                onClick={() => open(d.id)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    open(d.id);
                  }
                }}
              >
                <div className="doc-title">{d.title.trim() || "Untitled"}</div>
                <div className="doc-date">
                  {new Date(d.updatedAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  {sharedIds.has(d.id) && (
                    <span className="doc-shared" title="Shared">
                      <Link2 className="size-3" />
                    </span>
                  )}
                </div>
                <button
                  className="doc-delete"
                  title="Delete"
                  aria-label="Delete document"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm(sharedIds.has(d.id) ? "Delete this document? Its shared link will stop working." : "Delete this document?")) removeDoc(d.id);
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
        <div className="sidebar-bottom">
          <span className="sidebar-status">{status}</span>
          <Button
            variant="outline"
            size="icon"
            className="size-8"
            title={theme === "dark" ? "Light mode" : "Dark mode"}
            aria-label={theme === "dark" ? "Light mode" : "Dark mode"}
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            {theme === "dark" ? <Sun /> : <Moon />}
          </Button>
        </div>
      </aside>

      <main className="main">
        <header className="mobile-bar">
          <Button variant="ghost" size="icon" className="size-9" onClick={() => setMenuOpen(true)} aria-label="Documents">
            <PanelLeft />
          </Button>
          <span className="mobile-title">
            {current ? current.title.trim() || "Untitled" : "Write"}
          </span>
          <span className="mobile-status">{status}</span>
        </header>
        {current ? (
          <Editor
            key={current.id}
            docId={current.id}
            title={current.title}
            content={current.content}
            comments={current.comments ?? []}
            share={current.share}
            updatedAt={current.updatedAt}
            onDirty={() => setSaveState("unsaved")}
            onSave={save}
            onShare={share}
            onUnshare={unshare}
            onSeenComments={seenComments}
          />
        ) : (
          <div className="welcome">
            <p>Your ideas, kept safe.</p>
            <Button variant="outline" size="lg" onClick={createDoc}>
              Start writing
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
