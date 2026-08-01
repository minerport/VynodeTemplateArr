import type { CollectionDraft } from '@vynode/contracts';
import { VynodeSqliteStorage } from '@vynode/storage';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ProductionCollectionSurface } from './production-collections.js';
const draft = (title: string, libraryId = '1'): CollectionDraft => ({
  title,
  description: 'Description',
  mediaType: 'movie',
  libraryId,
  sourceType: 'manual',
  sourceSettings: {
    subtype: '',
    maxItems: 10,
    itemOrder: 'default',
    manualMembers: [],
  },
  posterSettings: {} as CollectionDraft['posterSettings'],
  behaviorSettings: {} as CollectionDraft['behaviorSettings'],
  missingMediaSettings: {} as CollectionDraft['missingMediaSettings'],
  multiSourceSettings: { combineMode: 'list-order', sources: [] },
  metadataSettings: {
    enableCustomSummary: false,
    customSummary: '',
    enableCustomWallpaper: false,
    enableCustomTheme: false,
  },
  tmdbDiscoverSettings: {
    movieSortBy: 'popularity.desc',
    tvSortBy: 'popularity.desc',
    filterGroups: [],
  },
});
const plex = async () => ({
  revision: 1,
  host: 'plex.local',
  port: 32400,
  transport: 'http' as const,
  autoEmptyTrash: false,
  machineIdentifier: 'machine',
  name: 'Plex',
  verifiedAt: '2026-01-01T00:00:00.000Z',
  libraries: [
    {
      key: '1',
      title: 'Movies',
      type: 'movie' as const,
      locations: [],
      available: true,
      observedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      key: '2',
      title: 'Movies 4K',
      type: 'movie' as const,
      locations: [],
      available: true,
      observedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
});
test('persists collection CRUD, placement, copying, and links across restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-collections-'));
  const path = join(directory, 'vynode.db');
  try {
    const storage = new VynodeSqliteStorage(path);
    const surface = new ProductionCollectionSurface(storage, plex);
    const first = (await surface.save(undefined, draft('First')))!;
    const second = (await surface.save(undefined, {
      ...draft('Second', '2'),
      description: 'Member-specific description',
    }))!;
    assert.equal(
      (await surface.updatePlacement(first.id, { homeVisible: false }))
        ?.homeVisible,
      false
    );
    assert.equal(
      await surface.reorderPlacement(first.id, second.id, 'sharedOrder'),
      true
    );
    const linked = await surface.link(first.id, [second.id]);
    assert.equal(linked?.collections.length, 2);
    assert.equal(
      linked?.collections.find((item) => item.id === second.id)?.description,
      'Description'
    );
    await surface.save(first.id, {
      ...draft('First'),
      description: 'Updated linked description',
    });
    await surface.updatePlacement(first.id, { recommendedVisible: false });
    const linkedMember = (await surface.get()).collections.find(
      (item) => item.id === second.id
    );
    assert.equal(linkedMember?.description, 'Updated linked description');
    assert.equal(linkedMember?.recommendedVisible, false);
    assert.equal(linkedMember?.libraryId, '2');
    assert.match((await surface.copy(first.id))?.title ?? '', /Copy/);
    storage.close();
    const reopened = new VynodeSqliteStorage(path);
    const restored = new ProductionCollectionSurface(reopened, plex);
    assert.equal((await restored.get()).collections.length, 3);
    assert.equal(await restored.delete(second.id), true);
    await assert.rejects(() => restored.discoverPlex(), /not connected/);
    reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects empty, duplicate, and same-library managed collection link groups', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-invalid-links-'));
  try {
    const storage = new VynodeSqliteStorage(join(directory, 'vynode.db'));
    const surface = new ProductionCollectionSurface(storage, plex);
    const first = (await surface.save(undefined, draft('First')))!;
    const second = (await surface.save(undefined, draft('Second')))!;
    assert.equal(await surface.link(first.id, []), undefined);
    assert.equal(await surface.link(first.id, [first.id]), undefined);
    assert.equal(
      await surface.link(first.id, [second.id, second.id]),
      undefined
    );
    await assert.rejects(
      () => surface.link(first.id, [second.id]),
      /different Plex libraries/
    );
    storage.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('persists verified synchronization results and records failed runs', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-sync-'));
  try {
    const storage = new VynodeSqliteStorage(join(directory, 'vynode.db'));
    let fail = false;
    const surface = new ProductionCollectionSurface(
      storage,
      plex,
      undefined,
      async () => {
        if (fail) throw new Error('Plex unavailable');
        return {
          plexRatingKey: '900',
          itemCount: 2,
          created: true,
          failures: [],
        };
      }
    );
    const saved = (await surface.save(undefined, draft('Synced')))!;
    const result = await surface.synchronize(saved.id);
    assert.equal(result?.plexRatingKey, '900');
    let stored = (await surface.get()).collections[0]!;
    assert.equal(stored.status, 'ready');
    assert.equal(stored.itemCount, 2);
    assert.equal(stored.plexRatingKey, '900');
    assert.ok(stored.lastSyncedAt);
    fail = true;
    await assert.rejects(
      () => surface.synchronize(saved.id),
      /Plex unavailable/
    );
    stored = (await surface.get()).collections[0]!;
    assert.equal(stored.status, 'error');
    storage.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('retains a created Plex identity when verification fails so retries cannot duplicate it', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-sync-identity-'));
  try {
    const storage = new VynodeSqliteStorage(join(directory, 'vynode.db'));
    const observedKeys: Array<string | undefined> = [];
    const surface = new ProductionCollectionSurface(
      storage,
      plex,
      undefined,
      async (collection, _signal, onPlexIdentity) => {
        observedKeys.push(collection.plexRatingKey);
        if (!collection.plexRatingKey) await onPlexIdentity?.('901');
        throw new Error('Plex verification failed');
      }
    );
    const saved = (await surface.save(undefined, draft('Retry safe')))!;

    await assert.rejects(() => surface.synchronize(saved.id), /verification failed/);
    let stored = (await surface.get()).collections[0]!;
    assert.equal(stored.plexRatingKey, '901');
    assert.equal(stored.status, 'error');

    await assert.rejects(() => surface.synchronize(saved.id), /verification failed/);
    stored = (await surface.get()).collections[0]!;
    assert.deepEqual(observedKeys, [undefined, '901']);
    assert.equal(stored.plexRatingKey, '901');
    storage.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('production Plex value generators create and persist one smart collection per value', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-generator-'));
  try {
    const storage = new VynodeSqliteStorage(join(directory, 'vynode.db'));
    const surface = new ProductionCollectionSurface(storage, plex);
    surface.connectLibraryGenerator(
      async () => [
        { value: '1990s', label: '1990s', count: 4 },
        { value: '2000s', label: '2000s', count: 7 },
      ],
      async (_collection, values) => ({
        references: values.map((value, index) => ({
          value: value.value,
          title: `${value.label} Movies`,
          ratingKey: String(800 + index),
        })),
        failures: [],
      })
    );
    const input = {
      ...draft('Through the Decades'),
      sourceType: 'plex' as const,
      sourceSettings: {
        subtype: 'decades',
        maxItems: 50,
        itemOrder: 'alphabetical' as const,
        plexGenerator: {
          selectionMode: 'include' as const,
          selectedValues: [],
          enabledRatingGroups: [
            'australia',
            'television',
            'numeric',
            'other',
          ] as const,
          titleTemplate: '{value} Movies',
          cleanupMissing: true,
        },
      },
    };
    const saved = (await surface.save(undefined, input))!;
    const result = await surface.synchronize(saved.id);
    assert.equal(result?.itemCount, 2);
    const stored = (await surface.get()).collections[0]!;
    assert.equal(stored.status, 'ready');
    assert.deepEqual(stored.sourceSettings?.plexGenerator?.selectedValues, [
      '1990s',
      '2000s',
    ]);
    assert.deepEqual(
      stored.sourceSettings?.plexGenerator?.generatedCollections?.map(
        (item) => item.ratingKey
      ),
      ['800', '801']
    );
    storage.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('generator retries reuse identities persisted before a later value fails', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-generator-retry-'));
  try {
    const storage = new VynodeSqliteStorage(join(directory, 'vynode.db'));
    const surface = new ProductionCollectionSurface(storage, plex);
    const observed: Array<readonly string[]> = [];
    surface.connectLibraryGenerator(
      async () => [{ value: '4k', label: '4K', count: 3 }],
      async (collection, _values, _signal, onReference) => {
        observed.push(
          (collection.sourceSettings?.plexGenerator?.generatedCollections ?? []).map(
            (reference) => reference.ratingKey
          )
        );
        if (!observed.at(-1)?.length)
          await onReference?.({ value: '4k', title: '4K Quality', ratingKey: '920' });
        return { references: [], failures: ['later value failed'] };
      }
    );
    const saved = (await surface.save(undefined, {
      ...draft('Video Quality'),
      sourceType: 'plex',
      sourceSettings: {
        subtype: 'resolutions',
        maxItems: 50,
        itemOrder: 'alphabetical',
        plexGenerator: {
          selectionMode: 'include',
          selectedValues: [],
          enabledRatingGroups: [],
          titleTemplate: '{value} Quality',
          cleanupMissing: true,
        },
      },
    }))!;

    await assert.rejects(() => surface.synchronize(saved.id), /later value failed/);
    await assert.rejects(() => surface.synchronize(saved.id), /later value failed/);

    assert.deepEqual(observed, [[], ['920']]);
    assert.deepEqual(
      (await surface.get()).collections[0]?.sourceSettings?.plexGenerator
        ?.generatedCollections,
      [{ value: '4k', title: '4K Quality', ratingKey: '920' }]
    );
    storage.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('production person generators persist owned smart collections without using ordinary synchronization', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-people-'));
  try {
    const storage = new VynodeSqliteStorage(join(directory, 'vynode.db'));
    const surface = new ProductionCollectionSurface(storage, plex);
    surface.connectPersonGenerator(async () => ({
      references: [
        { value: 'Person One', title: 'Person One', ratingKey: '910' },
      ],
      failures: [],
    }));
    const input = {
      ...draft('Actor Family'),
      sourceType: 'plex' as const,
      sourceSettings: {
        subtype: 'actors',
        maxItems: 50,
        itemOrder: 'alphabetical' as const,
        personMinimumItems: 2,
        generatedPersonCollections: [],
      },
    };
    const saved = (await surface.save(undefined, input))!;
    const result = await surface.synchronize(saved.id);
    assert.equal(result?.plexRatingKey, '910');
    const stored = (await surface.get()).collections[0]!;
    assert.equal(stored.status, 'ready');
    assert.deepEqual(stored.sourceSettings?.generatedPersonCollections, [
      { value: 'Person One', title: 'Person One', ratingKey: '910' },
    ]);
    storage.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('production preview filters are also applied before results are returned', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-preview-filter-'));
  try {
    const storage = new VynodeSqliteStorage(join(directory, 'vynode.db'));
    const surface = new ProductionCollectionSurface(
      storage,
      plex,
      async (collection) => ({
        collectionId: collection.id,
        sourceType: collection.sourceType,
        fetchedCount: 2,
        matchedCount: 2,
        missingCount: 0,
        items: [
          { title: 'Keep', plexRatingKey: '1', available: true },
          { title: 'Remove', plexRatingKey: '2', available: true },
        ],
        warnings: [],
      })
    );
    surface.connectPreviewFilter(async (_collection, result) => ({
      ...result,
      fetchedCount: 1,
      matchedCount: 1,
      items: result.items.slice(0, 1),
      warnings: ['1 item was removed by collection exclusion rules.'],
    }));
    const saved = (await surface.save(undefined, draft('Filtered')))!;
    const preview = await surface.preview(saved.id);
    assert.deepEqual(
      preview?.items.map((item) => item.title),
      ['Keep']
    );
    assert.match(preview?.warnings[0] ?? '', /exclusion rules/);
    storage.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('production Plex item search passes season identity through its connected provider', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-item-search-'));
  try {
    const storage = new VynodeSqliteStorage(join(directory, 'vynode.db'));
    const surface = new ProductionCollectionSurface(storage, plex);
    surface.connectPlexItemSearch(async (libraryId, query, itemType) => {
      assert.equal(libraryId, '1');
      assert.equal(query, 'season');
      assert.equal(itemType, 'season');
      return [
        {
          ratingKey: '301',
          title: 'Season 1',
          type: 'season',
          libraryId: '1',
          libraryName: 'TV Shows',
          parentRatingKey: '30',
          seasonNumber: 1,
        },
      ];
    });
    const results = await surface.searchPlexItems('1', 'season', 'season');
    assert.equal(results[0]?.ratingKey, '301');
    assert.equal(results[0]?.type, 'season');
    storage.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('production Plex item search preserves episode ancestry', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-episode-search-'));
  try {
    const storage = new VynodeSqliteStorage(join(directory, 'vynode.db'));
    const surface = new ProductionCollectionSurface(storage, plex);
    surface.connectPlexItemSearch(async (_libraryId, _query, itemType) => {
      assert.equal(itemType, 'episode');
      return [
        {
          ratingKey: '401',
          title: 'Pilot',
          type: 'episode',
          libraryId: '2',
          libraryName: 'TV Shows',
          parentRatingKey: '301',
          grandparentRatingKey: '30',
          seasonNumber: 1,
          episodeNumber: 1,
        },
      ];
    });
    const results = await surface.searchPlexItems('2', 'pilot', 'episode');
    assert.equal(results[0]?.grandparentRatingKey, '30');
    assert.equal(results[0]?.seasonNumber, 1);
    assert.equal(results[0]?.episodeNumber, 1);
    storage.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
