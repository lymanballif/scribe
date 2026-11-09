import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { CloudFileStore, sha256 } from '../server/cloudStore';
import { createCloudRouter } from '../server/cloudRoutes';
import { stableStringify, CLOUD_CHUNK_BYTES } from '../shared/cloud';

const key = 'test-only-private-key-at-least-24-chars';
async function fixture(options: { key?: string; sessionSeconds?: number } = {}) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'scribe-cloud-test-'));
  const store = new CloudFileStore(dir), app = express();
  app.use('/api/cloud', createCloudRouter({ store, key, secureCookies: false, ...options }));
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const origin = `http://127.0.0.1:${(server.address() as any).port}`;
  async function request(route: string, method = 'GET', body?: unknown, cookie = '', requestOrigin = origin) {
    return fetch(origin + '/api/cloud' + route, { method, headers: { origin: requestOrigin, ...(cookie ? { cookie } : {}), ...(body === undefined ? {} : { 'content-type': Buffer.isBuffer(body) ? 'application/octet-stream' : 'application/json' }) }, body: body === undefined ? undefined : Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  }
  async function login() { const res = await request('/login', 'POST', { key }); assert.equal(res.status, 200); return res.headers.get('set-cookie')!.split(';')[0]; }
  async function cleanup() { await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); await fs.rm(dir, { recursive: true, force: true }); }
  return { request, login, cleanup, store, dir };
}

