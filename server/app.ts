import express, { type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import fs from "node:fs";
import crypto from "node:crypto";
import { renderToHTMLString } from "@tiptap/static-renderer";
import { articleExtensions } from "../shared/articleExtensions";
import { LIMITS, type ShareComment, type SharePublic } from "../shared/types";
import { createStore, type Store, type StoredShare } from "./store";
import { loadShell, renderSharePage } from "./page";

const ROOT = process.cwd();
const DIST = process.env.DIST_DIR ?? path.join(ROOT, "dist");
const SHARE_KEY = process.env.SHARE_KEY || null;

const IMAGE_MIME: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
};

function sniffImage(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("ascii") === "RIFF" && buf.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (buf.subarray(0, 6).toString("ascii") === "GIF87a" || buf.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  return null;
}

const ID_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no 0/o/1/l/i: links get read aloud
export function newId(len = 10): string {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => ID_ALPHABET[b % ID_ALPHABET.length]).join("");
}

const sha256 = (s: string | Buffer) => crypto.createHash("sha256").update(s).digest("hex");

const param = (req: Request, name: string) => String(req.params[name] ?? "");

function bearer(req: Request): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith("Bearer ")) return null;
  const t = h.slice(7).trim();
  return /^[a-f0-9]{32,128}$/.test(t) ? t : null;
}

function tokenMatches(share: StoredShare, token: string | null): boolean {
  if (!token) return false;
  const a = Buffer.from(sha256(token));
  const b = Buffer.from(share.tokenHash);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* Small fixed-window rate limiter; enough to stop a script, not a DDoS. */
class RateLimit {
  private hits = new Map<string, { n: number; reset: number }>();
  constructor(private max: number, private windowMs: number) {}
  take(key: string): boolean {
    const now = Date.now();
    const h = this.hits.get(key);
    if (!h || h.reset < now) {
      this.hits.set(key, { n: 1, reset: now + this.windowMs });
      if (this.hits.size > 10_000) this.hits.clear();
      return true;
    }
    h.n += 1;
    return h.n <= this.max;
  }
}
const commentLimit = new RateLimit(20, 10 * 60_000);
const createLimit = new RateLimit(40, 60 * 60_000);
const uploadLimit = new RateLimit(300, 60 * 60_000);

function clientIp(req: Request): string {
  const fwd = req.headers["x-forwarded-for"];
  const first = Array.isArray(fwd) ? fwd[0] : fwd?.split(",")[0];
  return (first ?? req.socket.remoteAddress ?? "unknown").trim();
}

function publicUrl(req: Request, pathname: string): string {
  const base = process.env.PUBLIC_URL?.replace(/\/$/, "");
  if (base) return base + pathname;
  const proto = (req.headers["x-forwarded-proto"] as string | undefined)?.split(",")[0] ?? req.protocol;
  const host = (req.headers["x-forwarded-host"] as string | undefined) ?? req.headers.host ?? "localhost";
  return `${proto}://${host}${pathname}`;
}

const clip = (s: unknown, max: number) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim().slice(0, max) : "");
/** Anchors must match the page text exactly, so only bound their length. */
const exact = (s: unknown, max: number, fromEnd = false) =>
  typeof s === "string" ? (fromEnd ? s.slice(-max) : s.slice(0, max)) : "";

