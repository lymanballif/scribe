import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { FileStore } from '../server/store';
import { publicReaderOnly } from '../server/publicReader';
import { resolveShareUrl } from '../shared/shareUrl';

test('public reader origin remains public when editing on a private hostname', () => {
  assert.equal(resolveShareUrl('https://read.example.test/s/abcd2345', 'https://private.example.test'), 'https://read.example.test/s/abcd2345');
  assert.equal(resolveShareUrl('/s/abcd2345', 'https://private.example.test'), 'https://private.example.test/s/abcd2345');
  assert.throws(() => resolveShareUrl('javascript:alert(1)', 'https://private.example.test'));
});

test('integrated reader serves a published photo pair and comments while denying all author/private routes', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'scribe-reader-test-'));
  const dist = path.join(dir, 'dist'); await mkdir(path.join(dist, 'assets'), { recursive: true });
  await writeFile(path.join(dist, 'index.html'), '<html><head><title>Write</title></head><body><div id="root"></div><script src="/assets/test.js"></script></body></html>');
  await writeFile(path.join(dist, 'assets/test.js'), '/* synthetic reader asset */');
  const previousDist = process.env.DIST_DIR, previousUrl = process.env.PUBLIC_SHARE_URL;
  process.env.DIST_DIR = dist; process.env.PUBLIC_SHARE_URL = 'https://read.example.test';
  let server: ReturnType<express.Express['listen']> | undefined;
  try {
    const { createApp } = await import('../server/app');
    const store = new FileStore(path.join(dir, 'data'));
    const ids = ['a'.repeat(64), 'b'.repeat(64)];
    for (const id of ids) await store.putImage(id, { mime: 'image/png', bytes: Buffer.from('synthetic-photo-' + id) });
    await store.putShare({ id: 'abcd2345', title: 'Synthetic pair', author: 'Test', tokenHash: 'c'.repeat(64), content: {}, html: `<figure class="image-row"><img src="/i/${ids[0]}.png"><img src="/i/${ids[1]}.png"></figure>`, excerpt: 'Test only', coverImage: `/i/${ids[0]}.png`, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    const app = createApp(store, { publicReaderOnly: true });
    server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server!.once('listening', resolve));
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    const page = await fetch(base + '/s/abcd2345'); assert.equal(page.status, 200);
    const html = await page.text();
    assert.match(html, /https:\/\/read\.example\.test\/s\/abcd2345/);
    for (const id of ids) { assert.ok(html.includes(id)); const image = await fetch(`${base}/i/${id}.png`); assert.equal(image.status, 200); assert.equal(await image.text(), 'synthetic-photo-' + id); }
    assert.equal((await fetch(base + '/assets/test.js')).status, 200);
    const publicData = await (await fetch(base + '/api/shares/abcd2345')).json();
    assert.equal(publicData.title, 'Synthetic pair'); assert.equal(publicData.tokenHash, undefined); assert.equal(publicData.content, undefined);
    const comment = await fetch(base + '/api/shares/abcd2345/comments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'Test reader', text: 'Synthetic comment' }) });
    assert.equal(comment.status, 200); const commentBody = await comment.json(); assert.equal(commentBody.byAuthor, false);
    const comments = await (await fetch(base + '/api/shares/abcd2345/comments')).json(); assert.equal(comments.length, 1);
    for (const [method, route] of [['GET', '/'], ['GET', '/index.html'], ['GET', '/api/cloud/status'], ['POST', '/api/cloud/login'], ['GET', '/api/cloud/documents'], ['POST', '/api/images'], ['POST', '/api/shares'], ['PUT', '/api/shares/abcd2345'], ['DELETE', '/api/shares/abcd2345'], ['PATCH', `/api/shares/abcd2345/comments/${commentBody.id}`], ['DELETE', `/api/shares/abcd2345/comments/${commentBody.id}`]]) {
      assert.equal((await fetch(base + route, { method })).status, 404, `${method} ${route}`);
    }
    assert.ok(await store.getShare('abcd2345')); assert.equal((await store.listComments('abcd2345')).length, 1);
    const previousMode = process.env.SCRIBE_PUBLIC_READER;
    try { process.env.SCRIBE_PUBLIC_READER = 'true'; assert.throws(() => createApp(store), /ambiguous access mode/); }
    finally { if (previousMode === undefined) delete process.env.SCRIBE_PUBLIC_READER; else process.env.SCRIBE_PUBLIC_READER = previousMode; }
  } finally {
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    if (previousDist === undefined) delete process.env.DIST_DIR; else process.env.DIST_DIR = previousDist;
    if (previousUrl === undefined) delete process.env.PUBLIC_SHARE_URL; else process.env.PUBLIC_SHARE_URL = previousUrl;
    await rm(dir, { recursive: true, force: true });
  }
});

test('public reader gate exposes only published reading, public images, assets and reader comments', async () => {
  const app = express(); app.use(publicReaderOnly); app.use((_req, res) => res.status(204).end());
  const server = app.listen(0, '127.0.0.1'); await new Promise<void>(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as any).port}`;
  try {
    for (const path of ['/s/abcd2345', '/api/shares/abcd2345', '/api/shares/abcd2345/comments', '/i/' + 'a'.repeat(64) + '.png', '/assets/index-abc123.js', '/icon-192.png']) {
      assert.equal((await fetch(base + path)).status, 204, path);
      assert.equal((await fetch(base + path, { method: 'HEAD' })).status, 204, path);
    }
    assert.equal((await fetch(base + '/api/shares/abcd2345/comments', { method: 'POST' })).status, 204);
    for (const path of ['/', '/index.html', '/sw.js', '/manifest.webmanifest', '/api/cloud/status', '/api/cloud/documents', '/api/cloud/chunks/' + 'a'.repeat(64), '/api/images', '/api/images/check', '/api/shares', '/api/health', '/.env', '/data/private/documents', '/assets/../index.html', '/s/not-an-id']) {
      for (const method of ['GET', 'POST', 'PUT', 'DELETE', 'PATCH']) {
        const response = await fetch(base + path, { method });
        assert.equal(response.status, 404, `${method} ${path}`);
        assert.equal(response.headers.get('cache-control'), 'no-store');
      }
    }
    for (const method of ['PUT', 'DELETE', 'PATCH']) assert.equal((await fetch(base + '/api/shares/abcd2345', { method })).status, 404);
    for (const method of ['DELETE', 'PATCH']) assert.equal((await fetch(base + '/api/shares/abcd2345/comments/efgh5678', { method })).status, 404);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
