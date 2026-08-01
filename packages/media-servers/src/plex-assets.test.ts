import assert from 'node:assert/strict';
import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { CollectionAssetReference } from '@vynode/contracts';

import { FileCollectionAssetStore } from './plex-assets.js';

const reference = (
  overrides: Partial<CollectionAssetReference> = {}
): CollectionAssetReference => ({
  id: 'wallpaper/unsafe-path',
  name: 'wallpaper.webp',
  mimeType: 'image/webp',
  size: 3,
  previewDataUrl: 'data:image/webp;base64,AQID',
  ...overrides,
});

test('persists and resolves an asset outside user-controlled path names', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-assets-'));
  try {
    const store = new FileCollectionAssetStore({ directory });
    await store.persist(reference());
    assert.deepEqual(Array.from(await store.resolveAsset(reference())), [1, 2, 3]);
    const files = await import('node:fs/promises').then(({ readdir }) =>
      readdir(directory)
    );
    assert.equal(files.length, 1);
    assert.doesNotMatch(files[0]!, /wallpaper|unsafe/);
    if (process.platform !== 'win32') {
      assert.equal((await stat(join(directory, files[0]!))).mode & 0o777, 0o600);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('recovers a missing stored asset from its validated preview payload', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-assets-'));
  try {
    const store = new FileCollectionAssetStore({ directory });
    assert.deepEqual(Array.from(await store.resolveAsset(reference())), [1, 2, 3]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects malformed, mismatched, and oversized asset payloads', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-assets-'));
  try {
    const store = new FileCollectionAssetStore({ directory, maxBytes: 2 });
    await assert.rejects(
      store.persist(reference({ previewDataUrl: 'data:text/plain;base64,AQID' })),
      /invalid data URL/
    );
    await assert.rejects(
      store.persist(reference({ size: 4 })),
      /size does not match/
    );
    await assert.rejects(store.persist(reference()), /exceeds the upload limit/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects a stored asset whose size no longer matches metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-assets-'));
  try {
    const store = new FileCollectionAssetStore({ directory });
    await store.persist(reference());
    const files = await import('node:fs/promises').then(({ readdir }) =>
      readdir(directory)
    );
    await assert.rejects(
      store.resolveAsset(reference({ size: 2 })),
      /size does not match/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
