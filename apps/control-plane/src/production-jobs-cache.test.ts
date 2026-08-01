import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { VynodeSqliteStorage } from '@vynode/storage';
import { ProductionJobsAndCache } from './production-jobs-cache.js';

const until = async (condition: () => Promise<boolean>) => {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (await condition()) return;
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5));
  }
  throw new Error('Timed out waiting for job completion.');
};

test('persists production job schedules, outcomes, cancellation, and cache flushing', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-jobs-cache-'));
  const storage = new VynodeSqliteStorage(join(directory, 'vynode.sqlite'));
  let release: (() => void) | undefined;
  try {
    const service = new ProductionJobsAndCache(storage, directory, {
      'plex-collections-sync': async () => 'Collections completed.',
      'overlay-application': async (signal) => new Promise<string>((resolvePromise, rejectPromise) => {
        release = () => resolvePromise('Overlay completed.');
        signal.addEventListener('abort', () => rejectPromise(new DOMException('cancelled', 'AbortError')), { once: true });
      }),
      'watchlist-sync': async () => 'Watchlists completed.',
    }, () => new Date('2026-08-01T00:00:00.000Z'));
    const scheduled = await service.schedule('plex-collections-sync', '0 */20 * * * *');
    assert.equal(scheduled?.cronSchedule, '0 */20 * * * *');
    assert.equal((await service.run('plex-collections-sync'))?.running, true);
    await until(async () => (await service.jobs()).find((job) => job.id === 'plex-collections-sync')?.running === false);
    assert.equal((await service.jobs()).find((job) => job.id === 'plex-collections-sync')?.lastOutcome, 'success');

    await service.run('overlay-application');
    assert.equal((await service.cancel('overlay-application'))?.running, true);
    await until(async () => (await service.jobs()).find((job) => job.id === 'overlay-application')?.running === false);
    assert.equal((await service.jobs()).find((job) => job.id === 'overlay-application')?.lastOutcome, 'cancelled');
    release?.();

    const imageCache = join(directory, 'cache', 'images');
    await mkdir(imageCache, { recursive: true });
    await writeFile(join(imageCache, 'entry.bin'), Buffer.alloc(12));
    assert.equal((await service.caches()).find((cache) => cache.id === 'images')?.keys, 1);
    assert.equal((await service.flushCache('images'))?.keys, 0);

    const restarted = new ProductionJobsAndCache(storage, directory, {});
    assert.equal((await restarted.jobs()).find((job) => job.id === 'plex-collections-sync')?.cronSchedule, '0 */20 * * * *');
  } finally {
    storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});
