import type { Doc, ShareInfo } from "./api";
import { resolveShareUrl } from "../shared/shareUrl";
import { dataUrlToBytes, sha256Hex } from "./images";
import type { ShareComment, SharePublic } from "../shared/types";

export class ShareError extends Error {
  constructor(message: string, public status = 0, public code?: string) {
    super(message);
  }
}

const KEY_STORAGE = "shareKey";
export function getShareKey(): string {
  return localStorage.getItem(KEY_STORAGE) ?? "";
}
export function setShareKey(key: string) {
  if (key.trim()) localStorage.setItem(KEY_STORAGE, key.trim());
  else localStorage.removeItem(KEY_STORAGE);
}

async function request<T>(url: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const key = getShareKey();
  if (key) headers.set("X-Share-Key", key);
  let res: Response;
  try {
    res = await fetch(url, { ...init, headers });
  } catch {
    throw new ShareError("Couldn't reach the server. Sharing needs the Write server running.", 0, "offline");
  }
  if (res.status === 404 && res.headers.get("content-type")?.includes("text/html")) {
    throw new ShareError("Sharing isn't set up on this deployment yet.", 404, "no_server");
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = body?.error === "key_required" ? "This server asks for a share key." : body?.error ?? `Request failed (${res.status}).`;
    throw new ShareError(msg, res.status, body?.error);
  }
  return body as T;
}

export interface ServerHealth {
  ok: boolean;
  keyRequired: boolean;
}
export async function serverHealth(): Promise<ServerHealth | null> {
  try {
    const res = await fetch("/api/health", { cache: "no-store" });
    if (!res.ok || !res.headers.get("content-type")?.includes("json")) return null;
    return (await res.json()) as ServerHealth;
  } catch {
    return null;
  }
}

/* ——— Moving photos from the document to the server ——— */

function extFor(mime: string): string {
  return mime === "image/png" ? "png" : mime === "image/gif" ? "gif" : mime === "image/jpeg" ? "jpg" : "webp";
}

/**
 * Returns a copy of the document where every inline (data:) photo has been
 * uploaded and replaced with a server URL. The local document keeps its
 * data: URLs so it still works offline.
 */
export async function uploadInlineImages(
  content: unknown,
  onProgress?: (done: number, total: number) => void
): Promise<unknown> {
  const copy = JSON.parse(JSON.stringify(content ?? null));
  const refs: { obj: any; key: string }[] = [];
  const visit = (node: any) => {
    if (!node || typeof node !== "object") return;
    if (node.type === "image" && typeof node.attrs?.src === "string" && node.attrs.src.startsWith("data:")) {
      refs.push({ obj: node.attrs, key: "src" });
    }
    if (node.type === "imageRow" && Array.isArray(node.attrs?.images)) {
      for (const im of node.attrs.images) {
        if (typeof im?.src === "string" && im.src.startsWith("data:")) refs.push({ obj: im, key: "src" });
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(copy);

  const unique = new Map<string, { bytes: Uint8Array; mime: string; hash: string }>();
  for (const r of refs) {
    const src = r.obj[r.key] as string;
    if (unique.has(src)) continue;
    const parsed = dataUrlToBytes(src);
    if (!parsed) throw new ShareError("A photo in this document couldn't be read.");
    unique.set(src, { ...parsed, hash: await sha256Hex(parsed.bytes) });
  }

  const hashes = Array.from(unique.values(), (u) => u.hash);
  const { existing } = hashes.length
    ? await request<{ existing: string[] }>("/api/images/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hashes }),
      })
    : { existing: [] as string[] };
  const have = new Set(existing);

  const urlFor = new Map<string, string>();
  let done = 0;
  const total = unique.size;
  onProgress?.(done, total);
  for (const [src, u] of unique) {
    if (have.has(u.hash)) {
      urlFor.set(src, `/i/${u.hash}.${extFor(u.mime)}`);
    } else {
      const { url } = await request<{ url: string }>("/api/images", {
        method: "POST",
        headers: { "Content-Type": u.mime },
        body: u.bytes as BodyInit,
      });
      urlFor.set(src, url);
    }
    done += 1;
    onProgress?.(done, total);
  }

  for (const r of refs) r.obj[r.key] = urlFor.get(r.obj[r.key]) ?? r.obj[r.key];
  return copy;
}

/* ——— Share lifecycle ——— */

function newToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export interface ShareProgress {
  stage: "photos" | "publishing";
  done: number;
  total: number;
}

export async function publishShare(
  doc: Doc,
  author: string,
  onProgress?: (p: ShareProgress) => void
): Promise<ShareInfo> {
  const content = await uploadInlineImages(doc.content, (done, total) => onProgress?.({ stage: "photos", done, total }));
  onProgress?.({ stage: "publishing", done: 0, total: 1 });
  const payload = { title: doc.title, author, content };

  if (doc.share) {
    const res = await request<{ id: string; url: string; updatedAt: string }>(
      `/api/shares/${doc.share.id}`,
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) },
      doc.share.token
    ).catch(async (e: ShareError) => {
      // The server lost this share (wiped data dir, etc.): start a fresh link.
      if (e.status === 404) return null;
      throw e;
    });
    if (res) {
      return { ...doc.share, url: absolute(res.url), sharedAt: res.updatedAt };
    }
  }

  const token = newToken();
  const res = await request<{ id: string; url: string }>("/api/shares", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...payload, token }),
  });
  return { id: res.id, token, url: absolute(res.url), sharedAt: new Date().toISOString(), seenCommentsAt: new Date().toISOString() };
}

/** The publication service may use a separate public reader hostname. */
function absolute(url: string): string {
  return resolveShareUrl(url, window.location.origin);
}

export async function deleteShare(share: ShareInfo): Promise<void> {
  await request(`/api/shares/${share.id}`, { method: "DELETE" }, share.token).catch((e: ShareError) => {
    if (e.status !== 404) throw e;
  });
}

export async function fetchShare(id: string): Promise<SharePublic> {
  return request<SharePublic>(`/api/shares/${encodeURIComponent(id)}`, { cache: "no-store" });
}

export async function fetchComments(share: ShareInfo): Promise<ShareComment[]> {
  return request<ShareComment[]>(`/api/shares/${share.id}/comments`, { cache: "no-store" });
}

export interface NewComment {
  name: string;
  text: string;
  quote?: string | null;
  prefix?: string | null;
  suffix?: string | null;
}

export async function postComment(shareId: string, comment: NewComment, token?: string): Promise<ShareComment> {
  return request<ShareComment>(
    `/api/shares/${shareId}/comments`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(comment) },
    token
  );
}

export async function setCommentResolved(share: ShareInfo, commentId: string, resolved: boolean): Promise<ShareComment> {
  return request<ShareComment>(
    `/api/shares/${share.id}/comments/${commentId}`,
    { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ resolved }) },
    share.token
  );
}

export async function deleteComment(share: ShareInfo, commentId: string): Promise<void> {
  await request(`/api/shares/${share.id}/comments/${commentId}`, { method: "DELETE" }, share.token);
}

const READER_NAME_KEY = "readerName";
export function getReaderName(): string {
  return localStorage.getItem(READER_NAME_KEY) ?? localStorage.getItem("authorName") ?? "";
}
export function setReaderName(name: string) {
  if (name.trim()) localStorage.setItem(READER_NAME_KEY, name.trim());
}
