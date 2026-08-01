import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MaintainerrClient,
  type MaintainerrHttpTransport,
} from './maintainerr.js';

test('probes the exact Maintainerr readiness endpoint without requiring a key', async () => {
  const calls: Parameters<MaintainerrHttpTransport['request']>[0][] = [];
  const client = new MaintainerrClient({
    hostname: 'maintainerr.local',
    port: 6246,
    useSsl: false,
    urlBase: '/maintainerr/',
    transport: {
      async request(input) {
        calls.push(input);
        return {
          status: 200,
          body: { status: 'ok', database: 'ok', uptimeSeconds: 10 },
        };
      },
    },
  });
  await client.test();
  assert.equal(
    calls[0]?.url,
    'http://maintainerr.local:6246/maintainerr/api/health/ready'
  );
  assert.deepEqual(calls[0]?.headers, { Accept: 'application/json' });
});

test('supports a future API key header and reports readiness failures safely', async () => {
  const client = new MaintainerrClient({
    hostname: 'localhost',
    port: 6246,
    useSsl: true,
    urlBase: '',
    apiKey: 'secret',
    transport: {
      async request(input) {
        assert.equal(input.headers['X-Api-Key'], 'secret');
        return { status: 503, body: { apiKey: 'secret' } };
      },
    },
  });
  await assert.rejects(
    client.test(),
    (error) =>
      error instanceof Error &&
      error.message === 'Maintainerr is running but its database is not ready.' &&
      !error.message.includes('secret')
  );
});

test('reads and normalizes Maintainerr collections and overlay data', async () => {
  const client = new MaintainerrClient({
    hostname: 'maintainerr.local',
    port: 6246,
    useSsl: false,
    urlBase: '',
    now: () => new Date('2026-07-26T12:00:00.000Z'),
    transport: {
      async request({ url }) {
        if (url.endsWith('/api/collections'))
          return {
            status: 200,
            body: [
              {
                id: 7,
                title: 'Leaving Soon',
                mediaType: 'show',
                libraryId: 2,
                deleteAfterDays: 14,
                isActive: true,
              },
            ],
          };
        return {
          status: 200,
          body: [
            {
              id: 7,
              title: 'Leaving Soon',
              libraryId: 2,
              type: 'season',
              deleteAfterDays: 14,
              media: [
                {
                  id: 99,
                  mediaServerId: 123,
                  addDate: '2026-07-20T20:15:00.000Z',
                  mediaData: {
                    type: 'season',
                    parentTitle: 'Example Show',
                  },
                },
              ],
            },
          ],
        };
      },
    },
  });

  assert.deepEqual(await client.collections(), [
    {
      id: 7,
      title: 'Leaving Soon',
      mediaType: 'show',
      libraryId: '2',
      deleteAfterDays: 14,
      isActive: true,
    },
  ]);
  assert.deepEqual(await client.overlayData(), [
    {
      collectionId: 7,
      mediaId: '123',
      title: 'Example Show',
      libraryId: '2',
      mediaType: 'season',
      addedAt: '2026-07-20T20:15:00.000Z',
      deleteAt: '2026-08-03T20:15:00.000Z',
      daysRemaining: 9,
    },
  ]);
});

test('falls back to the legacy collections endpoint for overlay membership', async () => {
  const calls: string[] = [];
  const client = new MaintainerrClient({
    hostname: 'maintainerr.local',
    port: 6246,
    useSsl: false,
    urlBase: '',
    now: () => new Date('2026-07-27T12:00:00.000Z'),
    transport: {
      async request({ url }) {
        calls.push(url);
        if (url.endsWith('/overlay-data'))
          return { status: 404, body: { message: 'Not Found' } };
        return {
          status: 200,
          body: [
            {
              id: 4,
              title: 'Legacy',
              libraryId: '1',
              type: 'movie',
              deleteAfterDays: 30,
              media: [
                {
                  plexId: 614,
                  addDate: '2026-07-27T04:00:00.000Z',
                },
              ],
            },
          ],
        };
      },
    },
  });

  assert.equal((await client.overlayData())[0]?.mediaId, '614');
  assert.deepEqual(
    calls.map((url) => url.slice(url.indexOf('/api'))),
    ['/api/collections/overlay-data', '/api/collections']
  );
});

test('rejects malformed Maintainerr collection payloads', async () => {
  const client = new MaintainerrClient({
    hostname: 'maintainerr.local',
    port: 6246,
    useSsl: false,
    urlBase: '',
    transport: {
      async request() {
        return { status: 200, body: { unexpected: true } };
      },
    },
  });

  await assert.rejects(client.collections(), /invalid collections response/);
  await assert.rejects(client.overlayData(), /invalid overlay-data response/);
});
