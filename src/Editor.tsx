import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor as TiptapEditor } from "@tiptap/react";
import { BubbleMenu, FloatingMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import { NodeSelection } from "@tiptap/pm/state";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { GripVertical, ImagePlus, MessageSquare, Columns2, Play, Minus, Plus, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageFigure } from "./ImageFigure";
import { ImageRow } from "./ImageRow";
import { YoutubeFigure } from "./YoutubeFigure";
import { CommentMark } from "./CommentMark";
import CommentsPanel, { type PanelComment } from "./CommentsPanel";
import ShareButton from "./ShareButton";
import { insertImageFiles } from "./insertImages";
import { pickImageFiles } from "./pickFiles";
import { isImageFile } from "./images";
import type { CommentRecord, ShareInfo } from "./api";
import {
  fetchComments,
  setCommentResolved as setReaderResolved,
  deleteComment as deleteReaderComment,
  type ShareProgress,
} from "./share";
import type { ShareComment } from "../shared/types";

export type SaveState = "saved" | "saving" | "unsaved";

export interface ShareSnapshot {
  title: string;
  content: unknown;
}

function findCommentRange(editor: TiptapEditor, commentId: string): { from: number; to: number } | null {
  let range: { from: number; to: number } | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (range || !node.isText) return;
    if (node.marks.some((m) => m.type.name === "comment" && m.attrs.commentId === commentId)) {
      range = { from: pos, to: pos + node.nodeSize };
    }
  });
  return range;
}

/** Locate a reader's quoted passage in the live document (falls back to its opening words). */
function findQuoteRange(editor: TiptapEditor, quote: string): { from: number; to: number } | null {
  const needles = [quote, quote.slice(0, 40).trim()].filter((s) => s.length >= 3);
  for (const needle of needles) {
    let found: { from: number; to: number } | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (found || !node.isTextblock) return;
      const idx = node.textContent.indexOf(needle);
      if (idx >= 0) found = { from: pos + 1 + idx, to: pos + 1 + idx + needle.length };
    });
    if (found) return found;
  }
  return null;
}

function setCommentResolved(editor: TiptapEditor, commentId: string, resolved: boolean) {
  const { tr } = editor.state;
  editor.state.doc.descendants((node, pos) => {
    if (!node.isText) return;
    node.marks.forEach((mark) => {
      if (mark.type.name === "comment" && mark.attrs.commentId === commentId) {
        tr.addMark(pos, pos + node.nodeSize, mark.type.create({ ...mark.attrs, resolved }));
      }
    });
  });
  editor.view.dispatch(tr);
}

function hasFiles(e: DragEvent): boolean {
  return Array.from(e.dataTransfer?.types ?? []).includes("Files");
}

