import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PlexLibraryGeneratorClient,
  contentRatingGroup,
  selectGeneratorValues,
} from './plex-library-generators.js';

test('generator value selection honors include, exclude, and rating groups', () => {
  const values = [
    { value: '4k', label: '4K', count: 3 },
    { value: '1080p', label: '1080p', count: 5 },
    { value: 'tv-14', label: 'TV-14', count: 2, group: 'television' as const },
  ];
  assert.deepEqual(
    selectGeneratorValues(values, {
      selectionMode: 'include',
      selectedValues: ['4k'],
      enabledRatingGroups: [],
    }).map((value) => value.value),
    ['4k']
  );
  assert.deepEqual(
    selectGeneratorValues(values, {
      selectionMode: 'exclude',
      selectedValues: ['4k'],
      enabledRatingGroups: ['television'],
    }).map((value) => value.value),
    ['1080p', 'tv-14']
  );
});

const response = {
  MediaContainer: {
    Metadata: [
      {
        year: 1999,
        contentRating: 'TV-14',
        Genre: [{ tag: 'Drama' }, { tag: 'Crime' }],
        Media: [{ videoResolution: '1080' }],
      },
      {
        year: 1995,
        contentRating: 'TV-14',
        Genre: [{ tag: 'Drama' }],
        Media: [{ videoResolution: '4k' }],
      },
      {
        year: 2001,
        contentRating: '15',
        Genre: [{ tag: 'Comedy' }],
        Media: [{ videoResolution: '1080p' }],
      },
    ],
  },
};

const client = (requests: string[] = []) =>
  new PlexLibraryGeneratorClient({
    machineIdentifier: 'machine',
    verifiedServerName: 'Laptop',
    allowedMutationServerNames: new Set(['Laptop']),
    transport: {
      async query(path) {
        requests.push(`GET ${path}`);
        return response;
      },
      async postJson(path) {
        requests.push(`POST ${path}`);
        return { MediaContainer: { Metadata: [{ ratingKey: '501' }] } };
      },
      async delete(path) {
        requests.push(`DELETE ${path}`);
      },
    },
  });

test('discovers distinct Plex genres, decades, resolutions, and rating groups', async () => {
  assert.deepEqual(await client().values('1', 'movie', 'genres'), [
    { value: 'comedy', label: 'Comedy', count: 1 },
    { value: 'crime', label: 'Crime', count: 1 },
    { value: 'drama', label: 'Drama', count: 2 },
  ]);
  assert.deepEqual(await client().values('1', 'movie', 'decades'), [
    { value: '2000s', label: '2000s', count: 1 },
    { value: '1990s', label: '1990s', count: 2 },
  ]);
  assert.deepEqual(await client().values('1', 'movie', 'resolutions'), [
    { value: '1080p', label: '1080p', count: 2 },
    { value: '4k', label: '4K', count: 1 },
  ]);
  assert.deepEqual(await client().values('1', 'show', 'content-ratings'), [
    {
      value: '15',
      label: '15',
      count: 1,
      group: 'numeric',
    },
    {
      value: 'tv-14',
      label: 'TV-14',
      count: 2,
      group: 'television',
    },
  ]);
  assert.equal(contentRatingGroup('AU-M'), 'australia');
});

test('creates exact smart filters and cleans up generated collections', async () => {
  const requests: string[] = [];
  const service = client(requests);
  assert.equal(
    await service.createSmart({
      title: '1990s Movies',
      libraryId: '1',
      mediaType: 'movie',
      subtype: 'decades',
      value: '1990s',
    }),
    '501'
  );
  await service.delete('501');
  const create = requests.find((entry) => entry.startsWith('POST '))!;
  const decoded = decodeURIComponent(decodeURIComponent(create));
  assert.match(decoded, /smart=1/);
  assert.match(decoded, /year>=1990/);
  assert.match(decoded, /year<=1999/);
  assert.equal(requests.at(-1), 'DELETE /library/collections/501');
});

test('reuses a matching smart collection left behind by an interrupted sync', async () => {
  const requests: string[] = [];
  const transport = {
    async query(path: string) {
      requests.push(`GET ${path}`);
      return {
        MediaContainer: {
          Metadata: [{
            ratingKey: '777',
            title: '4K Quality',
            smart: true,
            content: 'server://machine/com.plexapp.plugins.library/library/sections/1/all?type=1&resolution=4K',
          }],
        },
      };
    },
    async postJson(path: string) {
      requests.push(`POST ${path}`);
      throw new Error('must not create a duplicate');
    },
    async delete() {},
  };
  const service = new PlexLibraryGeneratorClient({
    transport: transport as never,
    machineIdentifier: 'machine',
    verifiedServerName: 'Plex',
    allowedMutationServerNames: new Set(['Plex']),
  });
  assert.equal(await service.createSmart({
    title: '4K Quality', libraryId: '1', mediaType: 'movie',
    subtype: 'resolutions', value: '4K',
  }), '777');
  assert.equal(requests.filter((value) => value.startsWith('POST ')).length, 0);
});
