import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AniListApiError,
  AniListClient,
  type AniListHttpTransport,
} from './anilist.js';
import type {
  MyAnimeListHttpTransport,
} from './myanimelist.js';

const mappingTransport: MyAnimeListHttpTransport = {
  async request() {
    return {
      status: 200,
      headers: {},
      body: {
        '101': {
          mal_id: [201],
          tmdb_movie_id: 301,
          imdb_id: 'tt1234567',
        },
        '102': {
          mal_id: 202,
          tmdb_show_id: 302,
          tvdb_id: 402,
        },
      },
    };
  },
};

const response = (
  body: unknown,
  status = 200,
  headers: Readonly<Record<string, string | undefined>> = {}
) => ({ status, headers, body });

test('normalizes AniList chart media and anime identities', async () => {
  const transport: AniListHttpTransport = {
    async request(input) {
      const variables = JSON.parse(input.body).variables;
      assert.deepEqual(variables.sort, ['POPULARITY_DESC']);
      return response({
        data: {
          Page: {
            pageInfo: { hasNextPage: false },
            media: [
              {
                id: 101,
                idMal: 201,
                title: { english: 'Anime Movie', romaji: 'Movie' },
                format: 'MOVIE',
                startDate: { year: 2026 },
                averageScore: 84,
                coverImage: { large: 'https://img/movie.jpg' },
              },
              {
                id: 102,
                title: { english: 'TV Anime' },
                format: 'TV',
              },
            ],
          },
        },
      });
    },
  };
  const client = new AniListClient({ transport, mappingTransport });
  const items = await client.source({
    subtype: 'popular',
    mediaType: 'movie',
    limit: 10,
  });
  assert.deepEqual(items, [
    {
      anilistId: 101,
      malId: 201,
      title: 'Anime Movie',
      rank: 1,
      mediaType: 'movie',
      tmdbIds: [301],
      imdbIds: ['tt1234567'],
      year: 2026,
      rating: 8.4,
      posterUrl: 'https://img/movie.jpg',
    },
  ]);
});

test('parses custom AniList user lists and rejects unrelated URLs', async () => {
  const transport: AniListHttpTransport = {
    async request(input) {
      const variables = JSON.parse(input.body).variables;
      assert.equal(variables.userName, 'Example User');
      return response({
        data: {
          Page: {
            pageInfo: { hasNextPage: false },
            mediaList: [
              {
                media: {
                  id: 102,
                  idMal: 202,
                  title: { romaji: 'TV Anime' },
                  format: 'TV',
                  startDate: { year: 2024 },
                  averageScore: 75,
                  coverImage: {},
                },
              },
            ],
          },
        },
      });
    },
  };
  const client = new AniListClient({ transport, mappingTransport });
  const items = await client.source({
    subtype: 'custom',
    mediaType: 'show',
    limit: 10,
    customUrl: 'https://anilist.co/user/Example%20User/animelist',
  });
  assert.equal(items[0]?.anilistId, 102);
  assert.deepEqual(items[0]?.tmdbIds, [302]);
  assert.equal(items[0]?.tvdbId, 402);
  await assert.rejects(
    () =>
      client.source({
        subtype: 'custom',
        mediaType: 'show',
        limit: 10,
        customUrl: 'https://example.com/user/name/animelist',
      }),
    /must use anilist\.co/
  );
});

test('retries bounded AniList failures and surfaces GraphQL errors', async () => {
  let attempts = 0;
  const transport: AniListHttpTransport = {
    async request() {
      attempts += 1;
      return attempts === 1
        ? response({}, 429, { 'retry-after': '1' })
        : response({
            errors: [{ message: 'User not found.' }],
          });
    },
  };
  const client = new AniListClient({
    transport,
    mappingTransport,
    wait: async () => {},
  });
  await assert.rejects(
    () =>
      client.source({
        subtype: 'trending',
        mediaType: 'show',
        limit: 1,
      }),
    (error: unknown) =>
      error instanceof AniListApiError &&
      error.status === 422 &&
      /User not found/.test(error.message)
  );
  assert.equal(attempts, 2);
});
