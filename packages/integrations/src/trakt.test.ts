import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTraktRandomListUrls,
  parseTraktListUrl,
  selectTraktRandomListUrl,
  ResilientTraktTransport,
  TraktApiError,
  TraktClient,
  type TraktHttpTransport,
} from './trakt.js';

const transport = (
  handler: TraktHttpTransport['request']
): TraktHttpTransport => ({ request: handler });

test('falls back to browser transport only for non-JSON Cloudflare blocks', async () => {
  const calls: string[] = [];
  const request = {
    method: 'GET' as const,
    path: '/movies/trending',
    headers: { accept: 'application/json' },
  };
  const browser = transport(async () => {
    calls.push('browser');
    return { status: 200, headers: { 'content-type': 'application/json' }, body: [] };
  });
  const blocked = transport(async () => {
    calls.push('direct');
    return { status: 403, headers: { 'content-type': 'text/html' }, body: 'blocked' };
  });
  assert.equal(
    (await new ResilientTraktTransport(blocked, browser).request(request)).status,
    200
  );
  assert.deepEqual(calls, ['direct', 'browser']);

  calls.length = 0;
  const rejected = transport(async () => {
    calls.push('direct');
    return {
      status: 403,
      headers: { 'content-type': 'application/json' },
      body: { error: 'forbidden' },
    };
  });
  assert.equal(
    (await new ResilientTraktTransport(rejected, browser).request(request)).status,
    403
  );
  assert.deepEqual(calls, ['direct']);
});

test('parses supported Trakt user and official list URLs without query leakage', () => {
  assert.deepEqual(
    parseTraktListUrl(
      'https://app.trakt.tv/users/a user/lists/best-movies?sort=rank'
    ),
    {
      path: '/users/a%20user/lists/best-movies/items',
      metadataPath: '/users/a%20user/lists/best-movies',
    }
  );
  assert.deepEqual(
    parseTraktListUrl('https://trakt.tv/lists/official/oscar-winners/'),
    {
      path: '/lists/official/oscar-winners/items',
      metadataPath: '/lists/official/oscar-winners',
    }
  );
  for (const invalid of [
    'http://trakt.tv/users/me/lists/test',
    'https://evil.test/users/me/lists/test',
    'https://trakt.tv/users/me',
  ])
    assert.throws(() => parseTraktListUrl(invalid), /Trakt/);
});

test('normalizes, deduplicates, and selects configured random Trakt lists', () => {
  const pool = normalizeTraktRandomListUrls([
    ' # ignored comment ',
    'https://app.trakt.tv/users/test/lists/movies?sort=rank',
    'https://trakt.tv/users/test/lists/movies/',
    'https://trakt.tv/lists/official/oscar-winners',
    '',
  ]);
  assert.deepEqual(pool, [
    'https://trakt.tv/users/test/lists/movies',
    'https://trakt.tv/lists/official/oscar-winners',
  ]);
  assert.equal(selectTraktRandomListUrl(pool, () => 0), pool[0]);
  assert.equal(selectTraktRandomListUrl(pool, () => 0.999), pool[1]);
  assert.throws(() => selectTraktRandomListUrl([], () => 0), /at least one/);
  assert.throws(
    () => normalizeTraktRandomListUrls(['https://example.com/list']),
    /Trakt/
  );
});

test('uses exact public chart headers and normalizes unique TMDB identities', async () => {
  const calls: Parameters<TraktHttpTransport['request']>[0][] = [];
  const client = new TraktClient({
    clientId: 'client',
    transport: transport(async (input) => {
      calls.push(input);
      return {
        status: 200,
        headers: {},
        body: [
          {
            watchers: 10,
            movie: {
              title: 'First',
              year: 2026,
              rating: 8.4,
              ids: { trakt: 1, tmdb: 101 },
            },
          },
          {
            movie: { title: 'Duplicate', ids: { trakt: 2, tmdb: 101 } },
          },
          { movie: { title: 'No TMDB', ids: { trakt: 3 } } },
        ],
      };
    }),
  });
  const items = await client.source({
    mediaType: 'movie',
    subtype: 'trending',
    limit: 20,
  });
  assert.equal(calls[0]?.path, '/movies/trending?limit=20&page=1');
  assert.equal(calls[0]?.headers['trakt-api-version'], '2');
  assert.equal(calls[0]?.headers['trakt-api-key'], 'client');
  assert.equal(calls[0]?.headers.Authorization, undefined);
  assert.deepEqual(items, [
    {
      mediaType: 'movie',
      title: 'First',
      year: 2026,
      tmdbId: 101,
      traktId: 1,
      rank: 0,
      rating: 8.4,
    },
  ]);
});

test('fetches anticipated Movies and TV from their exact Trakt endpoints', async () => {
  const paths: string[] = [];
  const client = new TraktClient({
    clientId: 'client',
    transport: transport(async (input) => {
      paths.push(input.path);
      return { status: 200, headers: {}, body: [] };
    }),
  });
  await client.source({
    mediaType: 'movie',
    subtype: 'anticipated',
    limit: 10,
  });
  await client.source({
    mediaType: 'show',
    subtype: 'anticipated',
    limit: 10,
  });
  assert.deepEqual(paths, [
    '/movies/anticipated?limit=10&page=1',
    '/shows/anticipated?limit=10&page=1',
  ]);
});

