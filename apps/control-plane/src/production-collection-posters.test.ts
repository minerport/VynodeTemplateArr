import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { CollectionPosterDesign } from '@vynode/contracts';
import { VynodeSqliteStorage } from '@vynode/storage';

import { ProductionCollectionPosterStore } from './production-collection-posters.js';

const design: CollectionPosterDesign = {
  width: 1000,
  height: 1500,
  background: { type: 'color', color: '#111111', secondaryColor: '#222222', intensity: 1, useSourceColors: false },
  elements: [],
  migrated: true,
};

test('persists production collection posters and editor assets across restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-collection-posters-'));
  const databasePath = join(directory, 'vynode.sqlite');
  let storage: VynodeSqliteStorage | undefined;
  try {
    storage = new VynodeSqliteStorage(databasePath);
    let store = new ProductionCollectionPosterStore(storage, directory, () => new Date('2026-08-01T00:00:00.000Z'));
    let workspace = await store.saveTemplate(undefined, { name: 'Primary', description: 'Default layout', design });
    const templateId = workspace.templates[0]!.id;
    workspace = (await store.setDefault(templateId))!;
    assert.equal(workspace.templates[0]?.isDefault, true);
    assert.equal(await store.deleteTemplate(templateId), undefined);

    workspace = await store.savePoster(undefined, { name: 'Saved poster', description: 'Reusable artwork', design });
    const posterId = workspace.savedPosters[0]!.id;
    workspace = (await store.duplicatePoster(posterId))!;
    assert.equal(workspace.savedPosters.length, 2);

    await store.importSourceColors({ plex: { primaryColor: '#111111', secondaryColor: '#222222', textColor: '#ffffff' } });
    const asset = await store.saveAsset({ name: 'pixel.png', mimeType: 'image/png', bytes: Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]) });
    assert.deepEqual((await store.readAsset(asset.id))?.bytes, Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]));

    storage.close();
    storage = new VynodeSqliteStorage(databasePath);
    store = new ProductionCollectionPosterStore(storage, directory);
    workspace = await store.get();
    assert.equal(workspace.templates[0]?.name, 'Primary');
    assert.equal(workspace.savedPosters.length, 2);
    assert.equal(workspace.sourceColors.plex?.textColor, '#ffffff');
    assert.equal(workspace.assets[0]?.id, asset.id);
    assert.equal(await store.deleteAsset(asset.id), true);
  } finally {
    storage?.close();
    await rm(directory, { recursive: true, force: true });
  }
});
