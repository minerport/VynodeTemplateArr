import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FilePlexSynchronizationCheckpointRepository } from './plex-checkpoints-file.js';

test('atomically persists and reloads Plex synchronization fingerprints', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-checkpoints-'));
  try {
    const repository = new FilePlexSynchronizationCheckpointRepository(
      join(directory, 'plex-sync.json')
    );
    assert.deepEqual(await repository.get(), { itemFingerprints: {} });
    await repository.save({
      itemFingerprints: { first: 'abc', second: 'def' },
      orderFingerprint: 'order',
    });
    assert.deepEqual(await repository.get(), {
      itemFingerprints: { first: 'abc', second: 'def' },
      orderFingerprint: 'order',
    });
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('refuses corrupt Plex synchronization checkpoint data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-checkpoints-'));
  try {
    const path = join(directory, 'plex-sync.json');
    await writeFile(path, '{"itemFingerprints":{"first":7}}');
    const repository = new FilePlexSynchronizationCheckpointRepository(path);
    await assert.rejects(repository.get(), /checkpoint file is corrupt/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
