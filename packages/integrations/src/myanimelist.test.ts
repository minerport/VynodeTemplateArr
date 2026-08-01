import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AnimeIdentityMap,
  FetchMyAnimeListTransport,
  MyAnimeListApiError,
  MyAnimeListClient,
  type MyAnimeListHttpTransport,
} from './myanimelist.js';

const mapping = {
  100: {
    mal_id: [1, 2],
    tmdb_show_id: 20,
    tvdb_id: 30,
    imdb_id: ['tt0000001'],
  },
  200: { mal_id: 3, tmdb_movie_id: [40, 41] },
};

test('indexes PlexAniBridge identities by every MAL id', () => {
  const index = new AnimeIdentityMap(mapping);
  assert.deepEqual(index.get(2), {
    tmdbMovieIds: [],
    tmdbShowId: 20,
    tvdbId: 30,
    imdbIds: ['tt0000001'],
  });
  assert.deepEqual(index.get(3)?.tmdbMovieIds, [40, 41]);
});

test('parses JSON mappings served as plain text by GitHub raw', async () => {
  const transport = new FetchMyAnimeListTransport();
  const response = await transport.request({
    url: `data:text/plain,${encodeURIComponent(JSON.stringify(mapping))}`,
    headers: {},
  });
  assert.deepEqual(response.body, mapping);
});

test('fetches rankings with exact headers and filters MAL media types', async () => {
  const calls: Parameters<MyAnimeListHttpTransport['request']>[0][] = [];
  const client = new MyAnimeListClient({
    clientId: 'client',
    transport: {
      async request(input) {
        calls.push(input);
        if (input.url.includes('mappings.json'))
          return { status: 200, headers: {}, body: mapping };
        return {
          status: 200,
          headers: {},
          body: {
            data: [
              {
                node: {
                  id: 1,
                  title: 'Series',
                  media_type: 'tv',
                  start_date: '2025-01-01',
                  mean: 8.5,
                },
                ranking: { rank: 4 },
              },
              {
                node: { id: 3, title: 'Movie', media_type: 'movie' },
                ranking: { rank: 5 },
              },
              {
                node: { id: 4, title: 'Music', media_type: 'music' },
                ranking: { rank: 6 },
              },
            ],
          },
        };
      },
    },
  });
  const shows = await client.source({
    rankingType: 'all',
    mediaType: 'show',
    limit: 20,
  });
  assert.equal(shows.length, 1);
  assert.equal(shows[0]?.malId, 1);
  assert.deepEqual(shows[0]?.tmdbIds, [20]);
  assert.equal(shows[0]?.tvdbId, 30);
  assert.equal(calls[0]?.headers['X-MAL-Client-ID'], undefined);
  assert.equal(calls[1]?.headers['X-MAL-Client-ID'], 'client');
  assert.match(calls[1]?.url ?? '', /ranking_type=all/);
  assert.match(calls[1]?.url ?? '', /limit=500/);
});

test('retries rate limits and returns credential-safe errors', async () => {
  let calls = 0;
  const waits: number[] = [];
  const client = new MyAnimeListClient({
    clientId: 'secret-client',
    maxRetries: 2,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
    transport: {
      async request() {
        calls += 1;
        return calls === 1
          ? { status: 429, headers: { 'retry-after': '2' }, body: {} }
          : { status: 403, headers: {}, body: { client: 'secret-client' } };
      },
    },
  });
  await assert.rejects(
    client.test(),
    (error) =>
      error instanceof MyAnimeListApiError &&
      error.status === 403 &&
      !error.message.includes('secret-client')
  );
  assert.deepEqual(waits, [2000]);
});

test('continues pagination until enough media-compatible results are found', async () => {
  const rankingCalls: string[] = [];
  const client = new MyAnimeListClient({
    clientId: 'client',
    transport: {
      async request(input) {
        if (input.url.includes('mappings.json'))
          return { status: 200, headers: {}, body: mapping };
        rankingCalls.push(input.url);
        const offset = Number(new URL(input.url).searchParams.get('offset'));
        if (offset === 0)
          return {
            status: 200,
            headers: {},
            body: {
              data: Array.from({ length: 500 }, (_, index) => ({
                node: {
                  id: 10_000 + index,
                  title: `Series ${index}`,
                  media_type: 'tv',
                },
                ranking: { rank: index + 1 },
              })),
              paging: { next: 'page-two' },
            },
          };
        return {
          status: 200,
          headers: {},
          body: {
            data: [
              {
                node: { id: 3, title: 'Movie', media_type: 'movie' },
                ranking: { rank: 501 },
              },
            ],
            paging: {},
          },
        };
      },
    },
  });
  const movies = await client.source({
    rankingType: 'all',
    mediaType: 'movie',
    limit: 1,
  });
  assert.equal(rankingCalls.length, 2);
  assert.equal(movies[0]?.malId, 3);
});

test('rejects unsupported rankings and malformed ranking payloads', async () => {
  const client = new MyAnimeListClient({
    clientId: 'client',
    transport: {
      async request(input) {
        return input.url.includes('mappings.json')
          ? { status: 200, headers: {}, body: mapping }
          : { status: 200, headers: {}, body: { unexpected: [] } };
      },
    },
  });
  await assert.rejects(
    client.source({
      rankingType: 'invalid' as never,
      mediaType: 'show',
      limit: 1,
    }),
    /Unsupported MyAnimeList ranking/
  );
  await assert.rejects(
    client.source({ rankingType: 'all', mediaType: 'show', limit: 1 }),
    /invalid ranking response/
  );
});
