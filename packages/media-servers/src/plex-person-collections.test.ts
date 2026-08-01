import assert from 'node:assert/strict';
import test from 'node:test';
import { PlexPersonCollectionClient } from './plex-person-collections.js';

test('counts unique actors and directors across Plex library items', async () => {
  const client = new PlexPersonCollectionClient({
    machineIdentifier: 'machine',
    verifiedServerName: 'Laptop',
    allowedMutationServerNames: new Set(['Laptop']),
    transport: {
      async query() {
        return {
          MediaContainer: {
            Metadata: [
              { Role: [{ tag: 'Alice' }, { tag: 'Bob' }], Director: [{ tag: 'Dana' }] },
              { Role: [{ tag: 'alice' }, { tag: 'Alice' }], Director: [{ tag: 'Dana' }] },
            ],
          },
        };
      },
      async postJson() { return {}; },
      async delete() {},
    },
  });
  assert.deepEqual(await client.people('1', 'movie', 'actors'), [
    { name: 'Alice', count: 2 },
    { name: 'Bob', count: 1 },
  ]);
  assert.deepEqual(await client.people('1', 'movie', 'directors'), [
    { name: 'Dana', count: 2 },
  ]);
});

test('creates and verifies guarded Plex smart person collections', async () => {
  const calls: string[] = [];
  const client = new PlexPersonCollectionClient({
    machineIdentifier: 'machine',
    verifiedServerName: 'Laptop',
    allowedMutationServerNames: new Set(['Laptop']),
    transport: {
      async postJson(path) {
        calls.push(`POST ${path}`);
        return { MediaContainer: { Metadata: [{ ratingKey: '900' }] } };
      },
      async query(path) {
        calls.push(`GET ${path}`);
        return {
          MediaContainer: {
            Metadata: [{
              ratingKey: '900',
              smart: '1',
              librarySectionID: '2',
              content: 'server://machine/com.plexapp.plugins.library/library/sections/2/all?type=2&actor=Alice',
            }],
          },
        };
      },
      async delete(path) { calls.push(`DELETE ${path}`); },
    },
  });
  assert.equal(await client.createSmart({
    title: 'Alice',
    libraryId: '2',
    mediaType: 'show',
    kind: 'actors',
    personName: 'Alice',
    maxItems: 20,
  }), '900');
  assert.match(calls[0]!, /smart=1/);
  assert.match(decodeURIComponent(calls[0]!), /actor=Alice/);
  assert.equal(calls[1], 'GET /library/collections/900');
  await client.delete('900');
  assert.equal(calls[2], 'DELETE /library/collections/900');
});

test('blocks person collection mutations outside the allowed Plex server', async () => {
  const client = new PlexPersonCollectionClient({
    machineIdentifier: 'machine',
    verifiedServerName: 'Server',
    allowedMutationServerNames: new Set(['Laptop']),
    transport: {
      async postJson() { return {}; },
      async query() { return {}; },
      async delete() {},
    },
  });
  await assert.rejects(
    client.createSmart({
      title: 'Alice',
      libraryId: '1',
      mediaType: 'movie',
      kind: 'actors',
      personName: 'Alice',
    }),
    /blocked for server "Server"/
  );
});
