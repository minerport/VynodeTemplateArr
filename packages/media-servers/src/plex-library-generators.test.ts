import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PlexLibraryGeneratorClient,
  contentRatingGroup,
} from './plex-library-generators.js';

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
