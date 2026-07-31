import express from "express";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { renderToHTMLString } from "@tiptap/static-renderer";
import { articleExtensions } from "./articleExtensions";
import { articlePage } from "./publish";

const ROOT = process.cwd();
const DATA = path.join(ROOT, "data");
const DOCS_DIR = path.join(DATA, "docs");
const SNAPS_DIR = path.join(DATA, "snapshots");
const UPLOADS_DIR = path.join(DATA, "uploads");
const PUBLISHED_DIR = path.join(DATA, "published");
const DIST = path.join(ROOT, "dist");

for (const d of [DOCS_DIR, SNAPS_DIR, UPLOADS_DIR, PUBLISHED_DIR]) fs.mkdirSync(d, { recursive: true });

const MAX_SNAPSHOTS = 100;
const SNAPSHOT_MIN_INTERVAL_MS = 30_000;

interface CommentRecord {
  id: string;
  text: string;
  createdAt: string;
  resolved: boolean;
}

interface Doc {
  id: string;
  title: string;
  content: unknown;
  comments?: CommentRecord[];
  publishedSlug?: string | null;
  createdAt: string;
  updatedAt: string;
}

async function atomicWrite(file: string, data: string) {
  const tmp = file + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
  await fsp.writeFile(tmp, data);
  await fsp.rename(tmp, file);
}

function docPath(id: string) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error("bad id");
  return path.join(DOCS_DIR, id + ".json");
}

async function readDoc(id: string): Promise<Doc | null> {
  try {
    return JSON.parse(await fsp.readFile(docPath(id), "utf8"));
  } catch {
    return null;
  }
}

