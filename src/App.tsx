import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Sun, Moon, PanelLeft, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { api, type DocMeta, type Doc, type CommentRecord, type PublishedRecord } from "./api";
import Editor, { type SaveState } from "./Editor";
import PublishedView from "./PublishedView";

type Theme = "light" | "dark";

function initialTheme(): Theme {
  const saved = localStorage.getItem("theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function pathSlug(): string | null {
  const path = window.location.pathname.replace(/^\/+|\/+$/g, "");
  if (!path || path.includes("/")) return null;
  if (!/^[a-z0-9][a-z0-9-]{0,80}$/i.test(path)) return null;
  // Reserved app paths
  if (["api", "uploads", "fonts", "assets", "sw.js"].includes(path.toLowerCase())) return null;
  return path.toLowerCase();
}

export default function App() {
  const [docs, setDocs] = useState<DocMeta[] | null>(null);
  const [current, setCurrent] = useState<Doc | null>(null);
  const [saveState, setSaveState] = useState<SaveState>("saved");
  const [theme, setTheme] = useState<Theme>(initialTheme);
  const [menuOpen, setMenuOpen] = useState(false);
  const [published, setPublished] = useState<PublishedRecord | null | undefined>(() =>
    pathSlug() ? undefined : null
  );
  const currentRef = useRef<Doc | null>(null);
  currentRef.current = current;

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    localStorage.setItem("theme", theme);
  }, [theme]);

  // Published article routes
  useEffect(() => {
    const slug = pathSlug();
    if (!slug) {
      setPublished(null);
      return;
    }
    let cancelled = false;
    (async () => {
      const rec = await api.getPublished(slug);
      if (!cancelled) setPublished(rec);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const refresh = useCallback(async () => setDocs(await api.list()), []);

  useEffect(() => {
    if (published !== null) return; // wait until we know we're not on a published page
    (async () => {
      const list = await api.list();
      setDocs(list);
      if (list[0] && window.innerWidth > 720) setCurrent(await api.get(list[0].id));
    })();
  }, [published]);

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
    await api.remove(id);
    const list = await api.list();
    setDocs(list);
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

  const publish = useCallback(async (slug: string): Promise<string | null> => {
    const doc = currentRef.current;
    if (!doc) return null;
    try {
      await api.publish(doc.id, slug);
      setCurrent((c) => (c ? { ...c, publishedSlug: slug } : c));
      return null;
    } catch (e) {
      return (e as Error).message;
    }
  }, []);

  const unpublish = useCallback(async () => {
    const doc = currentRef.current;
    if (!doc) return;
    await api.unpublish(doc.id);
    setCurrent((c) => (c ? { ...c, publishedSlug: null } : c));
  }, []);

  const leavePublished = () => {
    window.history.pushState({}, "", "/");
    setPublished(null);
  };

  const status = current
    ? saveState === "saved"
      ? "Saved"
      : saveState === "saving"
        ? "Saving…"
        : "Editing…"
    : "";

  if (published === undefined) {
    return <div className="app-loading" aria-busy="true" />;
  }

  if (published) {
    return <PublishedView record={published} onBack={leavePublished} />;
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
                </div>
                <button
                  className="doc-delete"
                  title="Delete"
                  aria-label="Delete document"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (confirm("Delete this document?")) removeDoc(d.id);
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
            publishedSlug={current.publishedSlug}
            onDirty={() => setSaveState("unsaved")}
            onSave={save}
            onPublish={publish}
            onUnpublish={unpublish}
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
