import { idbGet, idbGetAll } from "./db";
import { changeDocument } from "./cloud";

export interface DocMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  shared?: boolean;
}

/** Author's own notes, anchored to text with a comment mark. Stored locally with the document. */
export interface CommentRecord {
  id: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

/** Link state for a document that has been shared to the server. */
export interface ShareInfo {
  id: string;
  /** Secret that proves authorship to the server. Included in private cloud backups; never included in public document responses. */
  token: string;
  url: string;
  /** When the snapshot on the server was last updated. */
  sharedAt: string;
  /** Reader comments created after this are "new" to the author. */
  seenCommentsAt?: string;
}

export interface Doc extends DocMeta {
  content: unknown;
  comments: CommentRecord[];
  share?: ShareInfo | null;
  /** Legacy field from the browser-only publish flow; no longer used. */
  publishedSlug?: string | null;
}

function newId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export const api = {
  async list(): Promise<DocMeta[]> {
    const docs = await idbGetAll<Doc>("docs");
    return docs
      .map(({ id, title, updatedAt, createdAt, share }) => ({ id, title, updatedAt, createdAt, shared: !!share }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async get(id: string): Promise<Doc> {
    const doc = await idbGet<Doc>("docs", id);
    if (!doc) throw new Error("not found");
    return { ...doc, comments: doc.comments ?? [] };
  },

  /** Find the local document behind a share id, so the author sees "Edit" on their own share page. */
  async findByShare(shareId: string): Promise<Doc | null> {
    const docs = await idbGetAll<Doc>("docs");
    return docs.find((d) => d.share?.id === shareId) ?? null;
  },

  async create(): Promise<Doc> {
    const now = new Date().toISOString();
    const doc: Doc = {
      id: newId(),
      title: "",
      content: null,
      comments: [],
      createdAt: now,
      updatedAt: now,
    };
    await changeDocument(doc.id, () => doc);
    return doc;
  },

  async save(
    id: string,
    title: string,
    content: unknown,
    comments: CommentRecord[]
  ): Promise<{ ok: true; updatedAt: string }> {
    const updatedAt = new Date().toISOString();
    await changeDocument(id, (doc) => {
      if (!doc) throw new Error("not found");
      return { ...doc, title, content, comments, updatedAt };
    });
    return { ok: true, updatedAt };
  },

  /** Update share metadata without touching updatedAt, so it doesn't look like an edit. */
  async setShare(id: string, share: ShareInfo | null): Promise<void> {
    await changeDocument(id, (doc) => {
      if (!doc) throw new Error("not found");
      return { ...doc, share };
    });
  },

  async remove(id: string): Promise<{ ok: true }> {
    await changeDocument(id, () => null);
    return { ok: true };
  },
};

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const AUTHOR_KEY = "authorName";
export function getAuthorName(): string {
  return localStorage.getItem(AUTHOR_KEY) ?? "";
}
export function setAuthorName(name: string) {
  if (name.trim()) localStorage.setItem(AUTHOR_KEY, name.trim());
  else localStorage.removeItem(AUTHOR_KEY);
}
