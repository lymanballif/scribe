import { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, EditorContent, type Editor as TiptapEditor } from "@tiptap/react";
import { BubbleMenu } from "@tiptap/react/menus";
import { DragHandle } from "@tiptap/extension-drag-handle-react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import { GripVertical, MessageSquare } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ImageFigure } from "./ImageFigure";
import { YoutubeFigure } from "./YoutubeFigure";
import { CommentMark } from "./CommentMark";
import CommentsPanel from "./CommentsPanel";
import PublishButton from "./PublishButton";
import { uploadImage, type CommentRecord } from "./api";

export type SaveState = "saved" | "saving" | "unsaved";

async function insertFiles(editor: TiptapEditor, files: File[]) {
  for (const file of files) {
    if (!file.type.startsWith("image/")) continue;
    const url = await uploadImage(file);
    editor.chain().focus().setImage({ src: url }).run();
  }
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

export default function Editor({
  docId,
  title,
  content,
  comments: initialComments,
  publishedSlug,
  onDirty,
  onSave,
  onPublish,
  onUnpublish,
}: {
  docId: string;
  title: string;
  content: unknown;
  comments: CommentRecord[];
  publishedSlug?: string | null;
  onDirty: () => void;
  onSave: (title: string, content: unknown, comments: CommentRecord[]) => void;
  onPublish: (slug: string) => Promise<string | null>;
  onUnpublish: () => Promise<void>;
}) {
  const [comments, setComments] = useState<CommentRecord[]>(initialComments ?? []);
  const [panelOpen, setPanelOpen] = useState(false);
  const [draftId, setDraftId] = useState<string | null>(null);
  const [draftText, setDraftText] = useState("");
  const saveTimer = useRef<number | null>(null);
  const titleRef = useRef<HTMLInputElement>(null);
  const commentsRef = useRef(comments);
  commentsRef.current = comments;

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
        ImageFigure.configure({ inline: false }),
        YoutubeFigure.configure({ nocookie: true, modestBranding: true, addPasteHandler: true }),
        CommentMark,
        Placeholder.configure({ placeholder: "Begin writing…" }),
      ],
      content: content as any,
      autofocus: false,
      editorProps: {
        attributes: { class: "typeset typeset-article" },
        handlePaste: (_view, event) => {
          const files = Array.from(event.clipboardData?.files ?? []);
          if (files.length) {
            insertFiles(editorRef.current!, files);
            return true;
          }
          return false;
        },
        handleDrop: (_view, event) => {
          const files = Array.from(event.dataTransfer?.files ?? []);
          if (files.length) {
            event.preventDefault();
            insertFiles(editorRef.current!, files);
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor }) => {
        onDirty();
        if (saveTimer.current) window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          onSave(titleRef.current?.value ?? "", editor.getJSON(), commentsRef.current);
        }, 800);
      },
    },
    [docId]
  );

  const editorRef = useRef<TiptapEditor | null>(null);
  editorRef.current = editor;

  useEffect(() => () => {
    if (saveTimer.current) window.clearTimeout(saveTimer.current);
  }, []);

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
    setPanelOpen(true);
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

  const toggleResolve = (c: CommentRecord) => {
    const resolved = !c.resolved;
    const next = commentsRef.current.map((x) => (x.id === c.id ? { ...x, resolved } : x));
    setComments(next);
    commentsRef.current = next;
    setCommentResolved(editor, c.id, resolved);
    onSave(titleRef.current?.value ?? "", editor.getJSON(), next);
  };

  const deleteComment = (c: CommentRecord) => {
    const next = commentsRef.current.filter((x) => x.id !== c.id);
    setComments(next);
    commentsRef.current = next;
    editor.chain().unsetComment(c.id).run();
    onSave(titleRef.current?.value ?? "", editor.getJSON(), next);
  };

  const jumpTo = (id: string) => {
    const range = findCommentRange(editor, id);
    if (range) editor.chain().focus().setTextSelection(range).scrollIntoView().run();
  };

  const openCount = comments.filter((c) => !c.resolved).length;

  return (
    <div className="editor-wrap">
      <DragHandle editor={editor} className="drag-handle">
        <GripVertical className="size-3.5" />
      </DragHandle>

      <div className="top-actions">
        <Button
          variant="ghost"
          size="icon"
          className="size-8 relative"
          title="Comments"
          onClick={() => setPanelOpen(!panelOpen)}
        >
          <MessageSquare />
          {openCount > 0 && <span className="comment-badge">{openCount}</span>}
        </Button>
        <PublishButton publishedSlug={publishedSlug} title={titleRef.current?.value ?? title} onPublish={onPublish} onUnpublish={onUnpublish} />
      </div>

      <BubbleMenu editor={editor} className="bubble">
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
          <button type="button" onClick={() => {
            const url = window.prompt("YouTube URL");
            if (url) editor.chain().focus().setYoutubeVideo({ src: url }).run();
          }}>YouTube</button>
          <button type="button" onClick={() => {
            const input = document.createElement("input");
            input.type = "file";
            input.accept = "image/*";
            input.multiple = true;
            input.onchange = () => insertFiles(editor, Array.from(input.files ?? []));
            input.click();
          }}>Image</button>
        </div>
      </BubbleMenu>

      <div className="page">
        <input
          ref={titleRef}
          className="title"
          defaultValue={title}
          placeholder="Untitled"
          spellCheck={false}
          onChange={() => {
            onDirty();
            if (saveTimer.current) window.clearTimeout(saveTimer.current);
            saveTimer.current = window.setTimeout(() => {
              onSave(titleRef.current?.value ?? "", editor.getJSON(), commentsRef.current);
            }, 800);
          }}
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

      {panelOpen && <div className="comments-backdrop" onClick={() => setPanelOpen(false)} />}
      <CommentsPanel
        open={panelOpen}
        comments={comments}
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
