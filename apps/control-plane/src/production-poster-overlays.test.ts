import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { OverlayTemplateSummary } from '@vynode/contracts';
import type { PlexServerConfiguration } from '@vynode/media-servers';
import { VynodeSqliteStorage } from '@vynode/storage';

import { ProductionPosterOverlayStore } from './production-poster-overlays.js';

const plex = async (): Promise<PlexServerConfiguration> => ({
  revision: 1,
  host: 'plex.local',
  port: 32400,
  transport: 'http',
  autoEmptyTrash: false,
  name: 'Plex',
  machineIdentifier: 'machine',
  libraries: [
    { key: '1', title: 'Movies', type: 'movie', available: true, locations: [], observedAt: '2026-08-01T00:00:00.000Z' },
    { key: '2', title: 'TV', type: 'show', available: true, locations: [], observedAt: '2026-08-01T00:00:00.000Z' },
  ],
  verifiedAt: '2026-08-01T00:00:00.000Z',
});

const template = (name: string): Omit<OverlayTemplateSummary, 'id' | 'displayOrder' | 'elementCount'> => ({
  name,
  description: 'Production overlay',
  type: 'generic',
  tags: ['test'],
  enabled: true,
  conditionSummary: 'Always applies',
  accent: '#f3ad32',
  design: {
    width: 1000,
    height: 1500,
    elements: [{
      id: `${name}-text`,
      layerOrder: 0,
      type: 'text',
      x: 10,
      y: 10,
      width: 100,
      height: 40,
      rotation: 0,
      name: 'Text',
      properties: { text: name },
    }],
  },
});

test('persists production overlay templates, source, and Plex library configuration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-overlays-'));
  const database = join(directory, 'vynode.sqlite');
  try {
    let storage = new VynodeSqliteStorage(database);
    let overlays = new ProductionPosterOverlayStore(storage, plex, directory);
    let workspace = await overlays.saveTemplate(undefined, template('One'));
    workspace = await overlays.saveTemplate(undefined, template('Two'));
    const one = workspace.templates.find((item) => item.name === 'One')!;
    const two = workspace.templates.find((item) => item.name === 'Two')!;
    assert.equal((await overlays.saveSource(0, 'local'))?.source.revision, 1);
    assert.equal(await overlays.saveSource(0, 'tmdb'), undefined);
    await overlays.updateLibrary('2', {
      enabledTemplateIds: [one.id],
      tmdbLanguage: 'es',
      enableEpisodeScanning: true,
    });
    const copied = await overlays.copyElements(one.id, [two.id], [one.design.elements[0]!.id]);
    assert.equal(copied?.copiedTargets, 1);
    assert.equal(copied?.workspace.templates.find((item) => item.id === two.id)?.elementCount, 2);
    storage.close();

    storage = new VynodeSqliteStorage(database);
    overlays = new ProductionPosterOverlayStore(storage, plex, directory);
    workspace = await overlays.get();
    assert.equal(workspace.source.source, 'local');
    assert.equal(workspace.libraries.find((item) => item.id === '2')?.tmdbLanguage, 'es');
    assert.equal(workspace.templates.length, 2);
    await overlays.deleteTemplate(one.id);
    workspace = await overlays.get();
    assert.deepEqual(workspace.libraries.find((item) => item.id === '2')?.enabledTemplateIds, []);
    storage.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
