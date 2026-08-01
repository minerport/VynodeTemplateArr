import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  CoalescingPosterProvider,
  CachedPosterProvider,
  PosterOperationConflictError,
  PosterOperationCoordinator,
  PosterAcquisitionService,
  localPosterDirectory,
  type PosterMediaItem,
  type RemotePosterProvider,
} from './index.js';
import { FilePosterCache } from './poster-cache.js';

const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb]);
const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
const item = (overrides: Partial<PosterMediaItem> = {}): PosterMediaItem => ({
  ratingKey: '101',
  title: 'Example: Movie?',
  year: 2026,
  mediaType: 'movie',
  libraryId: '../movies',
  libraryName: 'Movies/4K',
  tmdbId: 123,
  ...overrides,
});

test('serializes mutually exclusive poster operations and always releases failures', async () => {
  const coordinator = new PosterOperationCoordinator();
  const release = coordinator.acquire('apply-overlays');
  assert.equal(coordinator.running(), 'apply-overlays');
  assert.throws(
    () => coordinator.acquire('download-base-posters'),
    (error: unknown) =>
      error instanceof PosterOperationConflictError &&
      error.running === 'apply-overlays' &&
      error.requested === 'download-base-posters'
  );
  release();
  release();
  assert.equal(coordinator.running(), undefined);
  await assert.rejects(
    coordinator.run('reset-posters', async () => {
      throw new Error('reset failed');
    }),
    /reset failed/
  );
  assert.equal(coordinator.running(), undefined);
});
const unavailable: RemotePosterProvider = {
  async poster() {
    return undefined;
  },
};

test('constructs a contained, sanitized local-poster directory', () => {
  const root = join(tmpdir(), 'vynode-local-root');
  const path = localPosterDirectory(root, item());
  assert.ok(path?.startsWith(root));
  assert.doesNotMatch(path!.slice(root.length), /\.\.|[?:]/);
  assert.match(path!, /Movies4K-movies/);
  assert.match(path!, /Example Movie \(2026\) tmdb-123/);
  const withoutTmdb = item();
  delete withoutTmdb.tmdbId;
  assert.equal(localPosterDirectory(root, withoutTmdb), undefined);
});

test('prefers poster-named local images and falls back to TMDB when absent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vynode-local-'));
  try {
    const directory = localPosterDirectory(root, item())!;
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'z-custom.png'), png);
    await writeFile(join(directory, 'poster.jpg'), jpeg);
    let tmdbCalls = 0;
    const service = new PosterAcquisitionService({
      localRoot: root,
      plex: unavailable,
      tmdb: {
        async poster() {
          tmdbCalls++;
          return png;
        },
      },
    });
    const local = await service.acquire('local', item(), 'en-US');
    assert.equal(local.source, 'local');
    assert.deepEqual(Array.from(local.bytes), Array.from(jpeg));
    assert.equal(tmdbCalls, 0);

    const fallback = await service.acquire(
      'local',
      item({ tmdbId: 999 }),
      'en-US'
    );
    assert.equal(fallback.source, 'tmdb');
    assert.equal(fallback.fallbackFrom, 'local');
    assert.equal(tmdbCalls, 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects invalid, empty, oversized, unavailable, and cancelled posters', async () => {
  const service = new PosterAcquisitionService({
    localRoot: tmpdir(),
    plex: {
      async poster(current) {
        if (current.ratingKey === 'invalid') return new Uint8Array([1, 2, 3]);
        if (current.ratingKey === 'large') return jpeg;
        return undefined;
      },
    },
    tmdb: unavailable,
    maxBytes: 3,
  });
  await assert.rejects(
    service.acquire('plex', item({ ratingKey: 'invalid' }), 'en-US'),
    /not a supported/
  );
  await assert.rejects(
    service.acquire('plex', item({ ratingKey: 'large' }), 'en-US'),
    /exceeds the size limit/
  );
  await assert.rejects(
    service.acquire('tmdb', item(), 'en-US'),
    /No TMDB poster/
  );
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    service.acquire('tmdb', item(), 'en-US', controller.signal),
    /cancelled/
  );
});

test('coalesces concurrent poster requests, negatively caches misses, and retries failures', async () => {
  let calls = 0;
  let fail = false;
  const provider = new CoalescingPosterProvider({
    async poster() {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 2));
      if (fail) throw new Error('temporary failure');
      return undefined;
    },
  });
  const first = provider.poster(item(), 'en-US');
  const second = provider.poster(item(), 'EN-us');
  assert.equal(first, second);
  assert.deepEqual(await Promise.all([first, second]), [undefined, undefined]);
  assert.equal(calls, 1);
  assert.equal(await provider.poster(item(), 'en-US'), undefined);
  assert.equal(calls, 1);

  provider.clear();
  fail = true;
  await assert.rejects(provider.poster(item(), 'en-US'), /temporary failure/);
  fail = false;
  assert.equal(await provider.poster(item(), 'en-US'), undefined);
  assert.equal(calls, 3);
});

test('serves remote posters from durable cache without repeating provider calls', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-provider-cache-'));
  try {
    let calls = 0;
    const provider = new CachedPosterProvider(
      'tmdb',
      {
        async poster() {
          calls++;
          return jpeg;
        },
      },
      new FilePosterCache({ directory })
    );
    assert.deepEqual(
      Array.from((await provider.poster(item(), 'en-US'))!),
      Array.from(jpeg)
    );
    assert.deepEqual(
      Array.from((await provider.poster(item(), 'en-US'))!),
      Array.from(jpeg)
    );
    assert.equal(calls, 1);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
