import { Check, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import type { CommentRecord } from "./api";

export default function CommentsPanel({
  open,
  comments,
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
  comments: CommentRecord[];
  draftActive: boolean;
  draftText: string;
  onDraftChange: (text: string) => void;
  onDraftSubmit: () => void;
  onDraftCancel: () => void;
  onJump: (id: string) => void;
  onToggleResolve: (c: CommentRecord) => void;
  onDelete: (c: CommentRecord) => void;
  onClose?: () => void;
}) {
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
            placeholder="Add a comment…"
            rows={3}
            onChange={(e) => onDraftChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onDraftSubmit();
              if (e.key === "Escape") onDraftCancel();
            }}
          />
          <div className="comment-actions">
            <Button size="sm" onClick={onDraftSubmit} disabled={!draftText.trim()}>Comment</Button>
            <Button size="sm" variant="ghost" onClick={onDraftCancel}>Cancel</Button>
          </div>
        </div>
      )}

      {comments.length === 0 && !draftActive ? (
        <div className="empty">Select text and choose Comment to annotate your draft.</div>
      ) : (
        [...comments].reverse().map((c) => (
          <div
            key={c.id}
            className={"comment-card" + (c.resolved ? " resolved" : "")}
            onClick={() => onJump(c.id)}
          >
            <div className="comment-text">{c.text}</div>
            <div className="comment-meta">
              {new Date(c.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              {c.resolved ? " · Resolved" : ""}
            </div>
            <div className="comment-icons" onClick={(e) => e.stopPropagation()}>
              <button title={c.resolved ? "Reopen" : "Resolve"} onClick={() => onToggleResolve(c)}>
                <Check className="size-3.5" />
              </button>
              <button title="Delete" onClick={() => onDelete(c)}>
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
