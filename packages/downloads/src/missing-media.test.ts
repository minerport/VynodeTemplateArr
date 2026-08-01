import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DirectMissingMediaCoordinator,
  type MissingMediaCandidate,
} from './missing-media.js';
import type {
  AddRadarrMovieInput,
  AddSonarrSeriesInput,
} from './arr-request.js';
import type { ArrConfiguration } from './index.js';

const configurations: ArrConfiguration[] = [
  {
    id: 'movies',
    revision: 1,
    endpoint: {
      kind: 'radarr',
      name: 'Movies',
      hostname: 'radarr',
      port: 7878,
      useSsl: false,
      urlBase: '',
    },
    secretReference: 'movie-secret',
    selection: {
      kind: 'radarr',
      profileId: 1,
      rootFolder: '/movies',
      tagIds: [],
      isDefault: true,
      is4k: false,
      automaticTagMode: 'off',
      monitorByDefault: true,
      searchOnAdd: true,
      tagExistingItems: false,
      minimumAvailability: 'released',
    },
    verifiedAt: '2026-01-01T00:00:00.000Z',
  },
  {
    id: 'shows',
    revision: 1,
    endpoint: {
      kind: 'sonarr',
      name: 'Shows',
      hostname: 'sonarr',
      port: 8989,
      useSsl: false,
      urlBase: '',
    },
    secretReference: 'show-secret',
    selection: {
      kind: 'sonarr',
      profileId: 2,
      rootFolder: '/tv',
      tagIds: [],
      isDefault: true,
      is4k: false,
      automaticTagMode: 'off',
      monitorByDefault: true,
      searchOnAdd: true,
      tagExistingItems: false,
      seriesType: 'standard',
      seasonFolders: true,
      monitorType: 'all',
    },
    verifiedAt: '2026-01-01T00:00:00.000Z',
  },
];

const destinations = {
  radarr: {
    tagIds: [],
    monitor: true,
    monitorType: 'all' as const,
    searchOnAdd: false,
  },
  sonarr: {
    tagIds: [],
    monitor: true,
    monitorType: 'future' as const,
    searchOnAdd: false,
  },
};

test('routes ordered movie and show candidates and summarizes outcomes', async () => {
  const inputs: unknown[] = [];
  const coordinator = new DirectMissingMediaCoordinator({
    async configurations(kind) {
      return configurations.filter((entry) => entry.endpoint.kind === kind);
    },
    async client(configuration) {
      return {
        async addMovie(input: AddRadarrMovieInput) {
          inputs.push(input);
          return {
            id: 10,
            outcome: 'added' as const,
            searched: false,
            tagsApplied: false,
          };
        },
        async addSeries(input: AddSonarrSeriesInput) {
          inputs.push(input);
          return {
            id: 20,
            outcome: 'existing' as const,
            searched: false,
            tagsApplied: false,
          };
        },
      } as never;
    },
  });
  const candidates: MissingMediaCandidate[] = [
    {
      key: 'movie:272',
      mediaType: 'movie',
      title: 'Batman Begins',
      year: 2005,
      tmdbId: 272,
    },
    {
      key: 'show:76168',
      mediaType: 'show',
      title: 'Batman: The Animated Series',
      tvdbId: 76168,
    },
  ];
  const report = await coordinator.execute(candidates, destinations);
  assert.deepEqual(
    report.executions.map((item) => item.outcome),
    ['added', 'existing']
  );
  assert.deepEqual(
    { added: report.added, existing: report.existing, failed: report.failed },
    { added: 1, existing: 1, failed: 0 }
  );
  assert.equal((inputs[0] as { rootFolder: string }).rootFolder, '/movies');
  assert.equal(
    (inputs[1] as { monitorType: string }).monitorType,
    'future'
  );
});

test('isolates failures and identifies candidates missing provider IDs', async () => {
  const coordinator = new DirectMissingMediaCoordinator({
    async configurations(kind) {
      return configurations.filter((entry) => entry.endpoint.kind === kind);
    },
    async client() {
      return {
        async addMovie() {
          throw new Error('Radarr lookup failed.');
        },
      } as never;
    },
  });
  const report = await coordinator.execute(
    [
      {
        key: 'movie:1',
        mediaType: 'movie',
        title: 'Failure',
        tmdbId: 1,
      },
      { key: 'show:no-tvdb', mediaType: 'show', title: 'Unknown Show' },
    ],
    destinations
  );
  assert.deepEqual(
    report.executions.map((item) => item.outcome),
    ['failed', 'skipped-missing-provider-id']
  );
  assert.equal(report.failed, 1);
  assert.equal(report.skipped, 1);
});

test('propagates cancellation before the next item', async () => {
  const controller = new AbortController();
  const coordinator = new DirectMissingMediaCoordinator({
    async configurations(kind) {
      return configurations.filter((entry) => entry.endpoint.kind === kind);
    },
    async client() {
      return {
        async addMovie() {
          controller.abort();
          return {
            id: 1,
            outcome: 'added' as const,
            searched: false,
            tagsApplied: false,
          };
        },
      } as never;
    },
  });
  await assert.rejects(
    coordinator.execute(
      [
        { key: 'movie:1', mediaType: 'movie', title: 'One', tmdbId: 1 },
        { key: 'movie:2', mediaType: 'movie', title: 'Two', tmdbId: 2 },
      ],
      destinations,
      controller.signal
    ),
    (error: unknown) =>
      error instanceof DOMException && error.name === 'AbortError'
  );
});
