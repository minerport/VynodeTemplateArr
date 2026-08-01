import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  FileMissingCollectionMemberRepository,
  MissingMemberQuickSync,
  type MissingCollectionMember,
} from './missing-collection-members.js';

const record = (
  id: string,
  overrides: Partial<MissingCollectionMember> = {}
): MissingCollectionMember => ({
  id,
  collectionId: 'awards',
  collectionRatingKey: '900',
  libraryId: '1',
  mediaType: 'movie',
  tmdbId: Number(id.replace(/\D/g, '')) || 272,
  title: id,
  originalPosition: 0,
  source: 'mdblist',
  fullSyncAt: '2026-07-26T12:00:00.000Z',
  ...overrides,
});

test('atomically replaces one collection inventory and survives restart', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-missing-members-'));
  const path = join(directory, 'members.json');
  try {
    const repository = new FileMissingCollectionMemberRepository(path);
    await repository.replaceForCollection('awards', [
      record('movie-272'),
      record('movie-155', { tmdbId: 155 }),
    ]);
    const anime = record('show-76168', {
      collectionId: 'anime',
      collectionRatingKey: '901',
      libraryId: '2',
      mediaType: 'show',
      tvdbId: 76168,
    });
    delete anime.tmdbId;
    await repository.replaceForCollection('anime', [anime]);
    await repository.replaceForCollection('awards', [
      record('movie-272', { originalPosition: 4 }),
    ]);

    const restarted = new FileMissingCollectionMemberRepository(path);
    const records = await restarted.list();
    assert.equal(records.length, 2);
    assert.equal(
      records.find((item) => item.collectionId === 'awards')?.originalPosition,
      4
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('matches TMDB and TVDB, preserves order, removes only successful records', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-missing-members-'));
  const repository = new FileMissingCollectionMemberRepository(
    join(directory, 'members.json')
  );
  try {
    await repository.replaceForCollection('awards', [
      record('second', { tmdbId: 155, originalPosition: 2 }),
      record('first', { tmdbId: 272, originalPosition: 1 }),
    ]);
    const anime = record('show', {
      collectionId: 'anime',
      collectionRatingKey: '901',
      libraryId: '2',
      mediaType: 'show',
      tvdbId: 76168,
    });
    delete anime.tmdbId;
    await repository.replaceForCollection('anime', [anime]);
    const calls: { ratingKey: string; memberKeys: readonly string[] }[] = [];
    const service = new MissingMemberQuickSync({
      repository,
      async collections() {
        return [
          {
            id: 'awards',
            collectionRatingKey: '900',
            libraryId: '1',
            mediaType: 'movie',
          },
          {
            id: 'anime',
            collectionRatingKey: '901',
            libraryId: '2',
            mediaType: 'show',
          },
        ];
      },
      async scanLibrary(libraryId) {
        return libraryId === '1'
          ? [
              { ratingKey: '10', tmdbId: 272 },
              { ratingKey: '11', tmdbId: 155 },
            ]
          : [{ ratingKey: '20', tvdbId: 76168 }];
      },
      async addMembers(ratingKey, memberKeys) {
        calls.push({ ratingKey, memberKeys });
        return ratingKey === '900'
          ? { added: ['10'], failures: ['11'] }
          : { added: [], failures: [] };
      },
      now: () => new Date('2026-07-27T12:00:00.000Z'),
    });

    const report = await service.run();
    assert.deepEqual(calls[0], {
      ratingKey: '900',
      memberKeys: ['10', '11'],
    });
    assert.deepEqual(report, {
      scannedLibraries: 2,
      matchedItems: 3,
      collectionsUpdated: 1,
      itemsAdded: 1,
      alreadyPresent: 1,
      failed: 1,
      staleRecordsRemoved: 0,
    });
    assert.deepEqual(
      (await repository.list()).map((item) => item.id),
      ['second']
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('prunes expired and orphaned records without touching active inventory', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-missing-members-'));
  const repository = new FileMissingCollectionMemberRepository(
    join(directory, 'members.json')
  );
  try {
    await repository.replaceForCollection('active', [
      record('active', {
        collectionId: 'active',
        fullSyncAt: '2026-07-20T00:00:00.000Z',
      }),
    ]);
    await repository.replaceForCollection('old', [
      record('old', {
        collectionId: 'old',
        fullSyncAt: '2026-01-01T00:00:00.000Z',
      }),
    ]);
    await repository.replaceForCollection('orphan', [
      record('orphan', { collectionId: 'orphan' }),
    ]);
    const removed = await repository.prune(
      new Set(['active', 'old']),
      new Date('2026-06-27T00:00:00.000Z')
    );
    assert.equal(removed, 2);
    assert.deepEqual(
      (await repository.list()).map((item) => item.collectionId),
      ['active']
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