export default function Editor({
  docId,
  title,
  content,
  comments: initialComments,
  share,
  updatedAt,
  onDirty,
  onSave,
  onShare,
  onUnshare,
  onSeenComments,
}: {
  docId: string;
  title: string;
  content: unknown;
  comments: CommentRecord[];
  share: ShareInfo | null | undefined;
  updatedAt: string;
  onDirty: () => void;
  onSave: (title: string, content: unknown, comments: CommentRecord[]) => void;
  onShare: (snapshot: ShareSnapshot, author: string, onProgress: (p: ShareProgress) => void) => Promise<void>;
  onUnshare: () => Promise<void>;
  onSeenComments: () => void;
}) {
  const [comments, setComments] = useState<CommentRecord[]>(initialComments ?? []);
  const [readerComments, setReaderComments] = useState<ShareComment[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);
  const [seenAtOpen, setSeenAtOpen] = useState<string | null>(null);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const [dragging, setDragging] = useState(false);
  const [adding, setAdding] = useState<{ done: number; total: number } | null>(null);
  const [plusOpen, setPlusOpen] = useState(false);
  const saveTimer = useRef<number | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const commentsRef = useRef(comments);
  commentsRef.current = comments;

  const scheduleSave = useCallback(
    (ed: TiptapEditor) => {
      onDirty();
      if (saveTimer.current) window.clearTimeout(saveTimer.current);
      saveTimer.current = window.setTimeout(() => {
        onSave(titleRef.current?.value ?? "", ed.getJSON(), commentsRef.current);
      }, 800);
    },
    [onDirty, onSave]
  );

  const addFiles = useCallback(async (ed: TiptapEditor, files: File[], pos?: number, forceRow = false) => {
    const images = files.filter(isImageFile);
    if (!images.length) return;
    setAdding({ done: 0, total: images.length });
    try {
      await insertImageFiles(ed, images, { pos, forceRow, onProgress: (p) => setAdding(p) });
    } finally {
      setAdding(null);
    }
  }, []);

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        ImageFigure.configure({ inline: false, allowBase64: true }),
        ImageRow,
        YoutubeFigure.configure({ nocookie: true, modestBranding: true, addPasteHandler: true }),
        CommentMark,
        Placeholder.configure({ placeholder: "Begin writing, or drop in some photos…" }),
      ],
      content: content as any,
      autofocus: false,
      editorProps: {
        attributes: { class: "typeset typeset-article" },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []).filter(isImageFile);
          if (files.length) {
            addFiles(editorRef.current!, files);
            return true;
          }
          return false;
        },
        handleDrop: (view, event) => {
          const files = Array.from(event.dataTransfer?.files ?? []).filter(isImageFile);
          if (!files.length) return false;
          event.preventDefault();
          setDragging(false);
          const at = view.posAtCoords({ left: event.clientX, top: event.clientY });
          addFiles(editorRef.current!, files, at?.pos);
          return true;
        },
      },
      onUpdate: ({ editor }) => scheduleSave(editor),
    },
    [docId]
  );

  const editorRef = useRef<TiptapEditor | null>(null);
  editorRef.current = editor;

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

  // Whole-page drop target: photos dropped on the title or margins land at the end.
  useEffect(() => {
    let depth = 0;
    const enter = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth += 1;
      setDragging(true);
    };
    const over = (e: DragEvent) => {
      if (hasFiles(e)) e.preventDefault();
    };
    const leave = (e: DragEvent) => {
      if (!hasFiles(e)) return;
      depth = Math.max(0, depth - 1);
      if (depth === 0) setDragging(false);
    };
    const drop = (e: DragEvent) => {
      depth = 0;
      setDragging(false);
      if (!hasFiles(e)) return;
      const target = e.target as HTMLElement | null;
      if (target?.closest?.(".ProseMirror")) return; // ProseMirror's handleDrop owns this one
      e.preventDefault();
      const files = Array.from(e.dataTransfer?.files ?? []);
      const ed = editorRef.current;
      if (ed && files.length) addFiles(ed, files, ed.state.doc.content.size);
    };
    window.addEventListener("dragenter", enter);
    window.addEventListener("dragover", over);
    window.addEventListener("dragleave", leave);
    window.addEventListener("drop", drop);
    return () => {
      window.removeEventListener("dragenter", enter);
      window.removeEventListener("dragover", over);
      window.removeEventListener("dragleave", leave);
      window.removeEventListener("drop", drop);
    };
  }, [addFiles]);

  // Reader comments: poll gently while a shared document is open.
  const shareId = share?.id;
  const shareToken = share?.token;
  useEffect(() => {
    if (!shareId || !shareToken) {
      setReaderComments([]);
      return;
    }
    let cancelled = false;
    const info: ShareInfo = { id: shareId, token: shareToken, url: "", sharedAt: "" };
    const load = async () => {
      try {
        const list = await fetchComments(info);
        if (!cancelled) setReaderComments(list);
      } catch {
        /* offline or server down: keep what we have */
      }
    };
    load();
    const timer = window.setInterval(load, 30_000);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [shareId, shareToken]);

  // If the panel is already open when new reader comments arrive, they've been seen.
  const seenCommentsAt = share?.seenCommentsAt ?? "";
  useEffect(() => {
    if (!panelOpen || !share) return;
    if (readerComments.some((c) => !c.byAuthor && c.createdAt > seenCommentsAt)) onSeenComments();
  }, [readerComments, panelOpen, share, seenCommentsAt, onSeenComments]);

  const words = useMemo(() => {
    if (!editor) return 0;
    return editor.state.doc.textBetween(0, editor.state.doc.content.size, " ", " ").split(/\s+/).filter(Boolean).length;
  }, [editor, editor?.state]);

  if (!editor) return null;

  const addComment = () => {
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const id = crypto.randomUUID().slice(0, 8);
    editor.chain().focus().setComment(id).run();
    setDraftText("");
    setDraftId(id);
    openPanel();
  };

  const submitDraft = () => {
    if (!draftId || !draftText.trim()) return;
    const next = [
      ...commentsRef.current,
      { id: draftId, text: draftText.trim(), createdAt: new Date().toISOString(), resolved: false },
    ];
    setComments(next);
    commentsRef.current = next;
    onSave(titleRef.current?.value ?? "", editor.getJSON(), next);
    setDraftId(null);
    setDraftText("");
  };

  const cancelDraft = () => {
    if (draftId) editor.chain().unsetComment(draftId).run();
    setDraftId(null);
    setDraftText("");
  };

  const toggleResolve = async (c: PanelComment) => {
    const resolved = !c.resolved;
    if (c.kind === "reader") {
      if (!share) return;
      setReaderComments((list) => list.map((x) => (x.id === c.id ? { ...x, resolved } : x)));
      try {
        await setReaderResolved(share, c.id, resolved);
      } catch {
        setReaderComments((list) => list.map((x) => (x.id === c.id ? { ...x, resolved: !resolved } : x)));
      }
      return;
    }
    const next = commentsRef.current.map((x) => (x.id === c.id ? { ...x, resolved } : x));
    setComments(next);
    commentsRef.current = next;
    setCommentResolved(editor, c.id, resolved);
    onSave(titleRef.current?.value ?? "", editor.getJSON(), next);
  };

  const deleteComment = async (c: PanelComment) => {
    if (c.kind === "reader") {
      if (!share) return;
      const prev = readerComments;
      setReaderComments((list) => list.filter((x) => x.id !== c.id));
      try {
        await deleteReaderComment(share, c.id);
      } catch {
        setReaderComments(prev);
      }
      return;
    }
    const next = commentsRef.current.filter((x) => x.id !== c.id);
    setComments(next);
    commentsRef.current = next;
    editor.chain().unsetComment(c.id).run();
    onSave(titleRef.current?.value ?? "", editor.getJSON(), next);
  };

  const jumpTo = (c: PanelComment) => {
    const range = c.kind === "reader" ? (c.quote ? findQuoteRange(editor, c.quote) : null) : findCommentRange(editor, c.id);
    if (range) editor.chain().focus().setTextSelection(range).scrollIntoView().run();
  };

  const openPanel = () => {
    setSeenAtOpen(share?.seenCommentsAt ?? null);
    setPanelOpen(true);
    if (share) onSeenComments();
  };

  const addPhotos = async (forceRow = false) => {
    const files = await pickImageFiles(true);
    if (files.length) addFiles(editor, files, undefined, forceRow);
  };

  const addYoutube = () => {
    const url = window.prompt("Paste a YouTube link");
    if (url) editor.chain().focus().setYoutubeVideo({ src: url }).run();
  };

  const seenAt = share?.seenCommentsAt ?? "";
  const unread = readerComments.filter((c) => !c.resolved && !c.byAuthor && c.createdAt > seenAt).length;
  const openNotes = comments.filter((c) => !c.resolved).length;
  const badge = unread > 0 ? unread : openNotes + readerComments.filter((c) => !c.resolved).length;

  const panelComments: PanelComment[] = [
    ...comments.map((c) => ({ ...c, kind: "note" as const })),
    ...readerComments.map((c) => ({
      id: c.id,
      text: c.text,
      createdAt: c.createdAt,
      resolved: c.resolved,
      kind: "reader" as const,
      name: c.name,
      quote: c.quote,
      byAuthor: c.byAuthor,
      isNew: !c.byAuthor && c.createdAt > (seenAtOpen ?? ""),
    })),
  ].sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const stale = !!share && updatedAt > share.sharedAt;

  return (
    <div className={"editor-wrap" + (dragging ? " dragging" : "")}>
      <DragHandle editor={editor} className="drag-handle">
        <GripVertical className="size-3.5" />
      </DragHandle>

      <div className="top-actions">
        <Button variant="ghost" size="icon" className="size-8" title="Add photos" aria-label="Add photos" onClick={() => addPhotos()}>
          <ImagePlus />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-8 relative"
          title="Comments"
          aria-label="Comments"
          onClick={() => (panelOpen ? setPanelOpen(false) : openPanel())}
        >
          <MessageSquare />
          {badge > 0 && <span className={"comment-badge" + (unread > 0 ? " unread" : "")}>{badge}</span>}
        </Button>
        <ShareButton
          share={share ?? null}
          stale={stale}
          onShare={(author, onProgress) =>
            onShare({ title: titleRef.current?.value ?? title, content: editor.getJSON() }, author, onProgress)
          }
          onUnshare={onUnshare}
        />
      </div>

      <BubbleMenu
        editor={editor}
        className="bubble"
        shouldShow={({ editor, state, from, to }) =>
          editor.isEditable && from !== to && !(state.selection instanceof NodeSelection) && editor.view.hasFocus()
        }
      >
        <div className="bubble-scroll">
          <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} data-active={editor.isActive("bold")}>B</button>
          <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} data-active={editor.isActive("italic")}><em>I</em></button>
          <span className="sep" />
          <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} data-active={editor.isActive("heading", { level: 1 })}>H1</button>
          <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} data-active={editor.isActive("heading", { level: 2 })}>H2</button>
          <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} data-active={editor.isActive("heading", { level: 3 })}>H3</button>
          <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()} data-active={editor.isActive("blockquote")}>❝</button>
          <span className="sep" />
          <button type="button" onClick={addComment}>Comment</button>
        </div>
      </BubbleMenu>

      <FloatingMenu
        editor={editor}
        className={"plus-menu" + (plusOpen ? " open" : "")}
        options={{ placement: "left-start", offset: 6 }}
        shouldShow={(props) => {
          const { $anchor, empty } = props.state.selection;
          const block = $anchor.parent;
          const show = empty && $anchor.depth === 1 && block.type.name === "paragraph" && block.content.size === 0 && props.editor.isEditable;
          if (!show && plusOpen) setPlusOpen(false);
          return show;
        }}
      >
        <button
          type="button"
          className="plus-toggle"
          aria-label="Insert"
          aria-expanded={plusOpen}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setPlusOpen((o) => !o)}
        >
          <Plus className="size-4" />
        </button>
        {plusOpen && (
          <div className="plus-items" onMouseDown={(e) => e.preventDefault()}>
            <button type="button" onClick={() => { setPlusOpen(false); addPhotos(); }}>
              <ImageIcon className="size-4" /> Photos
            </button>
            <button type="button" onClick={() => { setPlusOpen(false); addPhotos(true); }}>
              <Columns2 className="size-4" /> Side by side
            </button>
            <button type="button" onClick={() => { setPlusOpen(false); addYoutube(); }}>
              <Play className="size-4" /> YouTube
            </button>
            <button type="button" onClick={() => { setPlusOpen(false); editor.chain().focus().setHorizontalRule().run(); }}>
              <Minus className="size-4" /> Divider
            </button>
          </div>
        )}
      </FloatingMenu>

      <div className="page">
        <input
          ref={titleRef}
          className="title"
          defaultValue={title}
          placeholder="Untitled"
          spellCheck={false}
          onChange={() => scheduleSave(editor)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              editor.chain().focus("start").run();
            }
          }}
        />
        <EditorContent editor={editor} />
        <div className="wordcount">{words} words</div>
      </div>

      {dragging && (
        <div className="drop-overlay" aria-hidden="true">
          <div className="drop-card">
            <ImagePlus className="size-6" />
            <span>Drop photos to add them</span>
            <small>Two or more land side by side</small>
          </div>
        </div>
      )}

      {adding && (
        <div className="adding-toast" role="status">
          Adding {adding.total === 1 ? "photo" : `${adding.done}/${adding.total} photos`}…
        </div>
      )}

      {panelOpen && <div className="comments-backdrop" onClick={() => setPanelOpen(false)} />}
      <CommentsPanel
        open={panelOpen}
        comments={panelComments}
        shareUrl={share?.url ?? null}
        draftActive={draftId !== null}
        draftText={draftText}
        onDraftChange={setDraftText}
        onDraftSubmit={submitDraft}
        onDraftCancel={cancelDraft}
        onJump={jumpTo}
        onToggleResolve={toggleResolve}
        onDelete={deleteComment}
        onClose={() => setPanelOpen(false)}
      />
    </div>
  );
}
