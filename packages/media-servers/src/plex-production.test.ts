import assert from 'node:assert/strict';
import test from 'node:test';

import type { CollectionBehaviorSettings } from '@vynode/contracts';

import {
  ProductionPlexServices,
  plexItemIsActive,
  plexSynchronizationFingerprint,
} from './plex-production.js';

const restriction = (
  overrides: Partial<
    CollectionBehaviorSettings['timeRestriction']
  > = {}
): CollectionBehaviorSettings['timeRestriction'] => ({
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
  ...overrides,
});

test('evaluates weekday, normal date range, and year-wrapping date range activation', () => {
  const monday = new Date(2026, 6, 27, 12);
  assert.equal(
    plexItemIsActive(
      restriction({
        weeklySchedule: {
          ...restriction().weeklySchedule,
          monday: false,
        },
      }),
      monday
    ),
    false
  );
  assert.equal(
    plexItemIsActive(
      restriction({
        dateRanges: [{ startDate: '01-07', endDate: '31-07' }],
      }),
      monday
    ),
    true
  );
  assert.equal(
    plexItemIsActive(
      restriction({
        dateRanges: [{ startDate: '15-12', endDate: '05-01' }],
      }),
      new Date(2026, 11, 25, 12)
    ),
    true
  );
  assert.equal(
    plexItemIsActive(
      restriction({
        dateRanges: [{ startDate: '15-12', endDate: '05-01' }],
      }),
      monday
    ),
    false
  );
});

test('requires a verified Plex configuration before discovery or synchronization', async () => {
  const services = new ProductionPlexServices({
    async configuration() {
      return undefined;
    },
    async token() {
      return 'unused';
    },
    async managedCollectionKeys() {
      return new Set();
    },
    repository: {
      async get() {
        return { revision: 0, items: [], warnings: [] };
      },
      async compareAndSet() {
        return false;
      },
    },
    assets: {
      async resolveAsset() {
        return new Uint8Array();
      },
      async renderPoster() {
        return undefined;
      },
    },
    clientIdentifier: 'vynode-test',
  });

  await assert.rejects(
    services.discover(),
    /Connect and verify Plex before using Plex discovery/
  );
  await assert.rejects(
    services.synchronize(),
    /Connect and verify Plex before using Plex discovery/
  );
});

test('blocks synchronization before any read or mutation when the verified server is not allowlisted', async () => {
  let repositoryReads = 0;
  const services = new ProductionPlexServices({
    async configuration() {
      return {
        revision: 1,
        host: '127.0.0.1',
        port: 32400,
        transport: 'http',
        autoEmptyTrash: false,
        machineIdentifier: 'protected-server',
        name: 'Server',
        libraries: [],
        verifiedAt: '2026-07-26T00:00:00.000Z',
      };
    },
    async token() {
      throw new Error('token must not be read');
    },
    async managedCollectionKeys() {
      return new Set();
    },
    repository: {
      async get() {
        repositoryReads += 1;
        return { revision: 0, items: [], warnings: [] };
      },
      async compareAndSet() {
        return false;
      },
    },
    assets: {
      async resolveAsset() {
        return new Uint8Array();
      },
      async renderPoster() {
        return undefined;
      },
    },
    clientIdentifier: 'vynode-test',
    allowedMutationServerNames: new Set(['Laptop']),
  });

  await assert.rejects(
    services.synchronize(),
    /blocked for server "Server".*Laptop/
  );
  assert.equal(repositoryReads, 0);
});

test('deduplication ignores scan timestamps but reacts to Plex-affecting settings', () => {
  const item = {
    id: 'hub-1',
    kind: 'default-hub' as const,
    plexKey: 'movie.recentlyadded',
    name: 'Recently Added',
    libraryId: '1',
    libraryName: 'Movies',
    mediaType: 'movie' as const,
    homeOrder: 1,
    libraryOrder: 1,
    visibility: {
      usersHome: true,
      serverOwnerHome: false,
      libraryRecommended: true,
    },
    missing: false,
    isLinked: false,
    isUnlinked: false,
    lastValidatedAt: '2026-07-26T00:00:00.000Z',
    timeRestriction: restriction({ alwaysActive: true }),
  };
  const first = plexSynchronizationFingerprint(item, true);
  assert.equal(
    first,
    plexSynchronizationFingerprint(
      { ...item, lastValidatedAt: '2026-07-27T00:00:00.000Z' },
      true
    )
  );
  assert.notEqual(first, plexSynchronizationFingerprint(item, false));
  assert.notEqual(
    first,
    plexSynchronizationFingerprint(
      {
        ...item,
        visibility: { ...item.visibility, serverOwnerHome: true },
      },
      true
    )
  );
});
