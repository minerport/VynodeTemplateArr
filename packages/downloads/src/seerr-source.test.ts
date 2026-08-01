import assert from 'node:assert/strict';
import test from 'node:test';
import type { SeerrConfiguration } from './index.js';
import { HttpSeerrCollectionSourceClient } from './seerr-source.js';

const configuration: SeerrConfiguration = {
  revision: 1,
  endpoint: {
    hostname: 'seerr.local',
    port: 5055,
    useSsl: false,
    urlBase: '',
  },
  secretReference: 'secret',
  secretConfigured: true,
  radarr: { tagIds: [] },
  sonarr: { tagIds: [] },
  userCreationMode: 'single',
  verifiedAt: '2026-07-30T00:00:00.000Z',
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

test('loads and hydrates global movie requests while excluding declined requests', async () => {
  const urls: string[] = [];
  const client = new HttpSeerrCollectionSourceClient(
    () => 'api-key',
    async (input) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith('/api/v1/auth/me')) return json({ id: 7 });
      if (url.includes('/api/v1/request?'))
        return json({
          pageInfo: { results: 2 },
          results: [
            {
              id: 10,
              status: 2,
              createdAt: '2026-07-01T00:00:00.000Z',
              requestedBy: { id: 7, displayName: 'Owner' },
              media: { mediaType: 'movie', tmdbId: 693134, status: 3 },
            },
            {
              id: 11,
              status: 3,
              requestedBy: { id: 8, displayName: 'User' },
              media: { mediaType: 'movie', tmdbId: 12, status: 1 },
            },
          ],
        });
      if (url.endsWith('/api/v1/movie/693134'))
        return json({ title: 'Dune: Part Two', releaseDate: '2024-02-27' });
      return json({}, 404);
    }
  );
  const items = await client.source(configuration, {
    mediaType: 'movie',
    subtype: 'global',
    limit: 50,
  });
  assert.deepEqual(items, [
    {
      requestId: 10,
      mediaType: 'movie',
      title: 'Dune: Part Two',
      year: 2024,
      tmdbId: 693134,
      requestedBy: { id: 7, displayName: 'Owner', owner: true },
      requestStatus: 'approved',
      mediaStatus: 'processing',
      createdAt: '2026-07-01T00:00:00.000Z',
    },
  ]);
  assert.ok(urls[1]?.includes('mediaType=movie'));
});

test('filters owner and non-owner requests and hydrates TV identities', async () => {
  const request = async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith('/api/v1/auth/me')) return json({ id: 1 });
    if (url.includes('/api/v1/request?'))
      return json({
        pageInfo: { results: 2 },
        results: [
          {
            id: 20,
            status: 1,
            requestedBy: { id: 1, plexUsername: 'owner' },
            media: { mediaType: 'tv', tmdbId: 100, tvdbId: 200, status: 2 },
          },
          {
            id: 21,
            status: 2,
            requestedBy: { id: 2, email: 'user@example.com' },
            media: { mediaType: 'tv', tmdbId: 101, tvdbId: 201, status: 5 },
          },
        ],
      });
    if (url.endsWith('/api/v1/tv/100'))
      return json({ name: 'Owner Show', firstAirDate: '2020-01-01' });
    if (url.endsWith('/api/v1/tv/101'))
      return json({ name: 'User Show', firstAirDate: '2021-01-01' });
    return json({}, 404);
  };
  const client = new HttpSeerrCollectionSourceClient(() => 'key', request);
  const owner = await client.source(configuration, {
    mediaType: 'show',
    subtype: 'server_owner',
    limit: 10,
  });
  const users = await client.source(configuration, {
    mediaType: 'show',
    subtype: 'users',
    limit: 10,
  });
  assert.equal(owner[0]?.title, 'Owner Show');
  assert.equal(owner[0]?.requestedBy.owner, true);
  assert.equal(users[0]?.title, 'User Show');
  assert.equal(users[0]?.requestedBy.owner, false);
  assert.equal(users[0]?.mediaStatus, 'available');
  const privateUser = await client.source(configuration, {
    mediaType: 'show',
    subtype: 'user',
    requesterId: 2,
    limit: 10,
  });
  assert.deepEqual(privateUser.map((item) => item.requestedBy.id), [2]);
});

test('private-user sources require a positive immutable requester id', async () => {
  const client = new HttpSeerrCollectionSourceClient(() => 'key');
  await assert.rejects(() => client.source(configuration, {
    mediaType: 'movie', subtype: 'user', limit: 10,
  }), /valid Seerr user/);
});

test('deduplicates the same requested title and enforces the source limit', async () => {
  const client = new HttpSeerrCollectionSourceClient(
    () => 'key',
    async (input) => {
      const url = String(input);
      if (url.endsWith('/api/v1/auth/me')) return json({ id: 1 });
      if (url.includes('/api/v1/request?'))
        return json({
          pageInfo: { results: 3 },
          results: [
            {
              id: 1,
              status: 2,
              requestedBy: { id: 1, displayName: 'Owner' },
              media: { mediaType: 'movie', tmdbId: 10 },
            },
            {
              id: 2,
              status: 2,
              requestedBy: { id: 2, displayName: 'User' },
              media: { mediaType: 'movie', tmdbId: 10 },
            },
            {
              id: 3,
              status: 2,
              requestedBy: { id: 2, displayName: 'User' },
              media: { mediaType: 'movie', tmdbId: 11 },
            },
          ],
        });
      return json({ title: url.endsWith('/10') ? 'Ten' : 'Eleven' });
    }
  );
  const items = await client.source(configuration, {
    mediaType: 'movie',
    subtype: 'global',
    limit: 1,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.requestId, 2);
});

test('reports safe status-only errors and requires credentials', async () => {
  await assert.rejects(
    () =>
      new HttpSeerrCollectionSourceClient(() => undefined).source(
        configuration,
        { mediaType: 'movie', subtype: 'global', limit: 10 }
      ),
    /credentials are unavailable/
  );
  await assert.rejects(
    () =>
      new HttpSeerrCollectionSourceClient(
        () => 'secret',
        async () => json({ token: 'must-not-leak' }, 403)
      ).source(configuration, {
        mediaType: 'movie',
        subtype: 'global',
        limit: 10,
      }),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'Seerr owner lookup failed with status 403.'
  );
});
