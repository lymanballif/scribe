import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import pg from "pg";
import type { ShareComment } from "../shared/types";

export interface StoredShare {
  id: string;
  tokenHash: string;
  title: string;
  author: string | null;
  content: unknown;
  html: string;
  excerpt: string;
  coverImage: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface StoredImage {
  mime: string;
  bytes: Buffer;
}

export interface Store {
  readonly kind: "file" | "postgres";
  getShare(id: string): Promise<StoredShare | null>;
  putShare(share: StoredShare): Promise<void>;
  deleteShare(id: string): Promise<void>;

  listComments(shareId: string): Promise<ShareComment[]>;
  addComment(shareId: string, comment: ShareComment): Promise<void>;
  updateComment(shareId: string, commentId: string, patch: Partial<Pick<ShareComment, "resolved">>): Promise<ShareComment | null>;
  deleteComment(shareId: string, commentId: string): Promise<boolean>;

  hasImage(hash: string): Promise<boolean>;
  putImage(hash: string, image: StoredImage): Promise<void>;
  getImage(hash: string): Promise<StoredImage | null>;
}

const SHARE_ID = /^[a-z0-9]{6,32}$/;
const HASH = /^[a-f0-9]{24,64}$/;

function assertId(id: string) {
  if (!SHARE_ID.test(id)) throw new Error("bad id");
}
function assertHash(hash: string) {
  if (!HASH.test(hash)) throw new Error("bad hash");
}

/* ————————————————————————————————————————————————————————————
 * File store: zero-config, one JSON per share, images on disk.
 * ———————————————————————————————————————————————————————————— */

interface ShareFile {
  share: StoredShare;
  comments: ShareComment[];
}

export class FileStore implements Store {
  readonly kind = "file" as const;
  private sharesDir: string;
  private imagesDir: string;
  private locks = new Map<string, Promise<unknown>>();

  constructor(dataDir: string) {
    this.sharesDir = path.join(dataDir, "shares");
    this.imagesDir = path.join(dataDir, "images");
    fs.mkdirSync(this.sharesDir, { recursive: true });
    fs.mkdirSync(this.imagesDir, { recursive: true });
  }

  private sharePath(id: string) {
    assertId(id);
    return path.join(this.sharesDir, id + ".json");
  }

  private async readFile(id: string): Promise<ShareFile | null> {
    try {
      return JSON.parse(await fsp.readFile(this.sharePath(id), "utf8"));
    } catch {
      return null;
    }
  }

  private async writeFile(id: string, data: ShareFile) {
    const file = this.sharePath(id);
    const tmp = file + "." + crypto.randomBytes(6).toString("hex") + ".tmp";
    await fsp.writeFile(tmp, JSON.stringify(data));
    await fsp.rename(tmp, file);
  }

  /** Serialize read-modify-write cycles per share so concurrent comments never clobber each other. */
  private locked<T>(id: string, fn: () => Promise<T>): Promise<T> {
    const prev = this.locks.get(id) ?? Promise.resolve();
    const next = prev.then(fn, fn);
    this.locks.set(id, next.catch(() => {}));
    return next;
  }

  async getShare(id: string) {
    return (await this.readFile(id))?.share ?? null;
  }

  async putShare(share: StoredShare) {
    await this.locked(share.id, async () => {
      const existing = await this.readFile(share.id);
      await this.writeFile(share.id, { share, comments: existing?.comments ?? [] });
    });
  }

  async deleteShare(id: string) {
    await fsp.unlink(this.sharePath(id)).catch(() => {});
  }

  async listComments(shareId: string) {
    return (await this.readFile(shareId))?.comments ?? [];
  }

  async addComment(shareId: string, comment: ShareComment) {
    await this.locked(shareId, async () => {
      const data = await this.readFile(shareId);
      if (!data) throw new Error("not found");
      data.comments.push(comment);
      await this.writeFile(shareId, data);
    });
  }

  async updateComment(shareId: string, commentId: string, patch: Partial<Pick<ShareComment, "resolved">>) {
    return this.locked(shareId, async () => {
      const data = await this.readFile(shareId);
      const c = data?.comments.find((x) => x.id === commentId);
      if (!data || !c) return null;
      Object.assign(c, patch);
      await this.writeFile(shareId, data);
      return c;
    });
  }

  async deleteComment(shareId: string, commentId: string) {
    return this.locked(shareId, async () => {
      const data = await this.readFile(shareId);
      if (!data) return false;
      const before = data.comments.length;
      data.comments = data.comments.filter((x) => x.id !== commentId);
      if (data.comments.length === before) return false;
      await this.writeFile(shareId, data);
      return true;
    });
  }

  private imagePath(hash: string) {
    assertHash(hash);
    return path.join(this.imagesDir, hash);
  }

  async hasImage(hash: string) {
    try {
      await fsp.access(this.imagePath(hash) + ".json");
      return true;
    } catch {
      return false;
    }
  }

  async putImage(hash: string, image: StoredImage) {
    const base = this.imagePath(hash);
    await fsp.writeFile(base + ".bin", image.bytes);
    await fsp.writeFile(base + ".json", JSON.stringify({ mime: image.mime }));
  }

  async getImage(hash: string) {
    try {
      const base = this.imagePath(hash);
      const meta = JSON.parse(await fsp.readFile(base + ".json", "utf8"));
      return { mime: meta.mime, bytes: await fsp.readFile(base + ".bin") };
    } catch {
      return null;
    }
  }
}

/* ————————————————————————————————————————————————————————————
 * Postgres store: for hosts without a persistent disk (Vercel, etc.).
 * Images live in the database too, so one DATABASE_URL is all you need.
 * ———————————————————————————————————————————————————————————— */

export class PostgresStore implements Store {
  readonly kind = "postgres" as const;
  private pool: pg.Pool;
  private ready: Promise<void>;

