import assert from 'node:assert/strict';
import test from 'node:test';
import {
  TautulliClient,
  type TautulliHttpTransport,
} from './tautulli.js';

test('uses exact Tautulli commands and normalizes movie statistics', async () => {
  const calls: string[] = [];
  const transport: TautulliHttpTransport = {
    async request(input) {
      calls.push(input.url);
      return {
        status: 200,
        body: {
          response: {
            result: 'success',
            data: {
              stat_id: 'popular_movies',
              rows: [
                {
                  rating_key: '42',
                  title: 'Movie',
                  users_watched: '4',
                  total_plays: 7,
                  total_duration: 300,
                  year: 2020,
                },
                {
                  rating_key: '43',
                  title: 'Filtered',
                  users_watched: '1',
                  total_plays: 10,
                },
              ],
            },
          },
        },
      };
    },
  };
  const client = new TautulliClient({
    hostname: 'tautulli.local',
    port: 8181,
    useSsl: false,
    urlBase: '/tautulli',
    apiKey: 'secret',
    transport,
  });
  const items = await client.source({
    mediaType: 'movie',
    statType: 'plays',
    collectionType: 'most_popular',
    days: 30,
    minimumPlays: 3,
    limit: 20,
  });
  assert.equal(items.length, 2);
  assert.equal(items[0]?.ratingKey, '42');
  assert.equal(items[0]?.totalDurationSeconds, 300);
  const url = new URL(calls[0]!);
  assert.equal(url.pathname, '/tautulli/api/v2');
  assert.equal(url.searchParams.get('cmd'), 'get_home_stats');
  assert.equal(url.searchParams.get('stat_id'), 'popular_movies');
});

test('summarizes real activity commands without fabricating empty TV activity', async () => {
  const calls: string[] = [];
  const client = new TautulliClient({
    hostname: 'localhost',
    port: 8181,
    useSsl: false,
    urlBase: '',
    apiKey: 'secret',
    transport: {
      async request(input) {
        calls.push(input.url);
        const statId = new URL(input.url).searchParams.get('stat_id');
        return {
          status: 200,
          body: {
            response: {
              result: 'success',
              data: {
                stat_id: statId,
                rows:
                  statId === 'top_movies'
                    ? [{ rating_key: '1', title: 'Movie', total_plays: '3' }]
                    : [],
              },
            },
          },
        };
      },
    },
  });
  assert.deepEqual(await client.activitySummary(7), {
    totalPlays: 3,
    moviePlays: 3,
    showPlays: 0,
  });
  assert.deepEqual(
    calls.map((url) => new URL(url).searchParams.get('stat_id')),
    ['top_movies', 'top_tv']
  );
});

test('loads collection watch, viewer, and metadata statistics', async () => {
  const commands: string[] = [];
  const client = new TautulliClient({
    hostname: 'localhost',
    port: 8181,
    useSsl: false,
    urlBase: '',
    apiKey: 'secret',
    transport: {
      async request(input) {
        const command = new URL(input.url).searchParams.get('cmd')!;
        commands.push(command);
        const data =
          command === 'get_item_watch_time_stats'
            ? [{ query_days: 30, total_plays: 4, total_time: 240 }]
            : command === 'get_item_user_stats'
              ? [{ user_id: 1 }, { user_id: 2 }]
              : { title: 'Live collection', children_count: 9 };
        return {
          status: 200,
          body: { response: { result: 'success', data } },
        };
      },
    },
  });
  assert.deepEqual(
    await client.collectionStatistics(
      [{ ratingKey: '77', title: 'Fallback', mediaType: 'movie' }],
      30
    ),
    [
      {
        ratingKey: '77',
        title: 'Live collection',
        mediaType: 'movie',
        itemCount: 9,
        totalPlays: 4,
        totalDurationSeconds: 240,
        viewerCount: 2,
      },
    ]
  );
  assert.deepEqual(commands, [
    'get_item_watch_time_stats',
    'get_item_user_stats',
    'get_metadata',
  ]);
});

test('keeps healthy collection statistics when one Plex collection is stale', async () => {
  const client = new TautulliClient({
    hostname: 'localhost',
    port: 8181,
    useSsl: false,
    urlBase: '',
    apiKey: 'secret',
    transport: {
      async request(input) {
        const url = new URL(input.url);
        if (url.searchParams.get('rating_key') === 'missing')
          return {
            status: 200,
            body: {
              response: { result: 'error', message: 'Collection not found' },
            },
          };
        const command = url.searchParams.get('cmd');
        const data =
          command === 'get_item_watch_time_stats'
            ? [{ query_days: 7, total_plays: 2, total_time: 60 }]
            : command === 'get_item_user_stats'
              ? [{ user_id: 1 }]
              : { title: 'Healthy', children_count: 3 };
        return {
          status: 200,
          body: { response: { result: 'success', data } },
        };
      },
    },
  });
  const results = await client.collectionStatistics(
    [
      { ratingKey: 'healthy', title: 'Healthy', mediaType: 'movie' },
      { ratingKey: 'missing', title: 'Missing', mediaType: 'show' },
    ],
    7
  );
  assert.equal(results.length, 1);
  assert.equal(results[0]?.ratingKey, 'healthy');
});

test('rejects malformed home-stat payloads and invalid time ranges', async () => {
  const client = new TautulliClient({
    hostname: 'localhost',
    port: 8181,
    useSsl: false,
    urlBase: '',
    apiKey: 'secret',
    transport: {
      async request() {
        return {
          status: 200,
          body: { response: { result: 'success', data: {} } },
        };
      },
    },
  });
  await assert.rejects(
    client.activitySummary(0),
    /statistics days must be from 1 through 365/
  );
  await assert.rejects(
    client.source({
      mediaType: 'movie',
      statType: 'plays',
      collectionType: 'most_watched',
      days: 30,
      minimumPlays: 1,
      limit: 20,
    }),
    /returned no "top_movies" statistics payload/
  );
});

test('promotes TV rows to the show rating key and reports safe failures', async () => {
  const client = new TautulliClient({
    hostname: 'localhost',
    port: 8181,
    useSsl: false,
    urlBase: '',
    apiKey: 'secret',
    transport: {
      async request() {
        return { status: 403, body: { apiKey: 'secret' } };
      },
    },
  });
  await assert.rejects(
    client.test(),
    (error) => error instanceof Error && !error.message.includes('secret')
  );
});
