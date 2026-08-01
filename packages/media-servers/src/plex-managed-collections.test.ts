import assert from 'node:assert/strict';
import test from 'node:test';

import {
  managedCollectionLabel,
  PlexManagedCollectionClient,
} from './plex-managed-collections.js';

const createHarness = (
  overrides: {
    serverName?: string;
    smart?: boolean;
    memberKeys?: readonly string[];
    bulkFailure?: boolean;
    individualFailure?: string;
  } = {}
) => {
  const calls: string[] = [];
  const transport = {
    async query(path: string) {
      calls.push(`GET ${path}`);
      if (path.endsWith('/children')) {
        return {
          MediaContainer: {
            Metadata: (overrides.memberKeys ?? []).map((ratingKey) => ({
              ratingKey,
            })),
          },
        };
      }
      if (path.startsWith('/library/collections/')) {
        return {
          MediaContainer: {
            Metadata: [
              {
                ratingKey: '900',
                title: 'Test',
                librarySectionID: '1',
                smart: overrides.smart ? '1' : '0',
              },
            ],
          },
        };
      }
      return {
        MediaContainer: {
          Metadata: [{ ratingKey: '900', title: 'Vynode Test' }],
        },
      };
    },
    async postJson(path: string) {
      calls.push(`POST ${path}`);
      return { MediaContainer: { Metadata: [{ ratingKey: '900' }] } };
    },
    async post(path: string) {
      calls.push(`POST ${path}`);
    },
    async put(path: string) {
      calls.push(`PUT ${path}`);
      const uri = new URL(path, 'http://plex').searchParams.get('uri') ?? '';
      if (
        overrides.bulkFailure &&
        uri.endsWith('/101,102')
      ) {
        throw new Error('bulk failed');
      }
      if (
        overrides.individualFailure &&
        uri.endsWith(`/${overrides.individualFailure}`)
      ) {
        throw new Error('individual failed');
      }
    },
    async delete(path: string) {
      calls.push(`DELETE ${path}`);
      if (
        overrides.individualFailure &&
        path.endsWith(`/${overrides.individualFailure}`)
      ) {
        throw new Error('individual failed');
      }
    },
  };
  return {
    calls,
    client: new PlexManagedCollectionClient({
      transport,
      machineIdentifier: 'laptop-machine',
      verifiedServerName: overrides.serverName ?? 'Laptop',
      allowedMutationServerNames: new Set(['Laptop']),
    }),
  };
};

test('creates and renames a regular collection with exact Plex parameters', async () => {
  const { client, calls } = createHarness();
  assert.equal(
    await client.create({
      title: 'Vynode Test',
      libraryId: '1',
      mediaType: 'movie',
    }),
    '900'
  );
  await client.rename('900', '1', 'Vynode Test Renamed');

  assert.deepEqual(calls, [
    'POST /library/collections?type=1&title=Vynode+Test&smart=0&sectionId=1',
    'PUT /library/sections/1/all?type=18&id=900&title.value=Vynode+Test+Renamed&title.locked=1',
  ]);
});

test('creates a regular season collection with the Plex season type', async () => {
  const { client, calls } = createHarness();
  assert.equal(
    await client.create({
      title: 'Favorite Seasons',
      libraryId: '2',
      mediaType: 'season',
    }),
    '900'
  );
  assert.deepEqual(calls, [
    'POST /library/collections?type=3&title=Favorite+Seasons&smart=0&sectionId=2',
  ]);
});

test('creates a regular episode collection with the Plex episode type', async () => {
  const { client, calls } = createHarness();
  assert.equal(
    await client.create({
      title: 'Favorite Episodes',
      libraryId: '2',
      mediaType: 'episode',
    }),
    '900'
  );
  assert.deepEqual(calls, [
    'POST /library/collections?type=4&title=Favorite+Episodes&smart=0&sectionId=2',
  ]);
});

test('updates managed collection hub visibility with the exact Plex identifier', async () => {
  const { client, calls } = createHarness();
  await client.updateHubVisibility('1', '900', {
    usersHome: false,
    serverOwnerHome: true,
    libraryRecommended: false,
  });
  assert.deepEqual(calls, [
    'PUT /hubs/sections/1/manage/custom.collection.1.900?promotedToRecommended=0&promotedToOwnHome=1&promotedToSharedHome=0',
  ]);
});

test('randomizes a managed Home hub and verifies the exact resulting position', async () => {
  const calls: string[] = [];
  let hubs = ['movie.recentlyadded', 'custom.collection.1.900', 'movie.toprated'];
  const transport = {
    async query(path: string) {
      calls.push(`GET ${path}`);
      return {
        MediaContainer: { Hub: hubs.map((identifier) => ({ identifier })) },
      };
    },
    async post(path: string) { calls.push(`POST ${path}`); },
    async postJson() { return {}; },
    async delete() {},
    async put(path: string) {
      calls.push(`PUT ${path}`);
      hubs = ['movie.recentlyadded', 'movie.toprated', 'custom.collection.1.900'];
    },
  };
  const client = new PlexManagedCollectionClient({
    transport,
    machineIdentifier: 'laptop-machine',
    verifiedServerName: 'Laptop',
    allowedMutationServerNames: new Set(['Laptop']),
  });
  assert.equal(await client.randomizeHubPosition('1', '900', 0.99), 3);
  assert.deepEqual(calls, [
    'GET /hubs/sections/1/manage',
    'PUT /hubs/sections/1/manage/custom.collection.1.900/move?after=movie.toprated',
    'GET /hubs/sections/1/manage',
  ]);
});

