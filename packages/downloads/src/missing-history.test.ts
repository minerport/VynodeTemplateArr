import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FileMissingRequestRepository } from './missing-history.js';

const input = (operationKey: string, title = operationKey) => ({
  operationKey,
  candidateKey: `movie:tmdb:${operationKey}`,
  tmdbId: Number(operationKey.replace(/\D/g, '')) || 1,
  mediaType: 'movie' as const,
  title,
  collectionName: 'Award Winners',
  collectionSource: 'MDBList',
  requestService: 'Radarr',
  requestMethod: 'auto' as const,
});

test('persists lifecycle transitions across repository restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-missing-history-'));
  const path = join(directory, 'history.json');
  try {
    const first = new FileMissingRequestRepository(path);
    await first.begin([input('272')], new Date('2026-07-26T12:00:00Z'));
    await first.complete(
      '272',
      { requestStatus: 'approved', serviceId: 44 },
      new Date('2026-07-26T12:01:00Z')
    );

    const restarted = new FileMissingRequestRepository(path);
    const page = await restarted.list('movie', 5, 0);
    assert.equal(page.total, 1);
    assert.deepEqual(
      {
        title: page.results[0]?.title,
        status: page.results[0]?.requestStatus,
        serviceId: page.results[0]?.serviceId,
      },
      { title: '272', status: 'approved', serviceId: 44 }
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('deduplicates operation retries, bounds history, and redacts failure notes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-missing-history-'));
  const path = join(directory, 'history.json');
  try {
    const repository = new FileMissingRequestRepository(path, 2);
    await repository.begin([input('1')], new Date('2026-07-26T12:00:00Z'));
    await repository.begin(
      [input('1', 'Retried title')],
      new Date('2026-07-26T12:01:00Z')
    );
    await repository.complete(
      '1',
      {
        requestStatus: 'failed',
        notes:
          'https://admin:password@radarr.local/api apiKey=1234567890abcdef1234567890abcdef',
      },
      new Date('2026-07-26T12:02:00Z')
    );
    const redactedBytes = await readFile(path, 'utf8');
    assert.equal(redactedBytes.includes('password'), false);
    assert.equal(
      redactedBytes.includes('1234567890abcdef1234567890abcdef'),
      false
    );
    await repository.begin(
      [input('2'), input('3')],
      new Date('2026-07-26T12:03:00Z')
    );

    const page = await repository.list('movie', 10, 0);
    assert.equal(page.total, 2);
    assert.deepEqual(
      page.results.map((record) => record.operationKey),
      ['2', '3']
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
