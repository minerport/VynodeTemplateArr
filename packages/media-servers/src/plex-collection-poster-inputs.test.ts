import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CollectionPosterSettings,
  PlexDiscoveredItem,
} from '@vynode/contracts';

import { PlexCollectionPosterInputProvider } from './plex-collection-poster-inputs.js';

const item = {
  id: 'plex-collection:1:99',
  kind: 'pre-existing-collection',
  plexKey: '99',
  name: 'Franchise',
  libraryId: '1',
  libraryName: 'Movies',
  mediaType: 'movie',
} as PlexDiscoveredItem;

const settings: CollectionPosterSettings = {
  autoGenerate: true,
  applyOverlaysDuringSync: false,
  useTmdbFranchisePoster: true,
  hideIndividualItems: false,
};

test('loads bounded Plex member artwork and optional production poster context', async () => {
  const calls: string[] = [];
  const transport = {
    async query(path: string) {
      calls.push(path);
      return {
        MediaContainer: {
          Metadata: [
            {
              ratingKey: '1',
              thumb: '/library/metadata/1/thumb/100',
              updatedAt: 100,
            },
            {
              ratingKey: '2',
              parentThumb: '/library/metadata/2/thumb/200',
              updatedAt: 200,
            },
            { ratingKey: '3', thumb: '/unrequested' },
          ],
        },
      };
    },
    async queryBinary(path: string) {
      calls.push(path);
      return new TextEncoder().encode(path);
    },
  };
  const signal = new AbortController().signal;
  const provider = new PlexCollectionPosterInputProvider({
    transport,
    maximumItemPosters: 2,
    async sourceType() {
      return 'tmdb';
    },
    async personPoster(_item, receivedSignal) {
      assert.equal(receivedSignal, signal);
      return new Uint8Array([7]);
    },
    async tmdbFranchisePoster(_item, receivedSignal) {
      assert.equal(receivedSignal, signal);
      return new Uint8Array([8]);
    },
  });
  const result = await provider.inputs(item, settings, signal);

  assert.deepEqual(calls, [
    '/library/collections/99/children',
    '/library/metadata/1/thumb/100',
    '/library/metadata/2/thumb/200',
  ]);
  assert.equal(result.itemPosters.length, 2);
  assert.equal(result.sourceType, 'tmdb');
  assert.deepEqual(result.personPoster, new Uint8Array([7]));
  assert.deepEqual(result.tmdbFranchisePoster, new Uint8Array([8]));
  assert.equal(result.fingerprint.length, 64);
});

test('keeps usable posters when individual Plex artwork requests fail', async () => {
  const transport = {
    async query() {
      return {
        MediaContainer: {
          Metadata: [
            { ratingKey: '1', thumb: '/good' },
            { ratingKey: '2', thumb: '/failed' },
            { ratingKey: '3' },
          ],
        },
      };
    },
    async queryBinary(path: string) {
      if (path === '/failed') throw new Error('Plex artwork failed');
      return new Uint8Array([1]);
    },
  };
  const result = await new PlexCollectionPosterInputProvider({
    transport,
  }).inputs(item, { ...settings, useTmdbFranchisePoster: false });

  assert.deepEqual(result.itemPosters, [new Uint8Array([1])]);
  assert.equal(result.tmdbFranchisePoster, undefined);
});

test('rejects hubs, unsafe limits, and propagates cancellation', async () => {
  assert.throws(
    () =>
      new PlexCollectionPosterInputProvider({
        transport: {
          async query() {
            return {};
          },
          async queryBinary() {
            return new Uint8Array();
          },
        },
        maximumItemPosters: 0,
      }),
    /integer from 1 through 100/
  );
  const provider = new PlexCollectionPosterInputProvider({
    transport: {
      async query() {
        return { MediaContainer: { Metadata: [] } };
      },
      async queryBinary() {
        return new Uint8Array();
      },
    },
  });
  await assert.rejects(
    provider.inputs(
      { ...item, kind: 'default-hub' },
      settings
    ),
    /do not have collection members/
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    provider.inputs(item, settings, controller.signal),
    /cancelled/
  );
});
