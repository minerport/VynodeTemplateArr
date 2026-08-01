import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { FilePosterEditorAssetStore } from './editor-assets.js';

const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

test('stores poster editor assets with opaque names and reloads metadata', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-editor-assets-'));
  try {
    const store = new FilePosterEditorAssetStore({ directory });
    const asset = await store.save({
      name: '../unsafe poster.png',
      mimeType: 'image/png',
      bytes: png,
    });
    assert.equal(asset.name, 'unsafe poster.png');
    assert.equal(asset.kind, 'raster');
    assert.deepEqual((await store.read(asset.id))?.bytes, png);
    const files = await import('node:fs/promises').then(({ readdir }) =>
      readdir(directory)
    );
    assert.equal(files.length, 2);
    assert.ok(files.includes('index.json'));
    assert.ok(files.some((name) => /^[0-9a-f]{64}$/.test(name)));
    assert.equal(await store.delete(asset.id), true);
    assert.equal(await store.read(asset.id), undefined);
    assert.equal((await store.list()).length, 0);
    assert.equal(await store.delete(asset.id), false);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('rejects mismatched images and unsafe SVG content', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-editor-assets-'));
  try {
    const store = new FilePosterEditorAssetStore({ directory });
    await assert.rejects(
      store.save({
        name: 'fake.jpg',
        mimeType: 'image/jpeg',
        bytes: png,
      }),
      /do not match/
    );
    await assert.rejects(
      store.save({
        name: 'unsafe.svg',
        mimeType: 'image/svg+xml',
        bytes: new TextEncoder().encode(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
        ),
      }),
      /unsafe active/
    );
    const safe = await store.save({
      name: 'safe.svg',
      mimeType: 'image/svg+xml',
      bytes: new TextEncoder().encode(
        '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h10v10z"/></svg>'
      ),
    });
    assert.equal(safe.kind, 'svg');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('stores validated custom poster fonts and rejects disguised files', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-editor-fonts-'));
  try {
    const store = new FilePosterEditorAssetStore({ directory });
    const font = new Uint8Array([0x77, 0x4f, 0x46, 0x32, 0, 0, 0, 1]);
    const saved = await store.save({ name: 'brand.woff2', mimeType: 'font/woff2', bytes: font });
    assert.equal(saved.kind, 'font');
    assert.deepEqual((await store.read(saved.id))?.bytes, font);
    await assert.rejects(
      store.save({ name: 'fake.ttf', mimeType: 'font/ttf', bytes: png }),
      /font contents/
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('serializes concurrent saves and refuses corrupt index or asset bytes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-editor-assets-'));
  try {
    const store = new FilePosterEditorAssetStore({ directory });
    const saved = await Promise.all(
      ['one.png', 'two.png', 'three.png'].map((name) =>
        store.save({ name, mimeType: 'image/png', bytes: png })
      )
    );
    assert.equal((await store.list()).length, 3);

    const index = JSON.parse(
      await readFile(join(directory, 'index.json'), 'utf8')
    ) as { id: string }[];
    const assetName = await import('node:crypto').then(({ createHash }) =>
      createHash('sha256').update(saved[0]!.id).digest('hex')
    );
    await writeFile(join(directory, assetName), new Uint8Array([1]));
    await assert.rejects(store.read(saved[0]!.id), /missing or corrupt/);

    await writeFile(join(directory, 'index.json'), '{bad json', 'utf8');
    await assert.rejects(store.list(), /index is corrupt/);
    assert.equal(index.length, 3);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
