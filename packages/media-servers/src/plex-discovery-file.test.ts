import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { PlexDiscoveredItem } from '@vynode/contracts';

import { FilePlexDiscoveryRepository } from './plex-discovery-file.js';

const item: PlexDiscoveredItem = {
  id: 'plex-hub:1:movie.recentlyadded',
  kind: 'default-hub',
  plexKey: 'movie.recentlyadded',
  name: 'Recently Added Movies',
  libraryId: '1',
  libraryName: 'Movies',
  mediaType: 'movie',
  homeOrder: 1,
  libraryOrder: 0,
  visibility: {
    usersHome: true,
    serverOwnerHome: true,
    libraryRecommended: true,
  },
  missing: false,
  isLinked: false,
  isUnlinked: false,
  lastValidatedAt: '2026-07-26T12:00:00.000Z',
  timeRestriction: {
    alwaysActive: true,
    removeFromPlexWhenInactive: false,
    inactiveVisibility: {
      usersHome: false,
      serverOwnerHome: false,
      libraryRecommended: false,
    },
    dateRanges: [],
    weeklySchedule: {
      monday: true,
      tuesday: true,
      wednesday: true,
      thursday: true,
      friday: true,
      saturday: true,
      sunday: true,
    },
  },
};

test('atomically persists discovery state with restrictive file permissions and revision checks', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-discovery-'));
  const path = join(directory, 'state', 'plex-discovery.json');
  try {
    const repository = new FilePlexDiscoveryRepository({ path });
    assert.deepEqual(await repository.get(), {
      revision: 0,
      items: [],
      warnings: [],
    });
    assert.equal(
      await repository.compareAndSet(0, {
        revision: 1,
        items: [item],
        warnings: [],
        lastCompletedAt: '2026-07-26T12:00:00.000Z',
      }),
      true
    );
    assert.equal(
      await repository.compareAndSet(0, {
        revision: 1,
        items: [],
        warnings: [],
      }),
      false
    );
    assert.equal((await repository.get()).items[0]?.id, item.id);
    assert.match(await readFile(path, 'utf8'), /movie\.recentlyadded/);
    if (process.platform !== 'win32') {
      const { mode } = await import('node:fs/promises').then((fs) =>
        fs.stat(path)
      );
      assert.equal(mode & 0o777, 0o600);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects corrupt files and invalid revision transitions without replacing data', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-discovery-'));
  const path = join(directory, 'plex-discovery.json');
  try {
    await writeFile(path, '{"revision":1,"items":"broken","warnings":[]}\n');
    const repository = new FilePlexDiscoveryRepository({ path });
    await assert.rejects(
      () => repository.get(),
      /repository contains invalid data/
    );
    await writeFile(
      path,
      `${JSON.stringify({ revision: 1, items: [item], warnings: [] })}\n`
    );
    await assert.rejects(
      () =>
        repository.compareAndSet(1, {
          revision: 3,
          items: [],
          warnings: [],
        }),
      /must increment exactly once/
    );
    assert.equal((await repository.get()).revision, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('serializes concurrent writers so only one compare-and-set succeeds', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-discovery-'));
  const path = join(directory, 'plex-discovery.json');
  try {
    const first = new FilePlexDiscoveryRepository({
      path,
      lockRetryMs: 2,
    });
    const second = new FilePlexDiscoveryRepository({
      path,
      lockRetryMs: 2,
    });
    const results = await Promise.all([
      first.compareAndSet(0, {
        revision: 1,
        items: [item],
        warnings: ['first'],
      }),
      second.compareAndSet(0, {
        revision: 1,
        items: [],
        warnings: ['second'],
      }),
    ]);
    assert.deepEqual(results.sort(), [false, true]);
    assert.equal((await first.get()).revision, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
