import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { PlexServerConfiguration } from '@vynode/media-servers';
import { VynodeSqliteStorage } from '@vynode/storage';
import { ProductionPlaceholderServices } from './production-placeholder-settings.js';

test('persists placeholder settings and confines directory browsing to mounted roots', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-placeholders-'));
  const mediaRoot = join(directory, 'media');
  const storage = new VynodeSqliteStorage(join(directory, 'vynode.sqlite'));
  const plex = async (): Promise<PlexServerConfiguration> => ({
    revision: 1, host: 'plex.local', port: 32400, transport: 'http', autoEmptyTrash: false,
    machineIdentifier: 'machine', name: 'Plex', verifiedAt: '2026-08-01T00:00:00.000Z',
    libraries: [{ key: '1', title: 'Movies', type: 'movie', locations: [], available: true, observedAt: '2026-08-01T00:00:00.000Z' }],
  });
  try {
    const services = new ProductionPlaceholderServices(storage, directory, [mediaRoot], plex);
    const saved = await services.settings.save({ expectedRevision: 0, libraryRoots: { '1': mediaRoot }, skipYoutubeTrailerDownloads: true });
    assert.equal(saved.revision, 1);
    assert.equal((await services.youtubeCookieStatus()).state, 'present-but-disabled');
    await assert.rejects(services.directoryBrowser.browse(join(directory, 'outside')), /outside/);
    const restarted = new ProductionPlaceholderServices(storage, directory, [mediaRoot], plex);
    assert.equal((await restarted.settings.get()).libraryRoots['1'], mediaRoot);
  } finally {
    storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});