async function snapshot(doc: Doc) {
  const dir = path.join(SNAPS_DIR, doc.id);
  await fsp.mkdir(dir, { recursive: true });
  const snaps = (await fsp.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  const latest = snaps.at(-1);
  if (latest) {
    const mtime = (await fsp.stat(path.join(dir, latest))).mtimeMs;
    if (Date.now() - mtime < SNAPSHOT_MIN_INTERVAL_MS) return;
  }
  const stamp = doc.updatedAt.replace(/[:.]/g, "-");
  await atomicWrite(path.join(dir, stamp + ".json"), JSON.stringify(doc, null, 2));
  const all = (await fsp.readdir(dir)).filter((f) => f.endsWith(".json")).sort();
  for (const old of all.slice(0, Math.max(0, all.length - MAX_SNAPSHOTS))) {
    await fsp.unlink(path.join(dir, old)).catch(() => {});
  }
}

const app = express();
app.use(express.json({ limit: "5mb" }));
app.use("/uploads", express.static(UPLOADS_DIR));

app.get("/api/docs", async (_req, res) => {
  const files = (await fsp.readdir(DOCS_DIR)).filter((f) => f.endsWith(".json"));
  const docs = (
    await Promise.all(
      files.map(async (f) => {
        try {
          const d: Doc = JSON.parse(await fsp.readFile(path.join(DOCS_DIR, f), "utf8"));
          return { id: d.id, title: d.title, updatedAt: d.updatedAt, createdAt: d.createdAt };
        } catch {
          return null;
        }
      })
    )
  ).filter(Boolean);
  docs.sort((a: any, b: any) => b.updatedAt.localeCompare(a.updatedAt));
  res.json(docs);
});

app.post("/api/docs", async (req, res) => {
  const now = new Date().toISOString();
  const doc: Doc = {
    id: crypto.randomBytes(8).toString("hex"),
    title: req.body?.title ?? "",
    content: req.body?.content ?? null,
    createdAt: now,
    updatedAt: now,
  };
  await atomicWrite(docPath(doc.id), JSON.stringify(doc, null, 2));
  res.json(doc);
});

app.get("/api/docs/:id", async (req, res) => {
  const doc = await readDoc(req.params.id);
  if (!doc) return res.status(404).json({ error: "not found" });
  res.json(doc);
});

app.put("/api/docs/:id", async (req, res) => {
  const doc = await readDoc(req.params.id);
  if (!doc) return res.status(404).json({ error: "not found" });
  doc.title = typeof req.body?.title === "string" ? req.body.title : doc.title;
  if (req.body?.content !== undefined) doc.content = req.body.content;
  if (Array.isArray(req.body?.comments)) doc.comments = req.body.comments;
  doc.updatedAt = new Date().toISOString();
  await atomicWrite(docPath(doc.id), JSON.stringify(doc, null, 2));
  await snapshot(doc);
  res.json({ ok: true, updatedAt: doc.updatedAt });
});

app.delete("/api/docs/:id", async (req, res) => {
  const doc = await readDoc(req.params.id);
  if (!doc) return res.status(404).json({ error: "not found" });
  await snapshot({ ...doc, updatedAt: new Date().toISOString() });
  await fsp.unlink(docPath(doc.id));
  res.json({ ok: true });
});

app.get("/api/docs/:id/snapshots", async (req, res) => {
  try {
    const dir = path.join(SNAPS_DIR, req.params.id);
    const files = (await fsp.readdir(dir)).filter((f) => f.endsWith(".json")).sort().reverse();
    res.json(files.slice(0, 50));
  } catch {
    res.json([]);
  }
});

app.get("/api/docs/:id/snapshots/:file", async (req, res) => {
  const file = path.basename(req.params.file);
  try {
    const data = await fsp.readFile(path.join(SNAPS_DIR, req.params.id, file), "utf8");
    res.type("application/json").send(data);
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

const MIME: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".svg": "image/svg+xml",
  ".avif": "image/avif",
};

app.post("/api/upload", express.raw({ type: () => true, limit: "25mb" }), async (req, res) => {
  const name = String(req.query.name ?? "image.png");
  const ext = path.extname(name).toLowerCase();
  if (!MIME[ext]) return res.status(400).json({ error: "unsupported type" });
  const filename = Date.now() + "-" + crypto.randomBytes(4).toString("hex") + ext;
  await fsp.writeFile(path.join(UPLOADS_DIR, filename), req.body);
  res.json({ url: "/uploads/" + filename });
});

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,80}$/;

function publishedPath(slug: string) {
  if (!SLUG_RE.test(slug)) throw new Error("bad slug");
  return path.join(PUBLISHED_DIR, slug + ".json");
}

async function readPublished(slug: string) {
  try {
    return JSON.parse(await fsp.readFile(publishedPath(slug), "utf8"));
  } catch {
    return null;
  }
}

app.post("/api/docs/:id/publish", async (req, res) => {
  const doc = await readDoc(req.params.id);
  if (!doc) return res.status(404).json({ error: "not found" });
  const slug = String(req.body?.slug ?? "").toLowerCase();
  if (!SLUG_RE.test(slug)) return res.status(400).json({ error: "Invalid slug. Use lowercase letters, numbers, and dashes." });
  const existing = await readPublished(slug);
  if (existing && existing.docId !== doc.id) return res.status(409).json({ error: "That slug is already in use." });
  const html = renderToHTMLString({ extensions: articleExtensions, content: doc.content as any });
  const record = { slug, title: doc.title, html, docId: doc.id, publishedAt: new Date().toISOString() };
  await atomicWrite(publishedPath(slug), JSON.stringify(record, null, 2));
  if (doc.publishedSlug && doc.publishedSlug !== slug) {
    await fsp.unlink(publishedPath(doc.publishedSlug)).catch(() => {});
  }
  doc.publishedSlug = slug;
  await atomicWrite(docPath(doc.id), JSON.stringify(doc, null, 2));
  res.json({ ok: true, slug });
});

app.post("/api/docs/:id/unpublish", async (req, res) => {
  const doc = await readDoc(req.params.id);
  if (!doc) return res.status(404).json({ error: "not found" });
  if (doc.publishedSlug) {
    await fsp.unlink(publishedPath(doc.publishedSlug)).catch(() => {});
    doc.publishedSlug = null;
    await atomicWrite(docPath(doc.id), JSON.stringify(doc, null, 2));
  }
  res.json({ ok: true });
});

app.get("/fonts/inter-latin-wght-normal.woff2", (_req, res) => {
  res.sendFile(path.join(ROOT, "node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2"));
});

app.get("/:slug", async (req, res, next) => {
  const slug = req.params.slug.toLowerCase();
  if (!SLUG_RE.test(slug)) return next();
  const pub = await readPublished(slug);
  if (!pub) return next();
  res.type("text/html").send(articlePage(pub));
});

if (fs.existsSync(DIST)) {
  app.use(express.static(DIST));
  app.get(/^\/(?!api|uploads|fonts).*/, (_req, res) => res.sendFile(path.join(DIST, "index.html")));
}

const port = Number(process.env.PORT ?? 4000);
app.listen(port, () => console.log(`scribe server on http://localhost:${port}`));
