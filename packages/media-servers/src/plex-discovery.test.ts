import assert from 'node:assert/strict';
import test from 'node:test';

import type { PlexDiscoveredItem } from '@vynode/contracts';

import type { PlexLibrary } from './index.js';
import {
  PlexDiscoveryConflictError,
  PlexDiscoveryCoordinator,
  PlexDiscoveryScanner,
  type PlexDiscoveryStoreState,
  type PlexJsonTransport,
} from './plex-discovery.js';

const library = (
  key: string,
  title: string,
  type: PlexLibrary['type'] = 'movie'
): PlexLibrary => ({
  key,
  title,
  type,
  locations: [`/${title}`],
  available: true,
  observedAt: '2026-07-26T00:00:00.000Z',
});

test('discovers Plex hubs and pre-existing collections without taking over managed collections', async () => {
  const calls: string[] = [];
  const transport: PlexJsonTransport = {
    async query(path) {
      calls.push(path);
      if (path.endsWith('/collections')) {
        return {
          MediaContainer: {
            Metadata: [
              {
                ratingKey: '100',
                title: 'Oscar Favorites',
                titleSort: 'Awards Oscar',
              },
              { ratingKey: '200', title: 'Vynode Managed' },
            ],
          },
        };
      }
      return {
        MediaContainer: {
          Hub: [
            {
              identifier: 'movie.recentlyadded',
              title: 'Recently Added Movies',
              promotedToSharedHome: 1,
              promotedToOwnHome: '1',
              promotedToRecommended: true,
            },
            {
              identifier: 'custom.collection.1.100',
              title: 'Oscar Favorites',
              promotedToSharedHome: false,
              promotedToOwnHome: 0,
              promotedToRecommended: '1',
            },
          ],
        },
      };
    },
  };
  const scanner = new PlexDiscoveryScanner(transport);
  const result = await scanner.scan({
    libraries: [library('1', 'Movies'), library('music', 'Music', 'artist')],
    existing: [],
    managedCollectionKeys: new Set(['1:200']),
    now: '2026-07-26T12:00:00.000Z',
  });

  assert.deepEqual(calls, [
    '/library/sections/1/collections',
    '/hubs/sections/1/manage',
  ]);
  assert.equal(result.warnings.length, 0);
  assert.equal(result.observed.length, 2);
  const hub = result.observed.find((item) => item.kind === 'default-hub');
  assert.equal(hub?.plexKey, 'movie.recentlyadded');
  assert.equal(hub?.homeOrder, 1);
  assert.deepEqual(hub?.visibility, {
    usersHome: true,
    serverOwnerHome: true,
    libraryRecommended: true,
  });
  const collection = result.observed.find(
    (item) => item.kind === 'pre-existing-collection'
  );
  assert.equal(collection?.plexKey, '100');
  assert.equal(collection?.titleSort, 'Awards Oscar');
  assert.equal(collection?.homeOrder, 2);
  assert.deepEqual(collection?.visibility, {
    usersHome: false,
    serverOwnerHome: false,
    libraryRecommended: true,
  });
});

test('preserves Vynode-managed state while refreshing Plex identity and validation time', async () => {
  const previous: PlexDiscoveredItem = {
    id: 'plex-collection:1:100',
    kind: 'pre-existing-collection',
    plexKey: '100',
    name: 'Old Plex title',
    libraryId: '1',
    libraryName: 'Movies',
    mediaType: 'movie',
    titleSort: 'Custom Sort',
    homeOrder: 7,
    libraryOrder: 9,
    visibility: {
      usersHome: true,
      serverOwnerHome: false,
      libraryRecommended: true,
    },
    missing: false,
    isLinked: true,
    isUnlinked: false,
    linkGroupId: 'group-1',
    lastValidatedAt: '2026-07-25T00:00:00.000Z',
    timeRestriction: {
      alwaysActive: false,
      removeFromPlexWhenInactive: false,
      inactiveVisibility: {
        usersHome: false,
        serverOwnerHome: false,
        libraryRecommended: false,
      },
      dateRanges: [{ startDate: '15-12', endDate: '05-01' }],
      weeklySchedule: {
        monday: true,
        tuesday: true,
        wednesday: true,
        thursday: true,
        friday: true,
        saturday: true,
        sunday: false,
      },
    },
  };
  const scanner = new PlexDiscoveryScanner({
    async query(path) {
      return path.endsWith('/collections')
        ? {
            MediaContainer: {
              Metadata: [{ ratingKey: '100', title: 'Current Plex title' }],
            },
          }
        : { MediaContainer: { Hub: [] } };
    },
  });
  const result = await scanner.scan({
    libraries: [library('1', 'Renamed Movies')],
    existing: [previous],
    managedCollectionKeys: new Set(),
    now: '2026-07-26T12:00:00.000Z',
  });
  const refreshed = result.observed[0];
  assert.ok(refreshed);

  assert.equal(refreshed.name, 'Current Plex title');
  assert.equal(refreshed.libraryName, 'Renamed Movies');
  assert.equal(refreshed.lastValidatedAt, '2026-07-26T12:00:00.000Z');
  assert.equal(refreshed.homeOrder, 7);
  assert.equal(refreshed.libraryOrder, 9);
  assert.equal(refreshed.titleSort, 'Custom Sort');
  assert.equal(refreshed.isLinked, true);
  assert.equal(refreshed.linkGroupId, 'group-1');
  assert.deepEqual(refreshed.timeRestriction.dateRanges, [
    { startDate: '15-12', endDate: '05-01' },
  ]);
});

