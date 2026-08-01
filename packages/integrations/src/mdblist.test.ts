import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MDBListApiError,
  MDBListClient,
  parseMDBListUrl,
  type MDBListHttpTransport,
} from './mdblist.js';

test('accepts exact MDBList list URL forms and rejects unsafe URLs', () => {
  assert.deepEqual(parseMDBListUrl('https://mdblist.com/lists/123'), {
    kind: 'id',
    listId: 123,
  });
  assert.deepEqual(
    parseMDBListUrl('https://www.mdblist.com/lists/user/list-name?ignored=1'),
    { kind: 'named', username: 'user', slug: 'list-name' }
  );
  assert.deepEqual(
    parseMDBListUrl('https://mdblist.com/lists/external/456'),
    { kind: 'id', listId: 456 }
  );
  assert.throws(() => parseMDBListUrl('http://mdblist.com/lists/123'));
  assert.throws(() => parseMDBListUrl('https://evil.test/lists/123'));
});

test('paginates the selected media type and normalizes provider identities', async () => {
  const calls: Parameters<MDBListHttpTransport['request']>[0][] = [];
  const transport: MDBListHttpTransport = {
    async request(input) {
      calls.push(input);
      const offset = Number(new URL(input.url).searchParams.get('offset'));
      return {
        status: 200,
        headers: {},
        body: {
          movies:
            offset === 0
              ? Array.from({ length: 500 }, (_, index) => ({
                  id: index + 1,
                  title: `Movie ${index + 1}`,
                  rank: index + 1,
                  imdb_id: `tt${String(index + 1).padStart(7, '0')}`,
                  release_year: 2000,
                }))
              : [{ id: 501, title: 'Last movie', rank: 501 }],
          shows: [],
        },
      };
    },
  };
  const items = await new MDBListClient({
    apiKey: 'secret-key',
    transport,
  }).source(
    {
      listUrl: 'https://mdblist.com/lists/user/movies',
      mediaType: 'movie',
      limit: 600,
    }
  );
  assert.equal(items.length, 501);
  assert.equal(items[0]?.tmdbId, 1);
  assert.equal(items[0]?.imdbId, 'tt0000001');
  assert.equal(new URL(calls[0]!.url).pathname, '/lists/user/movies/items');
  assert.equal(new URL(calls[0]!.url).searchParams.get('limit'), '500');
  assert.equal(new URL(calls[1]!.url).searchParams.get('offset'), '500');
});

test('does not stop a mixed list while another media type fills the page', async () => {
  const offsets: number[] = [];
  const client = new MDBListClient({
    apiKey: 'secret-key',
    transport: {
      async request(input) {
        const offset = Number(new URL(input.url).searchParams.get('offset'));
        offsets.push(offset);
        return {
          status: 200,
          headers: {},
          body:
            offset === 0
              ? {
                  movies: [{ id: 1, title: 'First movie' }],
                  shows: Array.from({ length: 499 }, (_, index) => ({
                    id: index + 10,
                    title: `Show ${index + 1}`,
                  })),
                }
              : {
                  movies: [{ id: 2, title: 'Second movie' }],
                  shows: [],
                },
        };
      },
    },
  });

  const items = await client.source({
    listUrl: 'https://mdblist.com/lists/user/mixed',
    mediaType: 'movie',
    limit: 10,
  });

  assert.deepEqual(
    items.map((item) => item.tmdbId),
    [1, 2]
  );
  assert.deepEqual(offsets, [0, 500]);
});