  constructor(connectionString: string) {
    this.pool = new pg.Pool({
      connectionString,
      ssl: /localhost|127\.0\.0\.1/.test(connectionString) ? undefined : { rejectUnauthorized: false },
      max: 5,
    });
    this.ready = this.migrate();
  }

  private async migrate() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS shares (
        id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        author TEXT,
        content JSONB,
        html TEXT NOT NULL DEFAULT '',
        excerpt TEXT NOT NULL DEFAULT '',
        cover_image TEXT,
        created_at TIMESTAMPTZ NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL
      );
      CREATE TABLE IF NOT EXISTS share_comments (
        id TEXT PRIMARY KEY,
        share_id TEXT NOT NULL REFERENCES shares(id) ON DELETE CASCADE,
        name TEXT NOT NULL,
        text TEXT NOT NULL,
        quote TEXT,
        prefix TEXT,
        suffix TEXT,
        resolved BOOLEAN NOT NULL DEFAULT FALSE,
        by_author BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL
      );
      CREATE INDEX IF NOT EXISTS share_comments_share_idx ON share_comments(share_id, created_at);
      CREATE TABLE IF NOT EXISTS images (
        hash TEXT PRIMARY KEY,
        mime TEXT NOT NULL,
        bytes BYTEA NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `);
  }

  private async q<T = any>(text: string, params: unknown[] = []): Promise<T[]> {
    await this.ready;
    const res = await this.pool.query(text, params);
    return res.rows as T[];
  }

  async getShare(id: string) {
    assertId(id);
    const [row] = await this.q("SELECT * FROM shares WHERE id = $1", [id]);
    return row ? rowToShare(row) : null;
  }

  async putShare(s: StoredShare) {
    assertId(s.id);
    await this.q(
      `INSERT INTO shares (id, token_hash, title, author, content, html, excerpt, cover_image, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (id) DO UPDATE SET
         title = EXCLUDED.title, author = EXCLUDED.author, content = EXCLUDED.content, html = EXCLUDED.html,
         excerpt = EXCLUDED.excerpt, cover_image = EXCLUDED.cover_image, updated_at = EXCLUDED.updated_at`,
      [s.id, s.tokenHash, s.title, s.author, JSON.stringify(s.content ?? null), s.html, s.excerpt, s.coverImage, s.createdAt, s.updatedAt]
    );
  }

  async deleteShare(id: string) {
    assertId(id);
    await this.q("DELETE FROM shares WHERE id = $1", [id]);
  }

  async listComments(shareId: string) {
    assertId(shareId);
    const rows = await this.q("SELECT * FROM share_comments WHERE share_id = $1 ORDER BY created_at", [shareId]);
    return rows.map(rowToComment);
  }

  async addComment(shareId: string, c: ShareComment) {
    assertId(shareId);
    await this.q(
      `INSERT INTO share_comments (id, share_id, name, text, quote, prefix, suffix, resolved, by_author, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [c.id, shareId, c.name, c.text, c.quote, c.prefix, c.suffix, c.resolved, c.byAuthor, c.createdAt]
    );
  }

  async updateComment(shareId: string, commentId: string, patch: Partial<Pick<ShareComment, "resolved">>) {
    assertId(shareId);
    if (patch.resolved === undefined) {
      const [row] = await this.q("SELECT * FROM share_comments WHERE share_id = $1 AND id = $2", [shareId, commentId]);
      return row ? rowToComment(row) : null;
    }
    const [row] = await this.q(
      "UPDATE share_comments SET resolved = $3 WHERE share_id = $1 AND id = $2 RETURNING *",
      [shareId, commentId, patch.resolved]
    );
    return row ? rowToComment(row) : null;
  }

  async deleteComment(shareId: string, commentId: string) {
    assertId(shareId);
    const rows = await this.q("DELETE FROM share_comments WHERE share_id = $1 AND id = $2 RETURNING id", [shareId, commentId]);
    return rows.length > 0;
  }

  async hasImage(hash: string) {
    assertHash(hash);
    const rows = await this.q("SELECT 1 FROM images WHERE hash = $1", [hash]);
    return rows.length > 0;
  }

  async putImage(hash: string, image: StoredImage) {
    assertHash(hash);
    await this.q("INSERT INTO images (hash, mime, bytes) VALUES ($1,$2,$3) ON CONFLICT (hash) DO NOTHING", [hash, image.mime, image.bytes]);
  }

  async getImage(hash: string) {
    assertHash(hash);
    const [row] = await this.q("SELECT mime, bytes FROM images WHERE hash = $1", [hash]);
    return row ? { mime: row.mime, bytes: row.bytes } : null;
  }
}

function rowToShare(r: any): StoredShare {
  return {
    id: r.id,
    tokenHash: r.token_hash,
    title: r.title,
    author: r.author,
    content: r.content,
    html: r.html,
    excerpt: r.excerpt,
    coverImage: r.cover_image,
    createdAt: new Date(r.created_at).toISOString(),
    updatedAt: new Date(r.updated_at).toISOString(),
  };
}

function rowToComment(r: any): ShareComment {
  return {
    id: r.id,
    name: r.name,
    text: r.text,
    quote: r.quote,
    prefix: r.prefix,
    suffix: r.suffix,
    resolved: r.resolved,
    byAuthor: r.by_author,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export function createStore(): Store {
  const url = process.env.DATABASE_URL;
  if (url) return new PostgresStore(url);
  return new FileStore(process.env.DATA_DIR ?? path.join(process.cwd(), "data"));
}
