import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlexDiscoveredItem } from '@vynode/contracts';

import type { PlexManagementClient } from './plex-http.js';
import {
  PlexDiscoveredItemSynchronizer,
  type PlexDiscoveredAssetResolver,
} from './plex-synchronization.js';

const baseItem = (
  overrides: Partial<PlexDiscoveredItem> = {}
): PlexDiscoveredItem => ({
  id: 'plex-collection:1:35954',
  kind: 'pre-existing-collection',
  plexKey: '35954',
  name: 'Oscar Favorites',
  libraryId: '1',
  libraryName: 'Movies',
  mediaType: 'movie',
  titleSort: 'Awards First',
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
    alwaysActive: false,
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
  posterSettings: {
    autoGenerate: false,
    applyOverlaysDuringSync: false,
    useTmdbFranchisePoster: false,
    hideIndividualItems: true,
    customPoster: {
      kind: 'saved',
      id: 'award-poster',
      name: 'Award Winners',
    },
  },
  metadataSettings: {
    enableCustomSummary: true,
    customSummary: 'Shared awards summary',
    enableCustomWallpaper: true,
    wallpaper: {
      id: 'wallpaper-1',
      name: 'awards.webp',
      mimeType: 'image/webp',
      size: 3,
      previewDataUrl: 'data:image/webp;base64,AQID',
    },
    enableCustomTheme: true,
    theme: {
      id: 'theme-1',
      name: 'awards.mp3',
      mimeType: 'audio/mpeg',
      size: 2,
      previewDataUrl: 'data:audio/mpeg;base64,AQI=',
    },
  },
  ...overrides,
});

const assets: PlexDiscoveredAssetResolver = {
  async resolveAsset(reference) {
    return new TextEncoder().encode(reference.id);
  },
  async renderPoster() {
    return new Uint8Array([9, 8, 7]);
  },
};

test('applies inactive visibility and every supported pre-existing collection mutation', async () => {
  const calls: string[] = [];
  const client = {
    async updateDiscoveredVisibility(
      _item: PlexDiscoveredItem,
      visibility: PlexDiscoveredItem['visibility']
    ) {
      calls.push(`visibility:${JSON.stringify(visibility)}`);
    },
    async updateCollectionSortTitle(_key: string, value: string) {
      calls.push(`sort:${value}`);
    },
    async updateCollectionSummary(_key: string, value: string) {
      calls.push(`summary:${value}`);
    },
    async updateCollectionMode(_key: string, value: number) {
      calls.push(`mode:${value}`);
    },
    async uploadCollectionAsset(_key: string, kind: string, body: Uint8Array) {
      calls.push(`${kind}:${new TextDecoder().decode(body) || body.join(',')}`);
    },
  } as unknown as PlexManagementClient;
  const report = await new PlexDiscoveredItemSynchronizer(
    client,
    assets
  ).synchronizeItem(baseItem(), false);

  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.applied, [
    'visibility',
    'sort-title',
    'summary',
    'collection-mode',
    'poster',
    'wallpaper',
    'theme',
  ]);
  assert.match(calls[0] ?? '', /"usersHome":false/);
  assert.deepEqual(calls.slice(1), [
    'sort:Awards First',
    'summary:Shared awards summary',
    'mode:1',
    'poster:\t\b\u0007',
    'wallpaper:wallpaper-1',
    'theme:theme-1',
  ]);
});

test('reports a failed mutation and continues independent Plex operations', async () => {
  const calls: string[] = [];
  const client = {
    async updateDiscoveredVisibility() {
      calls.push('visibility');
    },
    async updateCollectionSortTitle() {
      calls.push('sort-title');
    },
    async updateCollectionSummary() {
      calls.push('summary');
      throw new Error('Plex returned HTTP 500.');
    },
    async updateCollectionMode() {
      calls.push('collection-mode');
    },
    async uploadCollectionAsset(_key: string, kind: string) {
      calls.push(kind);
    },
  } as unknown as PlexManagementClient;
  const report = await new PlexDiscoveredItemSynchronizer(
    client,
    assets
  ).synchronizeItem(baseItem(), true);

  assert.deepEqual(report.failures, [
    { operation: 'summary', message: 'Plex returned HTTP 500.' },
  ]);
  assert.ok(calls.includes('poster'));
  assert.ok(calls.includes('wallpaper'));
  assert.ok(calls.includes('theme'));
});