test('creates a verified unwatched smart collection from an isolated ownership label', async () => {
  const calls: string[] = [];
  const ownershipLabel = managedCollectionLabel('12345678-1234-1234-1234-123456789abc');
  const transport = {
    async query(path: string) {
      calls.push(`GET ${path}`);
      if (path.endsWith('/children'))
        return { MediaContainer: { Metadata: [{ ratingKey: '101' }] } };
      return { MediaContainer: { Metadata: [{ ratingKey: '901', title: 'Unwatched', librarySectionID: '1', smart: '1' }] } };
    },
    async post() {},
    async postJson(path: string) {
      calls.push(`POST ${path}`);
      return { MediaContainer: { Metadata: [{ ratingKey: '901' }] } };
    },
    async put() {},
    async delete() {},
  };
  const client = new PlexManagedCollectionClient({
    transport,
    machineIdentifier: 'machine',
    verifiedServerName: 'Laptop',
    allowedMutationServerNames: new Set(['Laptop']),
  });
  assert.equal(await client.createUnwatchedSmart({ title: 'Unwatched', libraryId: '1', mediaType: 'movie', ownershipLabel }), '901');
  const decoded = decodeURIComponent(decodeURIComponent(calls[0] ?? ''));
  assert.match(decoded, /smart=1/);
  assert.match(decoded, /label=Vynode\+Collection\+12345678-1234-1234-1234-123456789abc/);
  assert.match(decoded, /unwatched=1/);
});

test('managed labels preserve unrelated Plex labels and enumerate exact tagged members', async () => {
  const calls: string[] = [];
  const ownershipLabel = managedCollectionLabel('12345678-1234-1234-1234-123456789abc');
  const transport = {
    async query(path: string) {
      calls.push(`GET ${path}`);
      if (path.startsWith('/library/metadata/'))
        return { MediaContainer: { Metadata: [{ Label: [{ tag: 'Favorite' }] }] } };
      return { MediaContainer: { Metadata: [{ ratingKey: '101' }, { ratingKey: '102' }] } };
    },
    async post() {}, async postJson() { return {}; }, async delete() {},
    async put(path: string) { calls.push(`PUT ${path}`); },
  };
  const client = new PlexManagedCollectionClient({
    transport,
    machineIdentifier: 'machine',
    verifiedServerName: 'Laptop',
    allowedMutationServerNames: new Set(['Laptop']),
  });
  await client.setManagedLabel('101', ownershipLabel, true);
  assert.deepEqual(await client.membersWithManagedLabel('1', 'movie', ownershipLabel), ['101', '102']);
  const update = decodeURIComponent(calls.find((call) => call.startsWith('PUT ')) ?? '');
  assert.match(update, /label\[0\]\.tag\.tag=Favorite/);
  assert.match(update, /label\[1\]\.tag\.tag=Vynode\+Collection/);
});

test('adds members in bulk and falls back to isolated individual requests', async () => {
  const { client, calls } = createHarness({
    bulkFailure: true,
    individualFailure: '102',
  });
  const result = await client.addMembers('900', ['101', '102']);

  assert.deepEqual(result, { added: ['101'], failures: ['102'] });
  assert.match(calls[2] ?? '', /metadata%2F101%2C102/);
  assert.match(calls[3] ?? '', /metadata%2F101/);
  assert.match(calls[4] ?? '', /metadata%2F102/);
});

test('removes only current members and deletes the collection endpoint', async () => {
  const { client, calls } = createHarness({
    memberKeys: ['101', '102'],
    individualFailure: '102',
  });
  assert.deepEqual(
    await client.removeMembers('900', ['101', '102', '999']),
    { removed: ['101'], failures: ['102'] }
  );
  await client.delete('900');
  assert.ok(calls.includes('DELETE /library/collections/900/items/101'));
  assert.ok(calls.includes('DELETE /library/collections/900/items/102'));
  assert.equal(calls.at(-1), 'DELETE /library/collections/900');
});

test('blocks protected servers and smart-collection membership changes', async () => {
  const protectedHarness = createHarness({ serverName: 'Server' });
  await assert.rejects(
    protectedHarness.client.create({
      title: 'Blocked',
      libraryId: '1',
      mediaType: 'movie',
    }),
    /blocked for server "Server"/
  );
  assert.deepEqual(protectedHarness.calls, []);

  const smartHarness = createHarness({ smart: true });
  await assert.rejects(
    smartHarness.client.addMembers('900', ['101']),
    /Cannot modify members of smart Plex collection/
  );
  assert.equal(
    smartHarness.calls.some((call) => call.startsWith('PUT ')),
    false
  );
});