/** Reject documents that would leak data: URLs into the page or point images anywhere odd. */
function validateContent(content: unknown): string | null {
  if (!content || typeof content !== "object" || (content as any).type !== "doc") return "Document is empty or malformed.";
  const json = JSON.stringify(content);
  if (json.length > LIMITS.contentBytes) return "Document is too large to share.";
  let problem: string | null = null;
  const visit = (node: any) => {
    if (!node || typeof node !== "object" || problem) return;
    const srcs: unknown[] = [];
    if (node.type === "image") srcs.push(node.attrs?.src);
    if (node.type === "imageRow") for (const im of node.attrs?.images ?? []) srcs.push(im?.src);
    if (node.type === "youtube") {
      const src = node.attrs?.src;
      if (typeof src !== "string" || !/^https:\/\/(www\.)?(youtube\.com|youtube-nocookie\.com|youtu\.be)\//.test(src)) {
        problem = "Only YouTube videos can be embedded.";
      }
    }
    for (const s of srcs) {
      if (typeof s !== "string" || !/^(\/i\/[a-f0-9]{24,64}\.[a-z]{3,4}|https?:\/\/[^\s"'<>]+)$/.test(s)) {
        problem = "Photos must be uploaded before sharing.";
      }
    }
    if (Array.isArray(node.content)) node.content.forEach(visit);
  };
  visit(content);
  return problem;
}

function renderHtml(content: unknown): string {
  return renderToHTMLString({ extensions: articleExtensions, content: content as any });
}

function excerptOf(html: string): string {
  return clip(html.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "), 200);
}

function coverOf(html: string): string | null {
  return /<img[^>]+src="([^"]+)"/i.exec(html)?.[1] ?? null;
}

function toPublic(share: StoredShare, comments: ShareComment[]): SharePublic {
  return {
    id: share.id,
    title: share.title,
    author: share.author,
    html: share.html,
    createdAt: share.createdAt,
    updatedAt: share.updatedAt,
    comments,
  };
}

export function createApp(store: Store = createStore()) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", true);

  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    next();
  });

  const json = express.json({ limit: "5mb" });

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, store: store.kind, sharing: true, keyRequired: SHARE_KEY !== null });
  });

  /* ——— Images ——— */

  app.post("/api/images/check", json, async (req, res) => {
    const hashes = Array.isArray(req.body?.hashes) ? (req.body.hashes as unknown[]).slice(0, 200) : [];
    const existing: string[] = [];
    for (const h of hashes) {
      if (typeof h === "string" && /^[a-f0-9]{64}$/.test(h) && (await store.hasImage(h))) existing.push(h);
    }
    res.json({ existing });
  });

  app.post(
    "/api/images",
    express.raw({ type: () => true, limit: LIMITS.imageBytes }),
    async (req, res) => {
      if (!uploadLimit.take(clientIp(req))) return res.status(429).json({ error: "Too many uploads. Try again later." });
      if (SHARE_KEY && req.headers["x-share-key"] !== SHARE_KEY) return res.status(401).json({ error: "key_required" });
      const buf: Buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      const mime = sniffImage(buf);
      if (!mime || !IMAGE_MIME[mime]) return res.status(400).json({ error: "Unsupported image type." });
      const hash = sha256(buf);
      if (!(await store.hasImage(hash))) await store.putImage(hash, { mime, bytes: buf });
      res.json({ url: `/i/${hash}.${IMAGE_MIME[mime]}`, hash });
    }
  );

  app.get("/i/:name", async (req, res) => {
    const m = /^([a-f0-9]{24,64})\.(webp|jpg|png|gif)$/.exec(req.params.name);
    if (!m) return res.status(404).end();
    const img = await store.getImage(m[1]);
    if (!img) return res.status(404).end();
    res.setHeader("Content-Type", img.mime);
    res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
    res.setHeader("Content-Security-Policy", "default-src 'none'");
    res.send(img.bytes);
  });

  /* ——— Shares ——— */

  app.post("/api/shares", json, async (req, res) => {
    if (!createLimit.take(clientIp(req))) return res.status(429).json({ error: "Too many shares created. Try again later." });
    if (SHARE_KEY && req.headers["x-share-key"] !== SHARE_KEY) return res.status(401).json({ error: "key_required" });
    const token = typeof req.body?.token === "string" ? req.body.token : "";
    if (!/^[a-f0-9]{32,128}$/.test(token)) return res.status(400).json({ error: "Bad token." });
    const problem = validateContent(req.body?.content);
    if (problem) return res.status(400).json({ error: problem });

    let id = newId();
    while (await store.getShare(id)) id = newId();
    const now = new Date().toISOString();
    const html = renderHtml(req.body.content);
    const share: StoredShare = {
      id,
      tokenHash: sha256(token),
      title: clip(req.body?.title, LIMITS.title),
      author: clip(req.body?.author, LIMITS.author) || null,
      content: req.body.content,
      html,
      excerpt: excerptOf(html),
      coverImage: coverOf(html),
      createdAt: now,
      updatedAt: now,
    };
    await store.putShare(share);
    res.json({ id, url: publicUrl(req, `/s/${id}`) });
  });

  app.get("/api/shares/:id", async (req, res) => {
    const share = await store.getShare(req.params.id).catch(() => null);
    if (!share) return res.status(404).json({ error: "This link isn't available." });
    res.setHeader("Cache-Control", "no-store");
    res.json(toPublic(share, await store.listComments(share.id)));
  });

  const requireAuthor = async (req: Request, res: Response, next: NextFunction) => {
    const share = await store.getShare(param(req, "id")).catch(() => null);
    if (!share) return res.status(404).json({ error: "This link isn't available." });
    if (!tokenMatches(share, bearer(req))) return res.status(403).json({ error: "Only the author can do that." });
    (res.locals as any).share = share;
    next();
  };

  app.put("/api/shares/:id", json, requireAuthor, async (req, res) => {
    const share: StoredShare = (res.locals as any).share;
    const problem = validateContent(req.body?.content);
    if (problem) return res.status(400).json({ error: problem });
    const html = renderHtml(req.body.content);
    const next: StoredShare = {
      ...share,
      title: clip(req.body?.title, LIMITS.title),
      author: clip(req.body?.author, LIMITS.author) || null,
      content: req.body.content,
      html,
      excerpt: excerptOf(html),
      coverImage: coverOf(html),
      updatedAt: new Date().toISOString(),
    };
    await store.putShare(next);
    res.json({ id: share.id, url: publicUrl(req, `/s/${share.id}`), updatedAt: next.updatedAt });
  });

  app.delete("/api/shares/:id", requireAuthor, async (req, res) => {
    await store.deleteShare(param(req, "id"));
    res.json({ ok: true });
  });

  /* ——— Comments ——— */

  app.get("/api/shares/:id/comments", async (req, res) => {
    const share = await store.getShare(req.params.id).catch(() => null);
    if (!share) return res.status(404).json({ error: "This link isn't available." });
    res.setHeader("Cache-Control", "no-store");
    res.json(await store.listComments(share.id));
  });

  app.post("/api/shares/:id/comments", json, async (req, res) => {
    const share = await store.getShare(req.params.id).catch(() => null);
    if (!share) return res.status(404).json({ error: "This link isn't available." });
    if (!commentLimit.take(clientIp(req))) return res.status(429).json({ error: "You're commenting quickly — give it a minute." });

    const text = typeof req.body?.text === "string" ? req.body.text.trim().slice(0, LIMITS.commentText) : "";
    if (!text) return res.status(400).json({ error: "Write something first." });
    const name = clip(req.body?.name, LIMITS.commentName) || "Someone";
    const quote = exact(req.body?.quote, LIMITS.quote).trim() ? exact(req.body?.quote, LIMITS.quote) : null;

    const existing = await store.listComments(share.id);
    if (existing.length >= LIMITS.commentsPerShare) return res.status(400).json({ error: "This page has reached its comment limit." });

    const comment: ShareComment = {
      id: newId(12),
      name,
      text,
      quote,
      prefix: quote ? exact(req.body?.prefix, LIMITS.context, true) || null : null,
      suffix: quote ? exact(req.body?.suffix, LIMITS.context) || null : null,
      createdAt: new Date().toISOString(),
      resolved: false,
      byAuthor: tokenMatches(share, bearer(req)),
    };
    await store.addComment(share.id, comment);
    res.json(comment);
  });

  app.patch("/api/shares/:id/comments/:cid", json, requireAuthor, async (req, res) => {
    const patch = typeof req.body?.resolved === "boolean" ? { resolved: req.body.resolved } : {};
    const c = await store.updateComment(param(req, "id"), param(req, "cid"), patch);
    if (!c) return res.status(404).json({ error: "Comment not found." });
    res.json(c);
  });

  app.delete("/api/shares/:id/comments/:cid", requireAuthor, async (req, res) => {
    const ok = await store.deleteComment(param(req, "id"), param(req, "cid"));
    if (!ok) return res.status(404).json({ error: "Comment not found." });
    res.json({ ok: true });
  });

  app.use("/api", (_req, res) => res.status(404).json({ error: "Not found" }));

  /* ——— Reader page: the SPA shell with the share preloaded and link-preview tags ——— */

  app.get("/s/:id", async (req, res, next) => {
    const shell = loadShell(DIST);
    if (!shell) return next(); // dev: Vite serves the shell and the app fetches the share
    const share = /^[a-z0-9]{6,32}$/.test(req.params.id) ? await store.getShare(req.params.id) : null;
    res.setHeader("Cache-Control", "no-store");
    res.type("html");
    if (!share) {
      return res.status(404).send(
        renderSharePage(
          shell,
          { title: "This link isn't available", description: "", image: null, url: publicUrl(req, req.path), author: null, publishedAt: "" },
          null
        )
      );
    }
    const comments = await store.listComments(share.id);
    res.send(
      renderSharePage(
        shell,
        {
          title: share.title || "Untitled",
          description: share.excerpt || (share.author ? `Shared by ${share.author}` : "Shared from Write"),
          image: share.coverImage ? (share.coverImage.startsWith("/") ? publicUrl(req, share.coverImage) : share.coverImage) : null,
          url: publicUrl(req, `/s/${share.id}`),
          author: share.author,
          publishedAt: share.createdAt,
        },
        toPublic(share, comments)
      )
    );
  });

  if (fs.existsSync(DIST)) {
    app.use(express.static(DIST, { index: false, maxAge: "1h", setHeaders: (res, p) => {
      if (/\/assets\//.test(p)) res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      if (/sw\.js$|index\.html$/.test(p)) res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
    } }));
    app.get(/^\/(?!api\/|i\/).*/, (_req, res) => {
      res.setHeader("Cache-Control", "public, max-age=0, must-revalidate");
      res.sendFile(path.join(DIST, "index.html"));
    });
  }

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    if (err?.type === "entity.too.large") return res.status(413).json({ error: "That's too large to upload." });
    console.error(err);
    res.status(500).json({ error: "Something went wrong." });
  });

  return app;
}
