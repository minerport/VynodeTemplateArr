import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PlexWatchlistClient,
  PlexWatchlistSyncCoordinator,
  type PlexWatchlistFetch,
  type PlexWatchlistItem,
} from './plex-watchlist.js';

test('loads real Plex watchlist shapes and resolves provider identities', async () => {
  const requests: string[] = [];
  const fetcher: PlexWatchlistFetch = async (url, init) => {
    requests.push(url);
    assert.equal(init.headers['X-Plex-Token'], undefined);
    assert.equal(new URL(url).searchParams.get('X-Plex-Token'), 'secret');
    if (url.includes('/watchlist/all'))
      return response({
        MediaContainer: {
          Metadata: [
            { ratingKey: 'movie-key' },
            { ratingKey: 'show-key' },
            { ratingKey: 'unsupported-key' },
          ],
        },
      });
    if (url.includes('movie-key'))
      return response({
        MediaContainer: {
          Metadata: [
            {
              ratingKey: 'movie-key',
              type: 'movie',
              title: 'Movie',
              year: 2026,
              Guid: [{ id: 'tmdb://101' }, { id: 'imdb://tt1' }],
            },
          ],
        },
      });
    if (url.includes('show-key'))
      return response({
        MediaContainer: {
          Metadata: [
            {
              ratingKey: 'show-key',
              type: 'show',
              title: 'Show',
              year: 2025,
              Guid: [{ id: 'tmdb://202' }, { id: 'tvdb://303' }],
            },
          ],
        },
      });
    return response({
      MediaContainer: {
        Metadata: [{ ratingKey: 'unsupported-key', type: 'clip', title: 'Clip' }],
      },
    });
  };
  const items = await new PlexWatchlistClient('secret', fetcher).items();
  assert.deepEqual(items, [
    {
      key: 'movie:movie-key',
      mediaType: 'movie',
      title: 'Movie',
      year: 2026,
      tmdbId: 101,
    },
    {
      key: 'show:show-key',
      mediaType: 'show',
      title: 'Show',
      year: 2025,
      tmdbId: 202,
      tvdbId: 303,
    },
  ]);
  assert.equal(requests.length, 4);
});

test('paginates Plex watchlists using the provider maximum page size', async () => {
  const starts: string[] = [];
  const items = await new PlexWatchlistClient(
    'secret',
    async (url) => {
      const parsed = new URL(url);
      starts.push(parsed.searchParams.get('X-Plex-Container-Start') ?? '');
      assert.equal(parsed.searchParams.get('X-Plex-Container-Size'), '100');
      const start = parsed.searchParams.get('X-Plex-Container-Start');
      return response({
        MediaContainer: {
          totalSize: 101,
          Metadata:
            start === '0'
              ? Array.from({ length: 100 }, () => ({}))
              : [{}],
        },
      });
    }
  ).items();
  assert.deepEqual(items, []);
  assert.deepEqual(starts, ['0', '100']);
});

test('keeps Plex authorization failures credential-safe', async () => {
  await assert.rejects(
    new PlexWatchlistClient('do-not-leak', async () => ({
      ok: false,
      status: 401,
      async json() {
        return {};
      },
    })).items(),
    (error: Error) =>
      /rejected the account authorization/.test(error.message) &&
      !error.message.includes('do-not-leak')
  );
});

test('propagates cancellation before resolving item details', async () => {
  const controller = new AbortController();
  const fetcher: PlexWatchlistFetch = async (url) => {
    if (url.includes('/watchlist/all')) {
      controller.abort();
      return response({
        MediaContainer: { Metadata: [{ ratingKey: 'movie-key' }] },
      });
    }
    throw new Error('details should not run');
  };
  await assert.rejects(
    new PlexWatchlistClient('secret', fetcher).items(controller.signal),
    /abort/i
  );
});

test('sync coordinator reports disabled, added, existing, skipped, and isolated failures', async () => {
  const items: PlexWatchlistItem[] = [
    { key: '1', mediaType: 'movie', title: 'Added', year: 2026, tmdbId: 1 },
    { key: '2', mediaType: 'movie', title: 'Existing', year: 2026, tmdbId: 2 },
    { key: '3', mediaType: 'show', title: 'Skipped', tvdbId: 3 },
    { key: '4', mediaType: 'show', title: 'Failed', tvdbId: 4 },
  ];
  let sourceCalls = 0;
  const coordinator = new PlexWatchlistSyncCoordinator(
    {
      async items() {
        sourceCalls += 1;
        return items;
      },
    },
    {
      async route(item) {
        if (item.title === 'Added') return 'added';
        if (item.title === 'Existing') return 'existing';
        if (item.title === 'Skipped') return 'skipped';
        throw new Error('safe failure');
      },
    }
  );
  assert.equal((await coordinator.run(false)).disabled, true);
  assert.equal(sourceCalls, 0);
  assert.deepEqual(await coordinator.run(true), {
    scanned: 4,
    added: 1,
    existing: 1,
    skipped: 1,
    failed: 1,
    failures: ['Failed: safe failure'],
    disabled: false,
  });
});

test('sync coordinator propagates cancellation between routed items', async () => {
  const controller = new AbortController();
  let routes = 0;
  const coordinator = new PlexWatchlistSyncCoordinator(
    {
      async items() {
        return [
          { key: '1', mediaType: 'movie', title: 'One', year: 2026, tmdbId: 1 },
          { key: '2', mediaType: 'movie', title: 'Two', year: 2026, tmdbId: 2 },
        ];
      },
    },
    {
      async route() {
        routes += 1;
        controller.abort();
        return 'added';
      },
    }
  );
  await assert.rejects(coordinator.run(true, controller.signal), /abort/i);
  assert.equal(routes, 1);
});

const response = (body: unknown) => ({
  ok: true,
  status: 200,
  async json() {
    return body;
  },
});
