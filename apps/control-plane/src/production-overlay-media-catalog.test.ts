import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { VynodeSqliteStorage } from '@vynode/storage';
import { ProductionOverlayMediaCatalog } from './production-overlay-media-catalog.js';

test('persists Plex inventory and provider enrichment with expiry and invalidation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-overlay-catalog-'));
  let clock = new Date('2026-08-01T12:00:00.000Z');
  try {
    const storage = new VynodeSqliteStorage(join(directory, 'catalog.sqlite'));
    const catalog = new ProductionOverlayMediaCatalog(storage, () => clock, 60_000);
    const item = { ratingKey: '42', libraryId: 'movies', libraryName: 'Movies', mediaType: 'movie' as const, title: 'Example' };
    await catalog.put('movies', [item]);
    await catalog.putEnrichment('42', 'tmdb', { genre: 'Science Fiction', runtime: 120 });

    const reopened = new ProductionOverlayMediaCatalog(storage, () => clock, 60_000);
    assert.deepEqual(reopened.get('movies'), [item]);
    assert.deepEqual(reopened.getEnrichment('42', 'tmdb'), { genre: 'Science Fiction', runtime: 120 });

    clock = new Date('2026-08-01T12:01:01.000Z');
    assert.equal(reopened.get('movies'), undefined);
    assert.equal(reopened.getEnrichment('42', 'tmdb'), undefined);

    clock = new Date('2026-08-01T12:00:30.000Z');
    await reopened.invalidate('movies');
    assert.equal(reopened.get('movies'), undefined);
    assert.deepEqual(reopened.getEnrichment('42', 'tmdb'), { genre: 'Science Fiction', runtime: 120 });
    storage.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
