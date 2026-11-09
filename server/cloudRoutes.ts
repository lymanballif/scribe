import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { TextDecoder } from 'node:util';
import { CLOUD_CHUNK_BYTES, CLOUD_MAX_CHUNKS, CLOUD_MAX_DOCUMENT_BYTES, CLOUD_ID_PATTERN } from '../shared/cloud';
import { createCloudStore, sha256, type CloudStore } from './cloudStore';

export interface CloudRouterOptions { store?: CloudStore | null; key?: string; publicUrl?: string; secureCookies?: boolean; sessionSeconds?: number }
export function createCloudRouter(options: CloudRouterOptions = {}) {
  const router = express.Router();
  const key = options.key ?? process.env.DOCUMENTS_KEY ?? '';
  const store = options.store === undefined ? createCloudStore() : options.store;
  const configured = key.length >= 24 && !!store && !(process.env.VERCEL && store.kind === 'file');
  const secure = options.secureCookies ?? (process.env.NODE_ENV === 'production' || !!process.env.VERCEL);
  const publicUrl = options.publicUrl ?? process.env.PUBLIC_URL;
  const seconds = options.sessionSeconds ?? 7 * 24 * 60 * 60;
  const cookieName = secure ? '__Host-scribe_private' : 'scribe_private';
  const sign = (value: string) => crypto.createHmac('sha256', key).update('scribe-private-session:' + value).digest('hex');
  const equal = (a: string, b: string) => crypto.timingSafeEqual(Buffer.from(sha256(a)), Buffer.from(sha256(b)));
  const authenticated = (req: Request) => {
    if (!configured) return false;
    const raw = req.headers.cookie?.split(';').map(v => v.trim()).find(v => v.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!raw || raw.length > 256) return false;
    const [expiry, nonce, signature] = raw.split('.');
    return /^\d+$/.test(expiry ?? '') && /^[a-f0-9]{32}$/.test(nonce ?? '') && /^[a-f0-9]{64}$/.test(signature ?? '') && Number(expiry) > Date.now() && equal(signature, sign(expiry + '.' + nonce));
  };
  const attempts = new Map<string, { count: number; until: number }>();
  function rate(req: Request, bucket: string, max: number) {
    const id = bucket + ':' + (req.ip ?? req.socket.remoteAddress ?? 'unknown'), now = Date.now();
    if (attempts.size > 10000) for (const [k, v] of attempts) if (v.until <= now) attempts.delete(k);
    let item = attempts.get(id);
    if (!item || item.until <= now) { if (attempts.size >= 10000) return false; item = { count: 0, until: now + 60000 }; attempts.set(id, item); }
    return ++item.count <= max;
  }
  router.use((_req, res, next) => { res.set({ 'Cache-Control': 'private, no-store', 'Pragma': 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Vary': 'Cookie' }); next(); });
  router.get('/status', (req, res) => res.json({ configured, authenticated: authenticated(req) }));
  router.use((req, res, next) => {
    if (!configured) return res.status(503).json({ error: 'cloud_not_configured' });
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      let expected: string;
      try { expected = publicUrl ? new URL(publicUrl).origin : `${req.protocol}://${req.get('host')}`; }
      catch { return res.status(503).json({ error: 'invalid_cloud_origin' }); }
      if (req.get('origin') !== expected || req.get('sec-fetch-site') === 'cross-site') return res.status(403).json({ error: 'same_origin_required' });
    }
    next();
  });
  router.post('/login', express.json({ limit: 4096 }), (req, res) => {
    if (!rate(req, 'login', 10)) return res.status(429).json({ error: 'rate_limited' });
    if (typeof req.body?.key !== 'string' || !equal(req.body.key, key)) return res.status(401).json({ error: 'invalid_key' });
    const value = `${Date.now() + seconds * 1000}.${crypto.randomBytes(16).toString('hex')}`;
    res.cookie(cookieName, value + '.' + sign(value), { httpOnly: true, secure, sameSite: 'strict', path: '/', maxAge: seconds * 1000 });
    return res.json({ authenticated: true });
  });
  router.post('/logout', (_req, res) => { res.clearCookie(cookieName, { httpOnly: true, secure, sameSite: 'strict', path: '/' }); res.json({ authenticated: false }); });
  router.use((req, res, next) => {
    if (!authenticated(req)) return res.status(401).json({ error: 'authentication_required' });
    if (!rate(req, 'api', 2000)) return res.status(429).json({ error: 'rate_limited' });
    next();
  });
  router.put('/chunks/:hash', express.raw({ type: 'application/octet-stream', limit: CLOUD_CHUNK_BYTES }), async (req, res) => {
    const hash = String(req.params.hash);
    if (!/^[a-f0-9]{64}$/.test(hash) || !Buffer.isBuffer(req.body) || req.body.length < 1 || sha256(req.body) !== hash) return res.status(400).json({ error: 'invalid_chunk' });
    await store!.putChunk(hash, req.body); res.json({ hash, byteLength: req.body.length });
  });
  router.get('/chunks/:hash', async (req, res) => {
    const hash = String(req.params.hash); if (!/^[a-f0-9]{64}$/.test(hash)) return res.status(400).json({ error: 'invalid_hash' });
    const bytes = await store!.getChunk(hash); if (!bytes) return res.status(404).json({ error: 'not_found' });
    res.type('application/octet-stream').send(bytes);
  });
  router.get('/documents', async (req, res) => {
    // Bounded pages keep even large manifest libraries below serverless response limits.
    const after = typeof req.query.after === 'string' ? req.query.after : '';
    const sorted = (await store!.list()).filter(r => r.id > after).sort((a, b) => a.id < b.id ? -1 : 1);
    const documents = sorted.slice(0, 50);
    res.json({ documents, nextCursor: sorted.length > 50 ? documents.at(-1)!.id : null });
  });
  router.use('/documents/:id', (req, res, next) => {
    if (!CLOUD_ID_PATTERN.test(String(req.params.id))) return res.status(400).json({ error: 'invalid_id' }); next();
  });
  router.get('/documents/:id/revisions', async (req, res) => {
    res.json({ revisions: await store!.revisions(String(req.params.id)) });
  });
  router.get('/documents/:id', async (req, res) => {
    const record = await store!.get(String(req.params.id)); if (!record) return res.status(404).json({ error: 'not_found' }); res.json(record);
  });
  const json = express.json({ limit: '64kb' });
  function validMutation(body: any) { return Number.isSafeInteger(body?.baseVersion) && body.baseVersion >= 0 && body.baseVersion < 2147483647 && typeof body.mutationId === 'string' && CLOUD_ID_PATTERN.test(body.mutationId); }
  router.put('/documents/:id', json, async (req, res) => {
    const b = req.body, id = String(req.params.id);
    if (!validMutation(b) || !/^[a-f0-9]{64}$/.test(b.hash ?? '') || !Number.isSafeInteger(b.byteLength) || b.byteLength < 1 || b.byteLength > CLOUD_MAX_DOCUMENT_BYTES || !Array.isArray(b.chunkHashes) || !b.chunkHashes.length || b.chunkHashes.length > CLOUD_MAX_CHUNKS || !b.chunkHashes.every((h: unknown) => typeof h === 'string' && /^[a-f0-9]{64}$/.test(h))) return res.status(400).json({ error: 'invalid_manifest' });
    const chunks: Buffer[] = []; let length = 0;
    for (const hash of b.chunkHashes) {
      const chunk = await store!.getChunk(hash);
      if (!chunk || sha256(chunk) !== hash) return res.status(400).json({ error: 'missing_or_corrupt_chunk', hash });
      length += chunk.length; if (length > b.byteLength || length > CLOUD_MAX_DOCUMENT_BYTES) return res.status(400).json({ error: 'length_mismatch' });
      chunks.push(chunk);
    }
    const bytes = Buffer.concat(chunks);
    if (length !== b.byteLength || sha256(bytes) !== b.hash) return res.status(400).json({ error: 'hash_mismatch' });
    try { const doc = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); if (doc?.id !== id) return res.status(400).json({ error: 'document_id_mismatch' }); }
    catch { return res.status(400).json({ error: 'invalid_document_json' }); }
    const result = await store!.mutate(b.baseVersion, { id, mutationId: b.mutationId, hash: b.hash, chunkHashes: b.chunkHashes, byteLength: b.byteLength, deleted: false });
    if (!result.ok) return res.status(409).json({ error: 'conflict', current: result.current }); res.json(result.record);
  });
  router.delete('/documents/:id', json, async (req, res) => {
    const b = req.body, id = String(req.params.id); if (!validMutation(b)) return res.status(400).json({ error: 'invalid_mutation' });
    const current = await store!.get(id); if (!current) return res.status(404).json({ error: 'not_found' });
    const result = await store!.mutate(b.baseVersion, { ...current, mutationId: b.mutationId, deleted: true });
    if (!result.ok) return res.status(409).json({ error: 'conflict', current: result.current }); res.json(result.record);
  });
  router.use((_req, res) => res.status(404).json({ error: 'not_found' }));
  router.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    // Never log request bodies, connection strings, keys or opaque documents.
    const code = err?.type === 'entity.too.large' ? 413 : err?.type === 'entity.parse.failed' ? 400 : 500;
    res.status(code).json({ error: code === 413 ? 'payload_too_large' : code === 400 ? 'invalid_json' : 'cloud_storage_error' });
  });
  return router;
}
