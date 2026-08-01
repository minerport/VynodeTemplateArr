import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  generateLocalPosterFolders,
  localPosterDirectory,
  populateLocalPosters,
  type PosterMediaItem,
} from './index.js';

const jpeg = Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3]);
const media = (ratingKey: string, tmdbId?: number): PosterMediaItem => ({
  ratingKey,
  title: `Title ${ratingKey}`,
  year: 2026,
  libraryId: '1',
  libraryName: 'Movies',
  mediaType: 'movie',
  ...(tmdbId ? { tmdbId } : {}),
});

test('generates contained local poster folders and reports items without TMDB identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vynode-folders-'));
  try {
    const result = await generateLocalPosterFolders(root, [media('a', 10), media('b')]);
    assert.deepEqual(result, {
      scanned: 2,
      created: 1,
      skippedExisting: 0,
      skippedMissingTmdb: 1,
      failed: 0,
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('populates Plex posters without overwriting any existing local image', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vynode-populate-'));
  try {
    const existing = media('existing', 11);
    await generateLocalPosterFolders(root, [existing]);
    const existingDirectory = localPosterDirectory(root, existing)!;
    await writeFile(join(existingDirectory, 'custom.png'), Uint8Array.from([1]));
    let downloads = 0;
    const fresh = media('fresh', 12);
    const result = await populateLocalPosters(root, [existing, fresh], async () => {
      downloads += 1;
      return jpeg;
    });
    assert.equal(downloads, 1);
    assert.equal(result.created, 1);
    assert.equal(result.skippedExisting, 1);
    assert.deepEqual(await readFile(join(localPosterDirectory(root, fresh)!, 'poster.jpg')), Buffer.from(jpeg));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