test('inspects named lists for their saved title and actual content type', async () => {
  const calls: string[] = [];
  const client = new MDBListClient({
    apiKey: 'secret-key',
    transport: {
      async request(input) {
        const url = new URL(input.url);
        calls.push(url.pathname);
        return url.pathname === '/lists/user/owner'
          ? {
              status: 200,
              headers: {},
              body: [
                {
                  id: 41,
                  name: 'Awards Across Screens',
                  slug: 'awards',
                  description: 'Movies and shows recognized by major awards.',
                  items: 12,
                  private: true,
                  dynamic: false,
                },
              ],
            }
          : {
              status: 200,
              headers: {},
              body: {
                movies: [{ id: 1, title: 'Movie' }],
                shows: [{ id: 2, title: 'Show' }],
              },
            };
      },
    },
  });

  assert.deepEqual(
    await client.inspect('https://mdblist.com/lists/owner/awards?mode=media'),
    {
      title: 'Awards Across Screens',
      description: 'Movies and shows recognized by major awards.',
      contentType: 'mixed',
      itemCount: 12,
      private: true,
      dynamic: false,
    }
  );
  assert.deepEqual(calls, [
    '/lists/user/owner',
    '/lists/owner/awards/items',
  ]);
});

test('falls back to authenticated account lists for private named lists', async () => {
  const calls: string[] = [];
  const client = new MDBListClient({
    apiKey: 'secret-key',
    transport: {
      async request(input) {
        const path = new URL(input.url).pathname;
        calls.push(path);
        if (path === '/lists/user/owner')
          return { status: 200, headers: {}, body: [] };
        if (path === '/lists/user')
          return {
            status: 200,
            headers: {},
            body: [{
              id: 77,
              user_name: 'owner',
              name: 'Private Picks',
              slug: 'private-picks',
              mediatype: 'movie',
              items: 1,
              private: true,
              dynamic: false,
            }],
          };
        return {
          status: 200,
          headers: {},
          body: { movies: [{ id: 9, title: 'Private movie' }], shows: [] },
        };
      },
    },
  });

  assert.deepEqual(
    await client.inspect('https://mdblist.com/lists/owner/private-picks'),
    {
      title: 'Private Picks',
      contentType: 'movie',
      itemCount: 1,
      private: true,
      dynamic: false,
    }
  );
  assert.deepEqual(calls, [
    '/lists/user/owner',
    '/lists/user',
    '/lists/owner/private-picks/items',
  ]);
});

test('normalizes MDBList account limits and owned list metadata', async () => {
  const client = new MDBListClient({
    apiKey: 'secret-key',
    transport: {
      async request(input) {
        return new URL(input.url).pathname === '/user'
          ? {
              status: 200,
              headers: {},
              body: {
                user_id: 42,
                api_requests: 1000,
                api_requests_count: 12,
                patron_status: 'supporter',
              },
            }
          : {
              status: 200,
              headers: {},
              body: [{
                id: 77,
                user_name: 'owner',
                name: 'Private Picks',
                slug: 'private-picks',
                mediatype: 'movie',
                items: 0,
                private: true,
                dynamic: false,
              }],
            };
      },
    },
  });

  assert.deepEqual(await client.account(), {
    userId: 42,
    requestLimit: 1000,
    requestCount: 12,
    patronStatus: 'supporter',
  });
  assert.deepEqual(await client.accountLists(), [{
    id: 77,
    username: 'owner',
    title: 'Private Picks',
    slug: 'private-picks',
    contentType: 'movie',
    itemCount: 0,
    private: true,
    dynamic: false,
  }]);
});

test('retries rate limits and never includes the API key in errors', async () => {
  let calls = 0;
  const waits: number[] = [];
  const client = new MDBListClient({
    apiKey: 'secret-key',
    maxRetries: 2,
    wait: async (milliseconds) => {
      waits.push(milliseconds);
    },
    transport: {
      async request() {
        calls += 1;
        return calls === 1
          ? { status: 429, headers: { 'retry-after': '2' }, body: {} }
          : { status: 403, headers: {}, body: { key: 'secret-key' } };
      },
    },
  });
  await assert.rejects(
    client.test(),
    (error) =>
      error instanceof MDBListApiError &&
      error.status === 403 &&
      !error.message.includes('secret-key')
  );
  assert.deepEqual(waits, [2000]);
});
