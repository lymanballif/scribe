import { Check, ExternalLink, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { timeAgo } from "./time";

export interface PanelComment {
  id: string;
  text: string;
  createdAt: string;
  resolved: boolean;
  /** "note" = the author's own margin note; "reader" = posted on the shared page. */
  kind: "note" | "reader";
  name?: string;
  quote?: string | null;
  byAuthor?: boolean;
  isNew?: boolean;
}

export default function CommentsPanel({
  open,
  comments,
  shareUrl,
  draftActive,
  draftText,
  onDraftChange,
  onDraftSubmit,
  onDraftCancel,
  onJump,
  onToggleResolve,
  onDelete,
  onClose,
}: {
  open: boolean;
  comments: PanelComment[];
  shareUrl: string | null;
  draftActive: boolean;
  draftText: string;
  onDraftChange: (text: string) => void;
  onDraftSubmit: () => void;
  onDraftCancel: () => void;
  onJump: (c: PanelComment) => void;
  onToggleResolve: (c: PanelComment) => void;
  onDelete: (c: PanelComment) => void;
  onClose?: () => void;
}) {
  const open_ = comments.filter((c) => !c.resolved);
  const resolved = comments.filter((c) => c.resolved);

  return (
    <div className={"comments-panel" + (open ? " open" : "")} aria-hidden={!open}>
      <div className="comments-panel-header">
        <span className="comments-panel-title">Comments</span>
        {onClose && (
          <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="Close comments">
            <X />
          </Button>
        )}
      </div>

      {draftActive && (
        <div className="comment-card draft">
          <Textarea
            autoFocus
            value={draftText}
            placeholder="Note to self…"
            rows={3}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onDraftSubmit();
              if (e.key === "Escape") onDraftCancel();
            }}
          />
          <div className="comment-actions">
            <Button size="sm" onClick={onDraftSubmit} disabled={!draftText.trim()}>Add note</Button>
            <Button size="sm" variant="ghost" onClick={onDraftCancel}>Cancel</Button>
          </div>
        </div>
      )}

      {comments.length === 0 && !draftActive ? (
        <div className="empty">
          <p>Select text and choose <strong>Comment</strong> to leave yourself a note.</p>
          {shareUrl ? (
            <p>Comments from readers of your shared link will show up here.</p>
          ) : (
            <p>Share the document and readers can comment on it too.</p>
          )}
        </div>
      ) : (
        <>
          {open_.map((c) => (
            <CommentCard key={c.id} c={c} onJump={onJump} onToggleResolve={onToggleResolve} onDelete={onDelete} />
          ))}
          {resolved.length > 0 && (
            <details className="resolved-group">
              <summary>{resolved.length} resolved</summary>
              {resolved.map((c) => (
                <CommentCard key={c.id} c={c} onJump={onJump} onToggleResolve={onToggleResolve} onDelete={onDelete} />
              ))}
            </details>
          )}
        </>
      )}

      {shareUrl && (
        <a className="panel-share-link" href={shareUrl} target="_blank" rel="noreferrer">
          <ExternalLink className="size-3" />
          Open the shared page
        </a>
      )}
    </div>
  );
}

function CommentCard({
  c,
  onJump,
  onToggleResolve,
  onDelete,
}: {
  c: PanelComment;
  onJump: (c: PanelComment) => void;
  onToggleResolve: (c: PanelComment) => void;
  onDelete: (c: PanelComment) => void;
}) {
  return (
    <div className={"comment-card" + (c.resolved ? " resolved" : "") + (c.kind === "reader" ? " reader" : "")} onClick={() => onJump(c)}>
      <div className="comment-head">
        {c.kind === "reader" ? (
          <>
            <span className="comment-avatar" aria-hidden="true">{(c.name ?? "?").slice(0, 1).toUpperCase()}</span>
            <span className="comment-name">{c.byAuthor ? `${c.name} (you)` : c.name}</span>
          </>
        ) : (
          <span className="comment-name muted">Note to self</span>
        )}
        {c.isNew && !c.resolved && <span className="comment-new">New</span>}
      </div>
      {c.quote && <blockquote className="comment-quote">{c.quote}</blockquote>}
      <div className="comment-text">{c.text}</div>
      <div className="comment-meta">
        {timeAgo(c.createdAt)}
        {c.resolved ? " · Resolved" : ""}
      </div>
      <div className="comment-icons" onClick={(e) => e.stopPropagation()}>
        <button type="button" title={c.resolved ? "Reopen" : "Resolve"} onClick={() => onToggleResolve(c)}>
          <Check className="size-3.5" />
        </button>
        <button type="button" title="Delete" onClick={() => onDelete(c)}>
          <Trash2 className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
