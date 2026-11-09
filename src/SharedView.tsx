import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { MessageSquare, PenLine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { api, type Doc } from "./api";
import { fetchShare, postComment, getReaderName, setReaderName, ShareError } from "./share";
import { applyHighlights, quoteFromSelection, type Quote } from "./anchors";
import { longDate, timeAgo } from "./time";
import type { ShareComment, SharePublic } from "../shared/types";

declare global {
  interface Window {
    __SHARE__?: SharePublic | null;
  }
}

interface Pending extends Quote {
  top: number;
  left: number;
  bottom: number;
}

export default function SharedView({ id }: { id: string }) {
  const [share, setShare] = useState<SharePublic | null | undefined>(() =>
    window.__SHARE__ && window.__SHARE__.id === id ? window.__SHARE__ : undefined
  );
  const [missing, setMissing] = useState(() => window.__SHARE__ === null);
  const [comments, setComments] = useState<ShareComment[]>(() => share?.comments ?? []);
  const [owner, setOwner] = useState<Doc | null>(null);
  const [pending, setPending] = useState<Pending | null>(null);
  const [composer, setComposer] = useState<Pending | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (share !== undefined) return;
    let cancelled = false;
    fetchShare(id)
      .then((s) => {
        if (cancelled) return;
        setShare(s);
        setComments(s.comments);
      })
      .catch((e: ShareError) => {
        if (cancelled) return;
        setMissing(true);
        setShare(null);
        if (e.status !== 404) console.error(e);
      });
    return () => {
      cancelled = true;
    };
  }, [id, share]);

  useEffect(() => {
    api.findByShare(id).then(setOwner).catch(() => setOwner(null));
  }, [id]);

  useEffect(() => {
    if (share) document.title = `${share.title || "Untitled"}${share.author ? ` — ${share.author}` : ""}`;
  }, [share]);

  // Paint highlights whenever the article or the comment set changes.
  useLayoutEffect(() => {
    const root = bodyRef.current;
    if (!root || !share) return;
    applyHighlights(
      root,
      comments.filter((c) => c.quote).map((c) => ({ id: c.id, quote: c.quote!, prefix: c.prefix, suffix: c.suffix, resolved: c.resolved }))
    );
  }, [share, comments]);

  // Offer a Comment button whenever the reader selects text in the article.
  useEffect(() => {
    let timer: number | null = null;
    const update = () => {
      const root = bodyRef.current;
      const page = rootRef.current;
      if (!root || !page) return;
      const sel = document.getSelection();
      const q = quoteFromSelection(root, sel);
      if (!q || !sel) {
        setPending(null);
        return;
      }
      const rect = sel.getRangeAt(0).getBoundingClientRect();
      const pageRect = page.getBoundingClientRect();
      setPending({
        ...q,
        top: rect.top - pageRect.top,
        bottom: rect.bottom - pageRect.top,
        left: rect.left - pageRect.left + rect.width / 2,
      });
    };
    const onChange = () => {
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(update, 120);
    };
    document.addEventListener("selectionchange", onChange);
    return () => {
      document.removeEventListener("selectionchange", onChange);
      if (timer) window.clearTimeout(timer);
    };
  }, []);

  const scrollToComment = useCallback((cid: string) => {
    const el = document.getElementById(`c-${cid}`);
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setFlash(cid);
    window.setTimeout(() => setFlash((f) => (f === cid ? null : f)), 1600);
  }, []);

  const scrollToMark = useCallback((cid: string) => {
    const mark = bodyRef.current?.querySelector<HTMLElement>(`mark[data-comment-id="${cid}"]`);
    if (!mark) return;
    mark.scrollIntoView({ behavior: "smooth", block: "center" });
    mark.classList.add("flash");
    window.setTimeout(() => mark.classList.remove("flash"), 1600);
  }, []);

  const onBodyClick = (e: React.MouseEvent) => {
    const mark = (e.target as HTMLElement).closest<HTMLElement>("mark[data-comment-id]");
    if (mark?.dataset.commentId) scrollToComment(mark.dataset.commentId);
  };

  const submit = async (text: string, name: string, quote: Quote | null) => {
    if (!share) return;
    setReaderName(name);
    const created = await postComment(
      share.id,
      { name, text, quote: quote?.quote ?? null, prefix: quote?.prefix ?? null, suffix: quote?.suffix ?? null },
      owner?.share?.token
    );
    setComments((list) => [...list, created]);
    if (quote) {
      setComposer(null);
      setPending(null);
      document.getSelection()?.removeAllRanges();
    }
  };

  if (missing || share === null) {
    return (
      <div className="shared shared-missing">
        <a className="wordmark" href="/">Write</a>
        <h1>This link isn't available</h1>
        <p>The author may have stopped sharing it, or the address was copied incompletely.</p>
        <Button variant="outline" onClick={() => (window.location.href = "/")}>Open Write</Button>
      </div>
    );
  }

  if (!share) {
    return (
      <div className="shared" aria-busy="true">
        <header className="shared-bar"><a className="wordmark" href="/">Write</a></header>
        <article className="shared-article skeleton">
          <div className="sk sk-title" />
          <div className="sk sk-line" />
          <div className="sk sk-line" />
          <div className="sk sk-line short" />
        </article>
      </div>
    );
  }

  const visible = comments;
  const openCount = comments.filter((c) => !c.resolved).length;

  return (
    <div className="shared" ref={rootRef}>
      <header className="shared-bar">
        <a className="wordmark" href="/">Write</a>
        <div className="shared-bar-right">
          <button type="button" className="shared-count" onClick={() => document.getElementById("comments")?.scrollIntoView({ behavior: "smooth" })}>
            <MessageSquare className="size-3.5" />
            {openCount === 0 ? "Comment" : `${openCount} ${openCount === 1 ? "comment" : "comments"}`}
          </button>
          {owner && (
            <a className="shared-edit" href={`/?doc=${owner.id}`}>
              <PenLine className="size-3.5" />
              Edit
            </a>
          )}
        </div>
      </header>

      <article className="shared-article">
        <header className="shared-head">
          <h1 className="shared-title">{share.title.trim() || "Untitled"}</h1>
          <div className="shared-byline">
            {share.author && (
              <>
                <span className="shared-avatar" aria-hidden="true">{share.author.slice(0, 1).toUpperCase()}</span>
                <span className="shared-author">{share.author}</span>
                <span className="dot">·</span>
              </>
            )}
            <time dateTime={share.createdAt}>{longDate(share.createdAt)}</time>
            {share.updatedAt > share.createdAt && <span className="shared-updated">Updated {timeAgo(share.updatedAt)}</span>}
          </div>
        </header>
        <div
          ref={bodyRef}
          className="typeset typeset-article shared-body"
          onClick={onBodyClick}
          dangerouslySetInnerHTML={{ __html: share.html }}
        />
      </article>

      <section id="comments" className="shared-comments">
        <div className="shared-comments-head">
          <h2>Comments</h2>
          <p>Highlight any passage to comment on it, or leave a note below.</p>
        </div>

        {visible.length > 0 && (
          <ol className="comment-list">
            {visible.map((c) => (
              <li key={c.id} id={`c-${c.id}`} className={"reader-comment" + (c.resolved ? " resolved" : "") + (flash === c.id ? " flash" : "")}>
                <div className="reader-comment-head">
                  <span className={"shared-avatar" + (c.byAuthor ? " author" : "")} aria-hidden="true">{c.name.slice(0, 1).toUpperCase()}</span>
                  <span className="reader-name">{c.name}</span>
                  {c.byAuthor && <span className="author-chip">Author</span>}
                  <span className="reader-time">{timeAgo(c.createdAt)}</span>
                  {c.resolved && <span className="reader-resolved">Resolved</span>}
                </div>
                {c.quote && (
                  <button type="button" className="reader-quote" onClick={() => scrollToMark(c.id)} title="Show in text">
                    {c.quote}
                  </button>
                )}
                <p className="reader-text">{c.text}</p>
              </li>
            ))}
          </ol>
        )}

        <Composer key="general" quote={null} defaultName={owner ? share.author ?? "" : undefined} onSubmit={(t, n) => submit(t, n, null)} />
      </section>

      <footer className="shared-footer">
        Written in <a href="/">Write</a>
      </footer>

      {pending && !composer && (
        <button
          type="button"
          className="sel-button"
          style={{ top: pending.top - 46, left: pending.left }}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setComposer(pending)}
        >
          <MessageSquare className="size-3.5" />
          Comment
        </button>
      )}

      {composer && (
        <div className="composer-float" style={{ top: composer.bottom + 12, left: composer.left }}>
          <Composer
            key={composer.quote}
            quote={composer.quote}
            defaultName={owner ? share.author ?? "" : undefined}
            autoFocus
            onCancel={() => {
              setComposer(null);
              setPending(null);
              document.getSelection()?.removeAllRanges();
            }}
            onSubmit={(t, n) => submit(t, n, composer)}
          />
        </div>
      )}
    </div>
  );
}

