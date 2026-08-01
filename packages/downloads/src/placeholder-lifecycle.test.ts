import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  GenericPlaceholderMediaWriter,
  PlaceholderLifecycleCoordinator,
  type PlaceholderInventory,
} from './placeholder-lifecycle.js';

test('creates, indexes, retains, and removes placeholders when real media arrives', async () => {
  let inventory: PlaceholderInventory = { revision: 0, records: [] };
  const files = new Set<string>();
  const labels: Array<{ ratingKey: string; labels: readonly string[] }> = [];
  let refreshes = 0;
  const coordinator = new PlaceholderLifecycleCoordinator(
    {
      async get() {
        return structuredClone(inventory);
      },
      async compareAndSet(expected, next) {
        if (inventory.revision !== expected) return false;
        inventory = structuredClone(next);
        return true;
      },
    },
    {
      async create(_root, candidate) {
        const mediaPath = `/media/Vynode Placeholders/${candidate.title}.mp4`;
        const sidecarPath = `${mediaPath}.json`;
        files.add(mediaPath);
        files.add(sidecarPath);
        return { mediaPath, sidecarPath };
      },
      async remove(_root, record) {
        files.delete(record.mediaPath);
        files.delete(record.sidecarPath);
      },
    },
    {
      async refreshLibrary() {
        refreshes += 1;
      },
      async findByMediaPath(_libraryId, mediaPath) {
        return files.has(mediaPath) ? { ratingKey: 'plex-placeholder' } : undefined;
      },
      async addLabels(ratingKey, values) {
        labels.push({ ratingKey, labels: values });
      },
    },
    () => new Date('2026-07-29T12:00:00.000Z')
  );
  const candidate = {
    key: 'movie:tmdb:99',
    mediaType: 'movie' as const,
    title: 'Future Movie',
    year: 2027,
    releaseDate: '2027-01-01',
    tmdbId: 99,
  };
  const created = await coordinator.synchronize({
    libraryId: '1',
    libraryRoot: '/media',
    candidates: [candidate],
    availableKeys: new Set(),
    daysAhead: 730,
    includeAllReleasedItems: true,
    releasedRetentionDays: 7,
  });
  assert.deepEqual(created, {
    created: 1,
    indexed: 1,
    removed: 0,
    retained: 1,
    skipped: 0,
    failed: 0,
    failures: [],
    indexedItems: [
      {
        key: 'movie:tmdb:99',
        mediaType: 'movie',
        ratingKey: 'plex-placeholder',
      },
    ],
  });
  assert.equal(refreshes, 1);
  assert.deepEqual(labels, [
    {
      ratingKey: 'plex-placeholder',
      labels: ['trailer-placeholder', 'vynode-placeholder'],
    },
  ]);

  const removed = await coordinator.synchronize({
    libraryId: '1',
    libraryRoot: '/media',
    candidates: [candidate],
    availableKeys: new Set(['movie:tmdb:99']),
    daysAhead: 730,
    includeAllReleasedItems: true,
    releasedRetentionDays: 7,
  });
  assert.equal(removed.removed, 1);
  assert.equal(removed.retained, 0);
  assert.equal(files.size, 0);
  assert.equal(refreshes, 2);
});

test('uses safe paths and refuses cleanup outside the managed folder', async () => {
  const writer = new GenericPlaceholderMediaWriter(
    new Uint8Array([0, 1, 2, 3])
  );
  await assert.rejects(
    writer.remove('/media', {
      id: 'bad',
      libraryId: '1',
      key: 'bad',
      mediaType: 'movie',
      title: 'Bad',
      mediaPath: '/media/real/movie.mp4',
      sidecarPath: '/media/real/movie.json',
      createdAt: '2026-07-29T00:00:00.000Z',
      lastSeenAt: '2026-07-29T00:00:00.000Z',
      state: 'created',
    }),
    /Refusing to remove/
  );
});

test('writes Plex-compatible movie and TV layouts with durable sidecars', async () => {
  const root = await mkdtemp(path.join(tmpdir(), 'vynode-placeholders-'));
  const writer = new GenericPlaceholderMediaWriter(
    new Uint8Array([0, 1, 2, 3])
  );
  try {
    const movie = await writer.create(root, {
      key: 'movie:99',
      mediaType: 'movie',
      title: 'Future: Movie',
      year: 2027,
      tmdbId: 99,
    });
    assert.match(
      movie.mediaPath.replaceAll('\\', '/'),
      /Vynode Placeholders\/Future Movie \(2027\)\/Future Movie \(2027\) \{tmdb-99\} - Trailer \(Placeholder\)\.mp4$/
    );

    const show = await writer.create(root, {
      key: 'show:88',
      mediaType: 'show',
      title: 'Future Show',
      year: 2028,
      tvdbId: 88,
    });
    assert.match(
      show.mediaPath.replaceAll('\\', '/'),
      /Vynode Placeholders\/Future Show \(2028\) \{tvdb-88\}\/Season 01\/Future Show - S01E01 - Placeholder\.mp4$/
    );
    const sidecar = JSON.parse(await readFile(show.sidecarPath, 'utf8')) as {
      marker?: string;
      tvdbId?: number;
    };
    assert.deepEqual(sidecar, {
      marker: 'vynode-placeholder',
      key: 'show:88',
      mediaType: 'show',
      title: 'Future Show',
      year: 2028,
      tvdbId: 88,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('keeps future items outside the configured window out of Plex', async () => {
  let inventory: PlaceholderInventory = { revision: 0, records: [] };
  const coordinator = new PlaceholderLifecycleCoordinator(
    {
      async get() {
        return inventory;
      },
      async compareAndSet(_expected, next) {
        inventory = next;
        return true;
      },
    },
    {
      async create() {
        throw new Error('should not create');
      },
      async remove() {},
    },
    {
      async refreshLibrary() {},
      async findByMediaPath() {
        return undefined;
      },
      async addLabels() {},
    },
    () => new Date('2026-07-29T00:00:00.000Z')
  );
  const report = await coordinator.synchronize({
    libraryId: '1',
    libraryRoot: '/media',
    candidates: [
      {
        key: 'movie:tmdb:100',
        mediaType: 'movie',
        title: 'Far Future',
        releaseDate: '2030-01-01',
        tmdbId: 100,
      },
    ],
    availableKeys: new Set(),
    daysAhead: 30,
    includeAllReleasedItems: true,
    releasedRetentionDays: 7,
  });
  assert.equal(report.skipped, 1);
  assert.equal(report.created, 0);
});
