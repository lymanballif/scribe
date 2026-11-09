import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import pg from 'pg';
import { CLOUD_ID_PATTERN, type CloudRecord } from '../shared/cloud';

export type CloudMutation = Omit<CloudRecord, 'version' | 'updatedAt'>;
export type MutationResult = { ok: true; record: CloudRecord } | { ok: false; current: CloudRecord | null };
export interface CloudStore {
  readonly kind: 'file' | 'postgres';
  list(): Promise<CloudRecord[]>;
  get(id: string): Promise<CloudRecord | null>;
  revisions(id: string): Promise<CloudRecord[]>;
  getChunk(hash: string): Promise<Buffer | null>;
  putChunk(hash: string, bytes: Buffer): Promise<void>;
  mutate(baseVersion: number, record: CloudMutation): Promise<MutationResult>;
}
export const sha256 = (bytes: string | Buffer) => crypto.createHash('sha256').update(bytes).digest('hex');
function idCheck(id: string) { if (!CLOUD_ID_PATTERN.test(id)) throw new Error('Invalid document ID'); }
function hashCheck(hash: string) { if (!/^[a-f0-9]{64}$/.test(hash)) throw new Error('Invalid hash'); }
function sameMutation(a: CloudRecord, b: CloudMutation) {
  return (a.deleted && b.deleted) || (a.deleted === b.deleted && a.hash === b.hash && a.byteLength === b.byteLength && JSON.stringify(a.chunkHashes) === JSON.stringify(b.chunkHashes));
}
/** Commit via a flushed temporary file. Failure before rename leaves the old file intact. */
async function durableReplace(file: string, data: string | Buffer) {
  const tmp = file + '.' + crypto.randomUUID() + '.tmp';
  let handle: Awaited<ReturnType<typeof fs.open>> | undefined;
  try {
    handle = await fs.open(tmp, 'wx', 0o600);
    await handle.writeFile(data); await handle.sync(); await handle.close(); handle = undefined;
    await fs.rename(tmp, file);
    const directory = await fs.open(path.dirname(file), 'r');
    try { await directory.sync(); }
    catch (e) { if (!['EINVAL', 'ENOTSUP', 'EBADF'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e; }
    finally { await directory.close(); }
  } finally { await handle?.close(); await fs.unlink(tmp).catch(e => { if (e.code !== 'ENOENT') throw e; }); }
}
// One process only. Production/serverless deployments must use Postgres.
export class CloudFileStore implements CloudStore {
  readonly kind = 'file' as const;
  private locks = new Map<string, Promise<unknown>>();
  constructor(private dir: string) {}
  private async read(id: string): Promise<CloudRecord[]> {
    idCheck(id);
    try { return JSON.parse(await fs.readFile(path.join(this.dir, 'documents', id + '.json'), 'utf8')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
  }
  async list() {
    let files: string[];
    try { files = await fs.readdir(path.join(this.dir, 'documents')); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e; }
    return (await Promise.all(files.filter(f => f.endsWith('.json')).map(f => this.get(f.slice(0, -5))))).filter((v): v is CloudRecord => !!v);
  }
  async get(id: string) { return (await this.read(id)).at(-1) ?? null; }
  async revisions(id: string) { return (await this.read(id)).slice(-50).reverse(); }
  async getChunk(hash: string) {
    hashCheck(hash);
    try { return await fs.readFile(path.join(this.dir, 'chunks', hash)); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
  }
  async putChunk(hash: string, bytes: Buffer) {
    hashCheck(hash);
    if (sha256(bytes) !== hash) throw new Error('Chunk hash mismatch');
    const dir = path.join(this.dir, 'chunks'); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    await durableReplace(path.join(dir, hash), bytes);
  }
  async mutate(baseVersion: number, mutation: CloudMutation): Promise<MutationResult> {
    idCheck(mutation.id);
    const prior = this.locks.get(mutation.id) ?? Promise.resolve();
    const next = prior.catch(() => {}).then(async (): Promise<MutationResult> => {
      const revisions = await this.read(mutation.id), current = revisions.at(-1) ?? null;
      const replay = revisions.find(r => r.mutationId === mutation.mutationId);
      if (replay) return sameMutation(replay, mutation) && replay.version === baseVersion + 1 ? { ok: true, record: replay } : { ok: false, current };
      if ((current?.version ?? 0) !== baseVersion) return { ok: false, current };
      const record = { ...mutation, version: baseVersion + 1, updatedAt: new Date().toISOString() };
      revisions.push(record);
      const dir = path.join(this.dir, 'documents'); await fs.mkdir(dir, { recursive: true, mode: 0o700 });
      await durableReplace(path.join(dir, mutation.id + '.json'), JSON.stringify(revisions));
      return { ok: true, record };
    });
    this.locks.set(mutation.id, next);
    try { return await next; } finally { if (this.locks.get(mutation.id) === next) this.locks.delete(mutation.id); }
  }
}
export class CloudPostgresStore implements CloudStore {
  readonly kind = 'postgres' as const;
  private pool: pg.Pool;
  private ready?: Promise<unknown>;
  constructor(connectionString: string) {
    // Use the driver's verified TLS configuration (including connection-string sslmode).
    this.pool = new pg.Pool({ connectionString, max: 5 });
  }
  private init() {
    return this.ready ??= this.initializeSchema();
  }
  private async initializeSchema() {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT pg_advisory_xact_lock(hashtextextended('scribe_private_schema',0))");
      await client.query(`
      CREATE TABLE IF NOT EXISTS scribe_private_chunks (hash TEXT PRIMARY KEY, bytes BYTEA NOT NULL);
      CREATE TABLE IF NOT EXISTS scribe_private_documents (id TEXT PRIMARY KEY, record JSONB NOT NULL);
      CREATE TABLE IF NOT EXISTS scribe_private_revisions (
        id TEXT NOT NULL, version INTEGER NOT NULL, mutation_id TEXT NOT NULL, record JSONB NOT NULL,
        PRIMARY KEY(id,version), UNIQUE(id,mutation_id));
    `);
      await client.query('COMMIT');
    } catch (e) { await client.query('ROLLBACK'); this.ready = undefined; throw e; } finally { client.release(); }
  }
  async revisions(id: string) { idCheck(id); await this.init(); return (await this.pool.query('SELECT record FROM scribe_private_revisions WHERE id=$1 ORDER BY version DESC LIMIT 50', [id])).rows.map(r => r.record as CloudRecord); }
  async list() { await this.init(); return (await this.pool.query('SELECT record FROM scribe_private_documents ORDER BY id')).rows.map(r => r.record as CloudRecord); }
  async get(id: string) { idCheck(id); await this.init(); return (await this.pool.query('SELECT record FROM scribe_private_documents WHERE id=$1', [id])).rows[0]?.record as CloudRecord ?? null; }
  async getChunk(hash: string) { hashCheck(hash); await this.init(); return (await this.pool.query('SELECT bytes FROM scribe_private_chunks WHERE hash=$1', [hash])).rows[0]?.bytes as Buffer ?? null; }
  async putChunk(hash: string, bytes: Buffer) {
    hashCheck(hash); if (sha256(bytes) !== hash) throw new Error('Chunk hash mismatch'); await this.init();
    await this.pool.query('INSERT INTO scribe_private_chunks(hash,bytes) VALUES($1,$2) ON CONFLICT DO NOTHING', [hash, bytes]);
  }
  async mutate(baseVersion: number, mutation: CloudMutation): Promise<MutationResult> {
    idCheck(mutation.id); await this.init(); const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Transaction-scoped lock covers absent rows too, preventing racing first writes.
      await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['scribe_private:' + mutation.id]);
      const current = (await client.query('SELECT record FROM scribe_private_documents WHERE id=$1', [mutation.id])).rows[0]?.record as CloudRecord ?? null;
      const replay = (await client.query('SELECT record FROM scribe_private_revisions WHERE id=$1 AND mutation_id=$2', [mutation.id, mutation.mutationId])).rows[0]?.record as CloudRecord | undefined;
      if (replay || (current?.version ?? 0) !== baseVersion) {
        await client.query('ROLLBACK');
        return replay && sameMutation(replay, mutation) && replay.version === baseVersion + 1 ? { ok: true, record: replay } : { ok: false, current };
      }
      const record = { ...mutation, version: baseVersion + 1, updatedAt: new Date().toISOString() };
      await client.query('INSERT INTO scribe_private_revisions(id,version,mutation_id,record) VALUES($1,$2,$3,$4)', [record.id, record.version, record.mutationId, JSON.stringify(record)]);
      await client.query('INSERT INTO scribe_private_documents(id,record) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET record=EXCLUDED.record', [record.id, JSON.stringify(record)]);
      await client.query('COMMIT'); return { ok: true, record };
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }
  async close() { await this.pool.end(); }
}
export function createCloudStore(): CloudStore | null {
  if (!process.env.DOCUMENTS_KEY || process.env.DOCUMENTS_KEY.length < 24) return null;
  if (process.env.DATABASE_URL) return new CloudPostgresStore(process.env.DATABASE_URL);
  if (process.env.VERCEL) return null;
  return new CloudFileStore(path.join(process.env.DATA_DIR ?? path.join(process.cwd(), 'data'), 'private'));
}
