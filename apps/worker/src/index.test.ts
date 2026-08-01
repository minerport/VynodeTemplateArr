import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FileDurableJobRepository } from '@vynode/jobs';

import { DurableWorker } from './index.js';

test('claims and completes a registered durable job with progress', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-worker-'));
  try {
    const repository = new FileDurableJobRepository(join(directory, 'jobs.json'));
    const job = await repository.enqueue({ kind: 'test', input: { value: 7 } });
    const worker = new DurableWorker({
      repository,
      workerId: 'test-worker',
      handlers: {
        test: async (claimed, context) => {
          await context.reportProgress(50);
          assert.deepEqual(claimed.input, { value: 7 });
          return { value: 14 };
        },
      },
    });
    assert.equal(await worker.runOnce(), true);
    assert.deepEqual((await repository.get(job.id))?.result, { value: 14 });
    assert.equal((await repository.get(job.id))?.status, 'succeeded');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('requeues handler failures and records unsupported kinds truthfully', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-worker-'));
  try {
    const repository = new FileDurableJobRepository(join(directory, 'jobs.json'));
    const retry = await repository.enqueue({ kind: 'retry', input: {}, maxAttempts: 2 });
    const unknown = await repository.enqueue({ kind: 'unknown', input: {}, maxAttempts: 1 });
    const worker = new DurableWorker({
      repository,
      workerId: 'test-worker',
      handlers: { retry: async () => { throw new Error('temporary failure'); } },
    });
    await worker.runOnce();
    assert.equal((await repository.get(retry.id))?.status, 'queued');
    await worker.runOnce();
    assert.equal((await repository.get(retry.id))?.status, 'failed');
    await worker.runOnce();
    assert.equal((await repository.get(unknown.id))?.status, 'failed');
    assert.match((await repository.get(unknown.id))?.error ?? '', /No worker handler/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
