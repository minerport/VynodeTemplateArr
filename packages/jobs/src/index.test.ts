import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FileDurableJobRepository } from './index.js';

test('persists, leases, heartbeats, and completes jobs across repository instances', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-jobs-'));
  try {
    const path = join(directory, 'jobs.json');
    const first = new FileDurableJobRepository(path);
    const queued = await first.enqueue(
      { kind: 'collection.sync', input: { id: 'one' }, idempotencyKey: 'sync-one' },
      new Date('2026-01-01T00:00:00.000Z')
    );
    const duplicate = await first.enqueue({
      kind: 'collection.sync', input: { id: 'one' }, idempotencyKey: 'sync-one',
    });
    assert.equal(duplicate.id, queued.id);

    const restarted = new FileDurableJobRepository(path);
    const claimed = await restarted.claim(
      'worker-a', 30_000, new Date('2026-01-01T00:00:01.000Z')
    );
    assert.equal(claimed?.status, 'running');
    assert.equal(claimed?.attempts, 1);
    assert.equal(
      (await restarted.heartbeat(
        queued.id, 'worker-a', 45, 30_000,
        new Date('2026-01-01T00:00:02.000Z')
      ))?.progress,
      45
    );
    assert.equal(
      (await restarted.complete(
        queued.id, 'worker-a', { applied: 2 },
        new Date('2026-01-01T00:00:03.000Z')
      ))?.status,
      'succeeded'
    );
    assert.equal((await first.get(queued.id))?.status, 'succeeded');
    assert.doesNotMatch(await readFile(path, 'utf8'), /worker-a/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('recovers expired leases, retries safely, and honors cancellation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-jobs-'));
  try {
    const repository = new FileDurableJobRepository(join(directory, 'jobs.json'));
    const retry = await repository.enqueue(
      { kind: 'overlay.sync', input: {}, maxAttempts: 2 },
      new Date('2026-01-01T00:00:00.000Z')
    );
    await repository.claim('worker-a', 1_000, new Date('2026-01-01T00:00:00.000Z'));
    assert.equal(
      await repository.recoverExpired(new Date('2026-01-01T00:00:02.000Z')),
      1
    );
    assert.equal((await repository.get(retry.id))?.status, 'queued');
    await repository.claim('worker-b', 1_000, new Date('2026-01-01T00:00:03.000Z'));
    await repository.recoverExpired(new Date('2026-01-01T00:00:05.000Z'));
    assert.equal((await repository.get(retry.id))?.status, 'failed');

    const cancelled = await repository.enqueue({ kind: 'watchlist.sync', input: {} });
    assert.equal(
      (await repository.requestCancellation(cancelled.id))?.status,
      'cancelled'
    );
    assert.equal(await repository.claim('worker-c', 1_000), undefined);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