function Composer({
  quote,
  defaultName,
  autoFocus,
  onSubmit,
  onCancel,
}: {
  quote: string | null;
  /** The author's own browser posts as the author; readers get the name they used last time. */
  defaultName?: string;
  autoFocus?: boolean;
  onSubmit: (text: string, name: string) => Promise<void>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(() => defaultName || getReaderName());
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const post = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSubmit(text.trim(), name.trim() || "Someone");
      setText("");
      setDone(true);
      window.setTimeout(() => setDone(false), 2000);
    } catch (e) {
      setError((e as Error).message || "Couldn't post that. Try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className={"composer" + (quote ? " anchored" : "")}
      onSubmit={(e) => {
        e.preventDefault();
        post();
      }}
    >
      {quote && (
        <div className="composer-quote-row">
          <blockquote className="composer-quote">{quote}</blockquote>
          {onCancel && (
            <button type="button" className="composer-close" onClick={onCancel} aria-label="Cancel">
              <X className="size-4" />
            </button>
          )}
        </div>
      )}
      <Textarea
        autoFocus={autoFocus}
        value={text}
        rows={quote ? 2 : 3}
        placeholder={quote ? "Say something about this…" : "Share a thought with the author…"}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) post();
          if (e.key === "Escape") onCancel?.();
        }}
      />
      <div className="composer-row">
        <Input
          className="composer-name"
          value={name}
          placeholder="Your name"
          autoComplete="name"
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" size="sm" disabled={busy || !text.trim()}>
          {busy ? "Posting…" : done ? "Posted" : "Post"}
        </Button>
      </div>
      {error && <div className="share-error">{error}</div>}
    </form>
  );
}
