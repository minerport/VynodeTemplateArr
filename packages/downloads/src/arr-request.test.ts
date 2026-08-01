import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ArrRequestClient,
  type ArrRequestTransport,
} from './arr-request.js';

const movie = {
  title: 'Batman Begins',
  year: 2005,
  tmdbId: 272,
  profileId: 4,
  rootFolder: '/movies',
  minimumAvailability: 'released' as const,
  tagIds: [2, 5],
  monitor: true,
  searchOnAdd: true,
  tagExistingItems: true,
};

const clientWith = (responses: unknown[]) => {
  const calls: Parameters<ArrRequestTransport['request']>[0][] = [];
  const transport: ArrRequestTransport = {
    async request(input) {
      calls.push(input);
      return { status: 200, body: responses.shift() };
    },
  };
  return {
    calls,
    client: new ArrRequestClient({
      hostname: 'radarr.local',
      port: 7878,
      useSsl: false,
      urlBase: '',
      apiKey: 'secret',
      transport,
    }),
  };
};

test('adds a looked-up Radarr movie with exact monitoring and search payload', async () => {
  const { client, calls } = clientWith([
    [{ title: 'Batman Begins', tmdbId: 272 }],
    { id: 12 },
  ]);
  const result = await client.addMovie(movie);
  assert.deepEqual(result, {
    id: 12,
    outcome: 'added',
    searched: true,
    tagsApplied: true,
  });
  assert.match(calls[0]!.url, /movie\/lookup\?term=tmdb%3A272$/);
  assert.deepEqual(calls[1]!.body, {
    title: 'Batman Begins',
    year: 2005,
    tmdbId: 272,
    titleSlug: '272',
    qualityProfileId: 4,
    rootFolderPath: '/movies',
    minimumAvailability: 'released',
    monitored: true,
    tags: [2, 5],
    addOptions: { searchForMovie: true },
  });
  assert.equal(calls[1]!.headers['X-Api-Key'], 'secret');
});

test('updates tags and searches an existing monitored Radarr movie', async () => {
  const { client, calls } = clientWith([[{ id: 41, monitored: true }], {}, {}]);
  const result = await client.addMovie(movie);
  assert.deepEqual(result, {
    id: 41,
    outcome: 'existing',
    searched: true,
    tagsApplied: true,
  });
  assert.deepEqual(calls[1]!.body, {
    movieIds: [41],
    tags: [2, 5],
    applyTags: 'add',
  });
  assert.deepEqual(calls[2]!.body, {
    name: 'MoviesSearch',
    movieIds: [41],
  });
});

test('respects an existing unmonitored item without mutating it', async () => {
  const { client, calls } = clientWith([[{ id: 41, monitored: false }]]);
  const result = await client.addMovie(movie);
  assert.equal(result.outcome, 'skipped-unmonitored');
  assert.equal(calls.length, 1);
});

test('reads download availability from exact Radarr and Sonarr item endpoints', async () => {
  const { client, calls } = clientWith([
    { id: 12, hasFile: true },
    { id: 24, statistics: { episodeFileCount: 0 } },
  ]);
  assert.equal(await client.itemStatus('radarr', 12), 'available');
  assert.equal(await client.itemStatus('sonarr', 24), 'processing');
  assert.match(calls[0]!.url, /\/movie\/12$/);
  assert.match(calls[1]!.url, /\/series\/24$/);
});

test('adds a Sonarr series using the selected monitor mode', async () => {
  const { client, calls } = clientWith([
    [{ title: 'Batman: The Animated Series', tvdbId: 76168 }],
    { id: 55 },
  ]);
  const result = await client.addSeries({
    title: 'Batman: The Animated Series',
    tvdbId: 76168,
    profileId: 3,
    rootFolder: '/tv',
    tagIds: [],
    monitorType: 'future',
    seriesType: 'standard',
    seasonFolders: true,
    searchOnAdd: false,
    tagExistingItems: false,
  });
  assert.equal(result.id, 55);
  assert.deepEqual(calls[1]!.body, {
    title: 'Batman: The Animated Series',
    tvdbId: 76168,
    qualityProfileId: 3,
    rootFolderPath: '/tv',
    tags: [],
    monitored: true,
    seasonFolder: true,
    seriesType: 'standard',
    addOptions: {
      monitor: 'future',
      searchForMissingEpisodes: false,
    },
  });
});

test('keeps credential failures safe', async () => {
  const transport: ArrRequestTransport = {
    async request() {
      return { status: 401, body: { apiKey: 'secret' } };
    },
  };
  const client = new ArrRequestClient({
    hostname: 'radarr.local',
    port: 7878,
    useSsl: false,
    urlBase: '',
    apiKey: 'secret',
    transport,
  });
  await assert.rejects(
    client.addMovie(movie),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'Arr rejected the API key.' &&
      !error.message.includes('secret')
  );
});
