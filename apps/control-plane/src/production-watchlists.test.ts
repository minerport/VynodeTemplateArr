import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { ArrConfiguration } from '@vynode/downloads';
import { VynodeSqliteStorage } from '@vynode/storage';
import { SqliteArrRepository, SqliteSeerrRepository } from './production-repositories.js';
import { ProductionWatchlistSettings } from './production-watchlists.js';

const configuration = (kind: 'radarr' | 'sonarr'): ArrConfiguration => ({
  id: kind,
  revision: 1,
  endpoint: { kind, name: kind, hostname: `${kind}.local`, port: 7878, useSsl: false, urlBase: '' },
  secretReference: `${kind}-secret`,
  selection: kind === 'radarr'
    ? { kind, profileId: 1, rootFolder: '/media', tagIds: [], isDefault: true, is4k: false, automaticTagMode: 'off', monitorByDefault: true, searchOnAdd: true, tagExistingItems: false, minimumAvailability: 'released' }
    : { kind, profileId: 1, rootFolder: '/media', tagIds: [], isDefault: true, is4k: false, automaticTagMode: 'off', monitorByDefault: true, searchOnAdd: true, tagExistingItems: false, seriesType: 'standard', seasonFolders: true, monitorType: 'all' },
  verifiedAt: '2026-08-01T00:00:00.000Z',
});

test('loads live Arr watchlist options, creates tags, and persists settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-watchlists-'));
  const storage = new VynodeSqliteStorage(join(directory, 'vynode.sqlite'));
  try {
    const arr = new SqliteArrRepository(storage);
    await arr.compareAndSet('radarr', 0, configuration('radarr'), []);
    await arr.compareAndSet('sonarr', 0, configuration('sonarr'), []);
    const requests: string[] = [];
    const fetchImplementation: typeof fetch = async (input, init) => {
      const url = String(input);
      requests.push(`${init?.method ?? 'GET'} ${url}`);
      if (init?.method === 'POST') return new Response(JSON.stringify({ id: 9, label: 'vynode' }), { status: 201, headers: { 'content-type': 'application/json' } });
      if (url.endsWith('/system/status')) return Response.json({ version: '1.0.0' });
      if (url.endsWith('/qualityprofile')) return Response.json([{ id: 1, name: 'HD' }]);
      if (url.endsWith('/rootfolder')) return Response.json([{ id: 1, path: '/media' }]);
      if (url.endsWith('/tag')) return Response.json([{ id: 2, label: 'existing' }]);
      return new Response(null, { status: 404 });
    };
    let watchlists = new ProductionWatchlistSettings(storage, arr, new SqliteSeerrRepository(storage), () => 'api-key', fetchImplementation);
    assert.equal((await watchlists.service.options('radarr')).servers[0]?.id, 'radarr');
    assert.deepEqual(await watchlists.service.createTag('radarr', 'radarr', 'vynode'), { id: 9, label: 'vynode' });
    const saved = await watchlists.service.save({
      expectedRevision: 0, enableOwner: true, enableUsers: false,
      radarr: { serverId: 'radarr', profileId: 1, rootFolder: '/media', tagIds: [2], tagWithUsername: false, monitor: true, searchOnAdd: true },
      sonarr: { serverId: 'sonarr', profileId: 1, rootFolder: '/media', tagIds: [2], tagWithUsername: false, monitor: true, searchOnAdd: true, seasonFolders: true },
    });
    assert.equal(saved.revision, 1);
    watchlists = new ProductionWatchlistSettings(storage, arr, new SqliteSeerrRepository(storage), () => 'api-key', fetchImplementation);
    assert.equal((await watchlists.service.get()).enableOwner, true);
    assert.ok(requests.some((request) => request.startsWith('POST ')));
  } finally {
    storage.close();
    await rm(directory, { recursive: true, force: true });
  }
});
