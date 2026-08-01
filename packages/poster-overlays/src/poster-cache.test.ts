import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FilePosterCache } from './poster-cache.js';

test('atomically stores poster bytes under a hashed, private filename', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-poster-cache-'));
  try {
    const cache = new FilePosterCache({ directory });
    await cache.put('../unsafe/poster?token=secret', new Uint8Array([1, 2, 3]));
    assert.deepEqual(
      Array.from((await cache.get('../unsafe/poster?token=secret'))!),
      [1, 2, 3]
    );
    const files = await readdir(directory);
    assert.equal(files.length, 1);
    assert.match(files[0]!, /^[a-f0-9]{64}$/);
    assert.doesNotMatch(files[0]!, /unsafe|secret/);
    if (process.platform !== 'win32')
      assert.equal((await stat(join(directory, files[0]!))).mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('expires stale entries and cleanup ignores unrelated user files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-poster-cache-'));
  try {
    let now = Date.parse('2026-07-26T12:00:00.000Z');
    const cache = new FilePosterCache({
      directory,
      ttlMs: 1_000,
      now: () => now,
    });
    await cache.put('expired', new Uint8Array([1]));
    const [file] = await readdir(directory);
    const old = new Date(now - 2_000);
    await utimes(join(directory, file!), old, old);
    await writeFile(join(directory, 'README.txt'), 'keep');
    const cleanup = await cache.cleanup();
    assert.deepEqual(cleanup, { deleted: 1, retained: 1, errors: 0 });
    assert.equal(await cache.get('expired'), undefined);
    now += 1_000;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('removes corrupt-sized entries and rejects invalid writes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-poster-cache-'));
  try {
    const cache = new FilePosterCache({ directory, maxBytes: 2 });
    await assert.rejects(cache.put('empty', new Uint8Array()), /size is invalid/);
    await assert.rejects(
      cache.put('large', new Uint8Array([1, 2, 3])),
      /size is invalid/
    );
    await cache.put('valid', new Uint8Array([1, 2]));
    const [file] = await readdir(directory);
    await writeFile(join(directory, file!), new Uint8Array([1, 2, 3]));
    await assert.rejects(cache.get('valid'), /invalid size/);
    assert.equal(await cache.get('valid'), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