test('requires OAuth for account sources and sends bearer tokens only when available', async () => {
  const calls: Parameters<TraktHttpTransport['request']>[0][] = [];
  const missing = new TraktClient({
    clientId: 'client',
    transport: transport(async () => assert.fail('request must not run')),
  });
  await assert.rejects(
    missing.source({
      mediaType: 'show',
      subtype: 'watchlist',
      limit: 10,
    }),
    /Connect a Trakt account/
  );
  const connected = new TraktClient({
    clientId: 'client',
    accessToken: async () => 'access',
    transport: transport(async (input) => {
      calls.push(input);
      return { status: 200, headers: {}, body: [] };
    }),
  });
  await connected.source({
    mediaType: 'show',
    subtype: 'recommendations',
    limit: 10,
  });
  assert.equal(calls[0]?.headers.Authorization, 'Bearer access');
  assert.match(calls[0]?.path ?? '', /ignore_collected=false/);
});

test('uses OAuth opportunistically for private custom lists without requiring it for public lists', async () => {
  const authenticatedCalls: Parameters<
    TraktHttpTransport['request']
  >[0][] = [];
  await new TraktClient({
    clientId: 'client',
    accessToken: async () => 'access',
    transport: transport(async (input) => {
      authenticatedCalls.push(input);
      return { status: 200, headers: {}, body: [] };
    }),
  }).source({
    mediaType: 'movie',
    subtype: 'custom',
    customUrl: 'https://trakt.tv/users/test/lists/private-list',
    limit: 10,
  });
  assert.equal(authenticatedCalls[0]?.headers.Authorization, 'Bearer access');

  const publicCalls: Parameters<TraktHttpTransport['request']>[0][] = [];
  await new TraktClient({
    clientId: 'client',
    transport: transport(async (input) => {
      publicCalls.push(input);
      return { status: 200, headers: {}, body: [] };
    }),
  }).source({
    mediaType: 'movie',
    subtype: 'custom',
    customUrl: 'https://trakt.tv/users/test/lists/public-list',
    limit: 10,
  });
  assert.equal(publicCalls[0]?.headers.Authorization, undefined);
});

test('promotes custom-list episode and season entries to unique parent shows', async () => {
  const client = new TraktClient({
    clientId: 'client',
    transport: transport(async () => ({
      status: 200,
      headers: {},
      body: [
        {
          episode: {
            title: 'Pilot',
            show: {
              title: 'Series',
              year: 2025,
              ids: { tmdb: 200, tvdb: 300 },
            },
          },
        },
        {
          season: {
            number: 2,
            show: { title: 'Series', year: 2025, ids: { tmdb: 200 } },
          },
        },
      ],
    })),
  });
  const items = await client.source({
    mediaType: 'show',
    subtype: 'custom',
    customUrl: 'https://trakt.tv/users/test/lists/shows?sort=rank',
    limit: 20,
  });
  assert.equal(items.length, 1);
  assert.equal(items[0]?.title, 'Series');
  assert.equal(items[0]?.tmdbId, 200);
  assert.equal(items[0]?.tvdbId, 300);
});

test('honors Retry-After for 429 and retries 5xx with bounded backoff', async () => {
  let calls = 0;
  const waits: number[] = [];
  const client = new TraktClient({
    clientId: 'client',
    maxRetries: 3,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
    transport: transport(async () => {
      calls += 1;
      if (calls === 1)
        return { status: 429, headers: { 'retry-after': '2' }, body: {} };
      if (calls === 2) return { status: 503, headers: {}, body: {} };
      return { status: 200, headers: {}, body: [] };
    }),
  });
  await client.test();
  assert.equal(calls, 3);
  assert.deepEqual(waits, [2000, 1000]);
});

test('follows Trakt pagination headers, deduplicates pages, and stops at the configured limit', async () => {
  const paths: string[] = [];
  const client = new TraktClient({
    clientId: 'client',
    transport: transport(async (input) => {
      paths.push(input.path);
      const page = new URL(`https://api.test${input.path}`).searchParams.get(
        'page'
      );
      const start = page === '1' ? 1 : 101;
      return {
        status: 200,
        headers: { 'x-pagination-page-count': '2' },
        body: Array.from({ length: 100 }, (_, index) => ({
          movie: {
            title: `Movie ${start + index}`,
            ids: { tmdb: start + index },
          },
        })),
      };
    }),
  });
  const items = await client.source({
    mediaType: 'movie',
    subtype: 'popular',
    limit: 150,
  });
  assert.equal(items.length, 150);
  assert.equal(paths.length, 2);
  assert.match(paths[0] ?? '', /page=1/);
  assert.match(paths[1] ?? '', /page=2/);
  assert.equal(items[149]?.rank, 149);
});

test('surfaces final authorization failures without returning response secrets', async () => {
  const client = new TraktClient({
    clientId: 'client-secret-value',
    accessToken: async () => 'token-secret-value',
    maxRetries: 1,
    transport: transport(async () => ({
      status: 401,
      headers: {},
      body: { access_token: 'response-secret-value' },
    })),
  });
  await assert.rejects(
    client.source({
      mediaType: 'movie',
      subtype: 'watchlist',
      limit: 10,
    }),
    (error) =>
      error instanceof TraktApiError &&
      error.status === 401 &&
      !JSON.stringify(error).includes('secret-value')
  );
});