test('reports poster rendering failures and still applies wallpaper and theme', async () => {
  const calls: string[] = [];
  const client = {
    async updateDiscoveredVisibility() {},
    async updateCollectionSortTitle() {},
    async updateCollectionSummary() {},
    async updateCollectionMode() {},
    async uploadCollectionAsset(_key: string, kind: string) {
      calls.push(kind);
    },
  } as unknown as PlexManagementClient;
  const report = await new PlexDiscoveredItemSynchronizer(client, {
    ...assets,
    async renderPoster(_item, _settings, signal) {
      assert.ok(signal);
      throw new Error('Template asset is unavailable.');
    },
  }).synchronizeItem(baseItem(), true, new AbortController().signal);

  assert.deepEqual(report.failures, [
    { operation: 'poster', message: 'Template asset is unavailable.' },
  ]);
  assert.deepEqual(calls, ['wallpaper', 'theme']);
});

test('built-in hubs synchronize only visibility and skip collection-only capabilities', async () => {
  const calls: string[] = [];
  const client = {
    async updateDiscoveredVisibility() {
      calls.push('visibility');
    },
  } as unknown as PlexManagementClient;
  const {
    posterSettings: _posterSettings,
    metadataSettings: _metadataSettings,
    titleSort: _titleSort,
    ...collectionFields
  } = baseItem();
  const item: PlexDiscoveredItem = {
    ...collectionFields,
    id: 'plex-hub:1:movie.recentlyadded',
    kind: 'default-hub',
    plexKey: 'movie.recentlyadded',
  };
  const report = await new PlexDiscoveredItemSynchronizer(
    client,
    assets
  ).synchronizeItem(item, true);

  assert.deepEqual(calls, ['visibility']);
  assert.deepEqual(report.applied, ['visibility']);
  assert.deepEqual(report.skipped, [
    'sort-title',
    'summary',
    'collection-mode',
    'poster',
    'wallpaper',
    'theme',
  ]);
});

test('orders each library independently and never advances the predecessor after a failed move', async () => {
  const calls: string[] = [];
  const client = {
    async moveHub(libraryId: string, identifier: string, predecessor?: string) {
      calls.push(`${libraryId}:${identifier}:after=${predecessor ?? 'first'}`);
      if (identifier.endsWith('.200')) throw new Error('move failed');
    },
  } as unknown as PlexManagementClient;
  const synchronizer = new PlexDiscoveredItemSynchronizer(client, assets);
  const reports = await synchronizer.synchronizeHomeOrder([
    baseItem({
      id: 'third',
      plexKey: '300',
      homeOrder: 3,
    }),
    baseItem({
      id: 'first',
      plexKey: '100',
      homeOrder: 1,
    }),
    baseItem({
      id: 'second-fails',
      plexKey: '200',
      homeOrder: 2,
    }),
    baseItem({
      id: 'other-library',
      libraryId: '2',
      libraryName: 'Movies 4K',
      plexKey: '400',
      homeOrder: 1,
    }),
    baseItem({
      id: 'missing',
      plexKey: '500',
      homeOrder: 4,
      missing: true,
    }),
  ]);

  assert.deepEqual(calls, [
    '1:custom.collection.1.100:after=first',
    '1:custom.collection.1.200:after=custom.collection.1.100',
    '1:custom.collection.1.300:after=custom.collection.1.100',
    '2:custom.collection.2.400:after=first',
  ]);
  assert.equal(reports.length, 4);
  assert.equal(reports[1]?.failures[0]?.operation, 'home-order');
});

test('propagates cancellation immediately instead of reporting an ordinary mutation failure', async () => {
  const controller = new AbortController();
  const client = {
    async updateDiscoveredVisibility() {
      controller.abort();
      throw new Error('cancelled');
    },
  } as unknown as PlexManagementClient;
  await assert.rejects(
    new PlexDiscoveredItemSynchronizer(client, assets).synchronizeItem(
      baseItem(),
      true,
      controller.signal
    ),
    /cancelled/
  );
});
