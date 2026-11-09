/** Opt-in integration test. Creates and shuts down its own synthetic, temporary DB only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { CloudPostgresStore, sha256 } from '../server/cloudStore';
const exec = promisify(execFile);
test('isolated Postgres: cold-start race, CAS, chunks, replay, revisions, deletion, reconnect', { skip: process.env.SCRIBE_TEST_POSTGRES !== '1' }, async () => {
  const root = await fs.mkdtemp('/tmp/scribe-pg-');
  await fs.chmod(root, 0o700);
  const data = path.join(root, 'db');
  const probe = net.createServer(); await new Promise<void>(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = (probe.address() as net.AddressInfo).port;
  await new Promise<void>(resolve => probe.close(() => resolve()));
  const pgctl = '/opt/homebrew/bin/pg_ctl';
  const stores: CloudPostgresStore[] = [];
  let started = false;
  try {
    await exec('/opt/homebrew/bin/initdb', ['-D', data, '-A', 'trust', '--no-locale', '-E', 'UTF8']);
    await exec(pgctl, ['-D', data, '-l', path.join(root, 'server.log'), '-o', `-p ${port} -h 127.0.0.1 -k ${root}`, '-w', 'start']);
    started = true;
    const url = `postgresql://${encodeURIComponent(os.userInfo().username)}@127.0.0.1:${port}/postgres?sslmode=disable`;
    const a = new CloudPostgresStore(url), b = new CloudPostgresStore(url); stores.push(a, b);
    assert.deepEqual(await Promise.all([a.list(), b.list()]), [[], []]);
    const bytes = Buffer.from('{"id":"pg-document","content":"Synthetic 🌿"}'), hash = sha256(bytes);
    await Promise.all([a.putChunk(hash, bytes), b.putChunk(hash, bytes)]);
    assert.deepEqual(await b.getChunk(hash), bytes);
    const mutation = { id: 'pg-document', hash, byteLength: bytes.length, chunkHashes: [hash], deleted: false, mutationId: 'first' };
    const competing = await Promise.all([a.mutate(0, mutation), b.mutate(0, { ...mutation, mutationId: 'second' })]);
    assert.equal(competing.filter(v => v.ok).length, 1);
    const winner = competing.find(v => v.ok)!; assert.ok(winner.ok);
    const winningMutation = { ...mutation, mutationId: winner.record.mutationId };
    assert.deepEqual(await b.mutate(0, winningMutation), winner);
    assert.equal((await a.mutate(1, { ...mutation, mutationId: 'tombstone', deleted: true })).ok, true);
    assert.equal((await b.get(mutation.id))?.deleted, true);
    assert.equal((await b.mutate(2, { ...mutation, mutationId: 'restore' })).ok, true);
    for (let version = 3; version < 55; version++) assert.equal((await a.mutate(version, { ...mutation, mutationId: 'edit-' + version })).ok, true);
    const revisions = await b.revisions(mutation.id); assert.equal(revisions.length, 50); assert.equal(revisions[0].version, 55); assert.equal(revisions.at(-1)?.version, 6);
    assert.deepEqual(await a.mutate(0, winningMutation), winner); // Old retries remain idempotent.
    assert.equal((await a.get(mutation.id))?.version, 55);
    const c = new CloudPostgresStore(url); stores.push(c);
    assert.equal((await c.get(mutation.id))?.version, 55); assert.deepEqual(await c.getChunk(hash), bytes);
  } finally {
    await Promise.all(stores.map(s => s.close()));
    // Only ever target the unique directory created by this test.
    if (started) await exec(pgctl, ['-D', data, '-m', 'fast', '-w', 'stop']);
    else { try { await fs.access(path.join(data, 'postmaster.pid')); await exec(pgctl, ['-D', data, '-m', 'fast', '-w', 'stop']); } catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; } }
    await fs.rm(root, { recursive: true, force: true });
  }
});