test('returns partial results and library-specific warnings when a Plex endpoint fails', async () => {
  const scanner = new PlexDiscoveryScanner({
    async query(path) {
      if (path.includes('/hubs/')) throw new Error('Plex returned 503');
      return {
        MediaContainer: {
          Metadata: { ratingKey: '300', title: 'Local Collection' },
        },
      };
    },
  });
  const result = await scanner.scan({
    libraries: [library('1', 'Movies')],
    existing: [],
    managedCollectionKeys: new Set(),
    now: '2026-07-26T12:00:00.000Z',
  });

  assert.equal(result.observed.length, 1);
  assert.equal(result.observed[0]?.name, 'Local Collection');
  assert.deepEqual(result.warnings, [
    'Movies: Plex hub management could not be read (Plex returned 503).',
  ]);
});

test('marks items missing only when their authoritative Plex endpoint completed', async () => {
  const existing = (id: string, libraryId: string): PlexDiscoveredItem => ({
    id,
    kind: 'pre-existing-collection',
    plexKey: id,
    name: id,
    libraryId,
    libraryName: libraryId === '1' ? 'Movies' : 'Movies 4K',
    mediaType: 'movie',
    homeOrder: 0,
    libraryOrder: 0,
    visibility: {
      usersHome: false,
      serverOwnerHome: false,
      libraryRecommended: false,
    },
    missing: false,
    isLinked: false,
    isUnlinked: false,
    lastValidatedAt: '2026-07-25T00:00:00.000Z',
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
  });
  let state: PlexDiscoveryStoreState = {
    revision: 4,
    items: [
      existing('missing-after-success', '1'),
      existing('preserved-after-failure', '2'),
    ],
    warnings: [],
  };
  const coordinator = new PlexDiscoveryCoordinator({
    scanner: new PlexDiscoveryScanner({
      async query(path) {
        if (path.includes('/sections/2/collections')) {
          throw new Error('library offline');
        }
        return path.includes('/collections')
          ? { MediaContainer: { Metadata: [] } }
          : { MediaContainer: { Hub: [] } };
      },
    }),
    repository: {
      async get() {
        return state;
      },
      async compareAndSet(expectedRevision, next) {
        if (state.revision !== expectedRevision) return false;
        state = next;
        return true;
      },
    },
    libraries: async () => [library('1', 'Movies'), library('2', 'Movies 4K')],
    managedCollectionKeys: async () => new Set(),
    now: () => '2026-07-26T12:00:00.000Z',
  });

  const result = await coordinator.scan();
  assert.deepEqual(result.missingIds, ['missing-after-success']);
  assert.equal(state.revision, 5);
  assert.equal(
    state.items.find((item) => item.id === 'missing-after-success')?.missing,
    true
  );
  const preserved = state.items.find(
    (item) => item.id === 'preserved-after-failure'
  );
  assert.equal(preserved?.missing, false);
  assert.equal(preserved?.lastValidatedAt, '2026-07-25T00:00:00.000Z');
  assert.match(result.warnings?.[0] ?? '', /Movies 4K.*library offline/);
});

test('rejects concurrent scans and repository conflicts without overwriting state', async () => {
  let release: (() => void) | undefined;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  const coordinator = new PlexDiscoveryCoordinator({
    scanner: new PlexDiscoveryScanner({
      async query() {
        await wait;
        return { MediaContainer: {} };
      },
    }),
    repository: {
      async get() {
        return { revision: 1, items: [], warnings: [] };
      },
      async compareAndSet() {
        return false;
      },
    },
    libraries: async () => [library('1', 'Movies')],
    managedCollectionKeys: async () => new Set(),
    now: () => '2026-07-26T12:00:00.000Z',
  });
  const first = coordinator.scan();
  await assert.rejects(
    () => coordinator.scan(),
    (error: unknown) => error instanceof PlexDiscoveryConflictError
  );
  release?.();
  await assert.rejects(
    () => first,
    (error: unknown) =>
      error instanceof PlexDiscoveryConflictError &&
      /changed during the scan/.test(error.message)
  );
});
