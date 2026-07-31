import { idbDelete, idbGet, idbGetAll, idbPut } from "./db";
import { renderArticleHtml } from "./publishClient";

export interface DocMeta {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
}

export interface CommentRecord {
  id: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

export interface Doc extends DocMeta {
  content: unknown;
  comments: CommentRecord[];
  publishedSlug?: string | null;
}

export interface PublishedRecord {
  slug: string;
  title: string;
  html: string;
  docId: string;
  publishedAt: string;
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
      .map(({ id, title, updatedAt, createdAt }) => ({ id, title, updatedAt, createdAt }))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async get(id: string): Promise<Doc> {
    const doc = await idbGet<Doc>("docs", id);
    if (!doc) throw new Error("not found");
    return { ...doc, comments: doc.comments ?? [] };
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
    await idbPut("docs", doc);
    return doc;
  },

  async save(
    id: string,
    title: string,
    content: unknown,
    comments: CommentRecord[]
  ): Promise<{ ok: true; updatedAt: string }> {
    const doc = await idbGet<Doc>("docs", id);
    if (!doc) throw new Error("not found");
    const updatedAt = new Date().toISOString();
    await idbPut("docs", { ...doc, title, content, comments, updatedAt });
    return { ok: true, updatedAt };
  },

  async remove(id: string): Promise<{ ok: true }> {
    const doc = await idbGet<Doc>("docs", id);
    if (doc?.publishedSlug) await idbDelete("published", doc.publishedSlug);
    await idbDelete("docs", id);
    return { ok: true };
  },

  async publish(id: string, slug: string): Promise<{ ok: true; slug: string }> {
    const doc = await idbGet<Doc>("docs", id);
    if (!doc) throw new Error("not found");
    if (!/^[a-z0-9][a-z0-9-]{0,80}$/.test(slug)) {
      throw new Error("Invalid slug. Use lowercase letters, numbers, and dashes.");
    }
    const existing = await idbGet<PublishedRecord>("published", slug);
    if (existing && existing.docId !== id) throw new Error("That slug is already in use.");

    const html = renderArticleHtml(doc.content);
    const record: PublishedRecord = {
      slug,
      title: doc.title,
      html,
      docId: id,
      publishedAt: new Date().toISOString(),
    };
    await idbPut("published", record);

    if (doc.publishedSlug && doc.publishedSlug !== slug) {
      await idbDelete("published", doc.publishedSlug);
    }
    await idbPut("docs", { ...doc, publishedSlug: slug, updatedAt: new Date().toISOString() });
    return { ok: true, slug };
  },

  async unpublish(id: string): Promise<{ ok: true }> {
    const doc = await idbGet<Doc>("docs", id);
    if (!doc) throw new Error("not found");
    if (doc.publishedSlug) {
      await idbDelete("published", doc.publishedSlug);
      await idbPut("docs", { ...doc, publishedSlug: null, updatedAt: new Date().toISOString() });
    }
    return { ok: true };
  },

  async getPublished(slug: string): Promise<PublishedRecord | null> {
    return (await idbGet<PublishedRecord>("published", slug)) ?? null;
  },
};

export async function uploadImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("upload failed"));
    reader.readAsDataURL(file);
  });
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