test('private API: gated auth, cookies, CSRF, chunks, CAS, replay, restore and second session', async () => {
  const f = await fixture();
  try {
    const status = await f.request('/status'); assert.deepEqual(await status.json(), { configured: true, authenticated: false }); assert.match(status.headers.get('cache-control')!, /no-store/);
    assert.equal((await f.request('/documents')).status, 401);
    assert.equal((await f.request('/login', 'POST', { key }, '', 'https://evil.example')).status, 403);
    assert.equal((await f.request('/login', 'POST', { key: 'wrong' })).status, 401);
    const session = await f.login(), other = await f.login();
    const cookieResponse = await f.request('/login', 'POST', { key }); assert.match(cookieResponse.headers.get('set-cookie')!, /HttpOnly/); assert.match(cookieResponse.headers.get('set-cookie')!, /SameSite=Strict/);
    assert.equal((await f.request('/documents', 'GET', undefined, session + 'corrupt')).status, 401);
    const document = { id: 'doc-1', title: 'Private', content: { image: 'data:image/png;base64,abc', text: 'こんにちは 🌿' } };
    const bytes = Buffer.from(stableStringify(document)), hash = sha256(bytes);
    assert.equal((await f.request('/chunks/' + hash, 'PUT', bytes, session, 'https://evil.example')).status, 403);
    assert.equal((await f.request('/chunks/' + hash, 'PUT', Buffer.from('bad'), session)).status, 400);
    assert.equal((await f.request('/chunks/' + hash, 'PUT', bytes, session)).status, 200);
    assert.equal((await f.request('/chunks/' + hash)).status, 401);
    const read = await f.request('/chunks/' + hash, 'GET', undefined, other); assert.equal(await read.text(), bytes.toString()); assert.match(read.headers.get('cache-control')!, /no-store/);
    const commit = { hash, chunkHashes: [hash], byteLength: bytes.length, baseVersion: 0, mutationId: 'create-1' };
    const created = await (await f.request('/documents/doc-1', 'PUT', commit, session)).json(); assert.equal(created.version, 1); assert.equal(created.hash, hash);
    assert.deepEqual(await (await f.request('/documents/doc-1', 'PUT', commit, other)).json(), created);
    const conflict = await f.request('/documents/doc-1', 'PUT', { ...commit, mutationId: 'racing' }, other); assert.equal(conflict.status, 409); assert.deepEqual((await conflict.json()).current, created);
    const del = { baseVersion: 1, mutationId: 'delete-1' }; const deleted = await (await f.request('/documents/doc-1', 'DELETE', del, session)).json(); assert.equal(deleted.deleted, true); assert.equal(deleted.version, 2);
    assert.deepEqual(await (await f.request('/documents/doc-1', 'DELETE', del, session)).json(), deleted);
    const restored = await (await f.request('/documents/doc-1', 'PUT', { ...commit, baseVersion: 2, mutationId: 'restore-1' }, other)).json(); assert.equal(restored.version, 3); assert.equal(restored.deleted, false);
    const list = await (await f.request('/documents', 'GET', undefined, other)).json(); assert.equal(list.documents.length, 1);
    const revisions = JSON.parse(await fs.readFile(path.join(f.dir, 'documents/doc-1.json'), 'utf8')); assert.equal(revisions.length, 3); assert.equal(revisions[0].version, 1);
    const loggedOut = await f.request('/logout', 'POST', undefined, session); assert.match(loggedOut.headers.get('set-cookie')!, /Expires=Thu, 01 Jan 1970/);
  } finally { await f.cleanup(); }
});
test('disabled configuration never authenticates; session expiry and login rate limit', async () => {
  const disabled = await fixture({ key: '' });
  try { assert.deepEqual(await (await disabled.request('/status')).json(), { configured: false, authenticated: false }); assert.equal((await disabled.request('/documents')).status, 503); } finally { await disabled.cleanup(); }
  const expired = await fixture({ sessionSeconds: -1 });
  try { const cookie = await expired.login(); assert.equal((await expired.request('/documents', 'GET', undefined, cookie)).status, 401); for (let i = 0; i < 9; i++) await expired.request('/login', 'POST', { key: 'bad' }); assert.equal((await expired.request('/login', 'POST', { key })).status, 429); } finally { await expired.cleanup(); }
});
test('bounds, missing chunks, malformed documents and corrupt storage fail safely', async () => {
  const f = await fixture();
  try {
    const cookie = await f.login(), bytes = Buffer.alloc(CLOUD_CHUNK_BYTES + 1, 'x');
    const tooLarge = await f.request('/chunks/' + sha256(bytes), 'PUT', bytes, cookie); assert.equal(tooLarge.status, 413); assert.match(tooLarge.headers.get('cache-control')!, /no-store/);
    const b = Buffer.from('{"id":"different"}'), hash = sha256(b); await f.request('/chunks/' + hash, 'PUT', b, cookie);
    const commit = { baseVersion: 0, mutationId: 'm1', hash, chunkHashes: [hash], byteLength: b.length };
    assert.equal((await f.request('/documents/doc-1', 'PUT', commit, cookie)).status, 400);
    assert.equal((await f.request('/documents/doc-1', 'PUT', { ...commit, chunkHashes: ['0'.repeat(64)] }, cookie)).status, 400);
    await fs.mkdir(path.join(f.dir, 'documents'), { recursive: true }); await fs.writeFile(path.join(f.dir, 'documents/doc-1.json'), 'broken');
    assert.equal((await f.request('/documents/doc-1', 'GET', undefined, cookie)).status, 500);
  } finally { await f.cleanup(); }
});
test('atomic competing file CAS accepts only one writer', async () => {
  const f = await fixture();
  try {
    const mutation = { id: 'race', hash: 'a'.repeat(64), byteLength: 1, chunkHashes: ['a'.repeat(64)], mutationId: 'one', deleted: false };
    const results = await Promise.all([f.store.mutate(0, mutation), f.store.mutate(0, { ...mutation, mutationId: 'two' })]); assert.equal(results.filter(r => r.ok).length, 1); assert.equal((await f.store.get('race'))?.version, 1);
  } finally { await f.cleanup(); }
});
test('document larger than serverless request cap round trips through private chunks', async () => {
  const f = await fixture();
  try {
    const cookie = await f.login();
    const bytes = Buffer.from(stableStringify({ id: 'large', content: '🌿'.repeat(1_300_000) }));
    assert.ok(bytes.length > 5_000_000);
    const hashes: string[] = [];
    for (let offset = 0; offset < bytes.length; offset += CLOUD_CHUNK_BYTES) {
      const chunk = bytes.subarray(offset, offset + CLOUD_CHUNK_BYTES), hash = sha256(chunk); hashes.push(hash);
      assert.equal((await f.request('/chunks/' + hash, 'PUT', chunk, cookie)).status, 200);
    }
    const manifest = { baseVersion: 0, mutationId: 'large-create', hash: sha256(bytes), chunkHashes: hashes, byteLength: bytes.length };
    const put = await f.request('/documents/large', 'PUT', manifest, cookie); assert.equal(put.status, 200);
    const record = await put.json(), downloaded: Buffer[] = [];
    for (const hash of record.chunkHashes) { const get = await f.request('/chunks/' + hash, 'GET', undefined, cookie); downloaded.push(Buffer.from(await get.arrayBuffer())); }
    assert.equal(sha256(Buffer.concat(downloaded)), manifest.hash);
  } finally { await f.cleanup(); }
});
test('recovery lists newest fifty revisions and preserves the current document', async () => {
  const f = await fixture();
  try {
    const mutation = { id: 'history', hash: 'a'.repeat(64), byteLength: 1, chunkHashes: ['a'.repeat(64)], deleted: false };
    for (let version = 0; version < 55; version++) assert.equal((await f.store.mutate(version, { ...mutation, mutationId: 'edit-' + version })).ok, true);
    assert.equal((await f.request('/documents/history/revisions')).status, 401);
    const res = await f.request('/documents/history/revisions', 'GET', undefined, await f.login());
    assert.match(res.headers.get('cache-control')!, /no-store/);
    const { revisions } = await res.json(); assert.equal(revisions.length, 50); assert.equal(revisions[0].version, 55); assert.equal(revisions.at(-1).version, 6);
    assert.equal((await f.store.get('history'))?.version, 55);
    assert.equal((await fs.readdir(path.join(f.dir, 'documents'))).filter(f => f.endsWith('.tmp')).length, 0);
  } finally { await f.cleanup(); }
});
