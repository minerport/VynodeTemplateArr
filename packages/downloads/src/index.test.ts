import assert from 'node:assert/strict';
import test from 'node:test';
import path from 'node:path';

import {
  ArrConfigurationService,
  DownloadConfigurationError,
  MountedDirectoryBrowser,
  PlaceholderSettingsService,
  SeerrConfigurationService,
  WatchlistSettingsService,
  PlexPlaceholderWebhookService,
  type SeerrConfiguration,
  type WatchlistSettings,
  type ArrConfiguration,
  type ArrKind,
} from './index.js';

const createHarness = () => {
  const entries = new Map<string, ArrConfiguration>();
  const secrets = new Map<string, string>();
  const service = new ArrConfigurationService(
    {
      async list(kind: ArrKind) {
        return [...entries.values()].filter(
          (entry) => entry.endpoint.kind === kind
        );
      },
      async get(id) {
        return entries.get(id);
      },
      async compareAndSet(id, expected, next, defaultsToClear) {
        if ((entries.get(id)?.revision ?? 0) !== expected) return false;
        for (const otherId of defaultsToClear) {
          const other = entries.get(otherId);
          if (other) {
            entries.set(otherId, {
              ...other,
              selection: { ...other.selection, isDefault: false },
            });
          }
        }
        entries.set(id, next);
        return true;
      },
      async delete(id, expected) {
        if (entries.get(id)?.revision !== expected) return false;
        return entries.delete(id);
      },
    },
    {
      async store(value) {
        const reference = `vault:${secrets.size + 1}`;
        secrets.set(reference, value);
        return reference;
      },
      async remove(reference) {
        secrets.delete(reference);
      },
    },
    {
      async inspect() {
        return {
          serviceVersion: '5.0',
          normalizedUrlBase: '',
          profiles: [{ id: 1, name: 'HD' }],
          rootFolders: [{ id: 2, path: '/movies' }],
          tags: [{ id: 3, label: 'vynode' }],
        };
      },
    },
    () => new Date('2026-07-25T00:00:00.000Z')
  );
  return { service, entries, secrets };
};

const endpoint = {
  kind: 'radarr' as const,
  name: 'Movies',
  hostname: 'radarr.local',
  port: 7878,
  useSsl: false,
  apiKey: 'actual-api-key-value',
  urlBase: '',
};
const selection = {
  kind: 'radarr' as const,
  profileId: 1,
  rootFolder: '/movies',
  tagIds: [3],
  isDefault: true,
  is4k: false,
  automaticTagMode: 'granular' as const,
  monitorByDefault: true,
  searchOnAdd: true,
  tagExistingItems: false,
  minimumAvailability: 'released' as const,
};

test('testing endpoints does not persist settings or credentials', async () => {
  const state = createHarness();
  await state.service.test(endpoint);
  assert.equal(state.entries.size, 0);
  assert.equal(state.secrets.size, 0);
});

test('save rejects selections absent from the exact probe response', async () => {
  const state = createHarness();
  const tested = await state.service.test(endpoint);
  await assert.rejects(
    state.service.save({
      expectedRevision: 0,
      endpoint,
      selection: { ...selection, profileId: 999 },
      testReceipt: tested.testReceipt,
    }),
    (error: unknown) =>
      error instanceof DownloadConfigurationError &&
      error.code === 'invalid-selection'
  );
});

test('saved views redact API keys', async () => {
  const state = createHarness();
  const tested = await state.service.test(endpoint);
  const saved = await state.service.save({
    expectedRevision: 0,
    endpoint,
    selection,
    testReceipt: tested.testReceipt,
  });
  assert.equal(saved.secretConfigured, true);
  assert.equal(JSON.stringify(saved).includes('actual-api-key-value'), false);
  assert.equal('apiKey' in saved.endpoint, false);
});

test('setting a new standard default atomically clears the previous one', async () => {
  const state = createHarness();
  const firstTest = await state.service.test(endpoint);
  const first = await state.service.save({
    id: 'first',
    expectedRevision: 0,
    endpoint,
    selection,
    testReceipt: firstTest.testReceipt,
  });
  const secondEndpoint = { ...endpoint, name: 'Movies Backup' };
  const secondTest = await state.service.test(secondEndpoint);
  await state.service.save({
    id: 'second',
    expectedRevision: 0,
    endpoint: secondEndpoint,
    selection,
    testReceipt: secondTest.testReceipt,
  });
  assert.equal(state.entries.get(first.id)?.selection.isDefault, false);
  assert.equal(state.entries.get('second')?.selection.isDefault, true);
});

test('download server removal is confirmed, revision checked, and clears its secret', async () => {
  const { service, entries, secrets } = createHarness();
  const tested = await service.test(endpoint);
  const saved = await service.save({
    expectedRevision: 0,
    endpoint,
    selection,
    testReceipt: tested.testReceipt,
  });
  const impact = await service.removalImpact(saved.id);
  assert.equal(impact.configuration.endpoint.name, 'Movies');
  await assert.rejects(
    service.remove({ id: saved.id, expectedRevision: saved.revision, confirmed: false }),
    (error: unknown) =>
      error instanceof DownloadConfigurationError &&
      error.code === 'confirmation-required'
  );
  await service.remove({ id: saved.id, expectedRevision: saved.revision, confirmed: true });
  assert.equal(entries.has(saved.id), false);
  assert.equal(secrets.size, 0);
});

test('folder browsing cannot escape configured media mounts', async () => {
  const browser = new MountedDirectoryBrowser(['/media'], {
    async directories() {
      return ['Movies', '..'];
    },
  });
  const listing = await browser.browse('/media');
  assert.deepEqual(
    listing.directories.map((entry) => entry.name),
    ['Movies']
  );
  await assert.rejects(
    browser.browse('/etc'),
    (error: unknown) =>
      error instanceof DownloadConfigurationError &&
      error.code === 'invalid-endpoint'
  );
});

test('placeholder roots are keyed by known libraries and constrained to mounts', async () => {
  let settings = {
    revision: 0,
    libraryRoots: {},
    skipYoutubeTrailerDownloads: false,
  };
  const service = new PlaceholderSettingsService(
    {
      async get() {
        return settings;
      },
      async compareAndSet(expected, next) {
        if (settings.revision !== expected) return false;
        settings = next;
        return true;
      },
    },
    async () => new Set(['movies']),
    ['/media']
  );
  const saved = await service.save({
    expectedRevision: 0,
    libraryRoots: { movies: '/media/Movies' },
    skipYoutubeTrailerDownloads: true,
  });
  assert.equal(saved.libraryRoots.movies, path.resolve('/media/Movies'));
  await assert.rejects(
    service.save({
      expectedRevision: 1,
      libraryRoots: { unknown: '/media/TV' },
      skipYoutubeTrailerDownloads: false,
    }),
    (error: unknown) =>
      error instanceof DownloadConfigurationError &&
      error.code === 'invalid-selection'
  );
});

test('Seerr saves endpoint, destination defaults, and service-user mode atomically', async () => {
  let stored: SeerrConfiguration | undefined;
  const secrets = new Map<string, string>();
  const service = new SeerrConfigurationService(
    {
      async get() {
        return stored;
      },
      async compareAndSet(expected, next) {
        if ((stored?.revision ?? 0) !== expected) return false;
        stored = next;
        return true;
      },
      async delete(expected) {
        if (stored?.revision !== expected) return false;
        stored = undefined;
        return true;
      },
    },
    {
      async store(value) {
        secrets.set('vault:seerr', value);
        return 'vault:seerr';
      },
      async remove(reference) {
        secrets.delete(reference);
      },
    },
    {
      async inspect() {
        const options = {
          profiles: [{ id: 1, name: 'HD' }],
          rootFolders: [{ id: 2, path: '/media' }],
          tags: [{ id: 3, label: 'requests' }],
        };
        return {
          servers: {
            radarr: [
              {
                id: 10,
                name: 'Movies',
                hostname: 'radarr',
                port: 7878,
                is4k: false,
                isDefault: true,
              },
            ],
            sonarr: [],
          },
          radarrServerOptions: { 10: options },
          sonarrServerOptions: {},
        };
      },
    },
    () => new Date('2026-07-25T00:00:00.000Z')
  );
  const endpoint = {
    hostname: 'seerr.local',
    port: 5055,
    useSsl: false,
    apiKey: 'seerr-secret',
    urlBase: '',
  };
  const tested = await service.test(endpoint);
  const saved = await service.save({
    expectedRevision: 0,
    endpoint,
    testReceipt: tested.testReceipt,
    radarr: {
      serverId: 10,
      profileId: 1,
      rootFolder: '/media',
      tagIds: [3],
    },
    sonarr: { tagIds: [] },
    userCreationMode: 'granular',
  });
  assert.equal(saved.userCreationMode, 'granular');
  assert.equal(saved.radarr.serverId, 10);
  assert.equal(JSON.stringify(saved).includes('seerr-secret'), false);
  assert.equal(secrets.get('vault:seerr'), 'seerr-secret');
  const impact = await service.removalImpact();
  assert.equal(impact.consequences.some((item) => item.includes('Radarr')), true);
  await service.remove({ expectedRevision: saved.revision, confirmed: true });
  assert.equal(stored, undefined);
  assert.equal(secrets.size, 0);
});

test('Seerr rejects stale dependent options after a server change', async () => {
  const service = new SeerrConfigurationService(
    {
      async get() {
        return undefined;
      },
      async compareAndSet() {
        return true;
      },
      async delete() {
        return true;
      },
    },
    {
      async store() {
        return 'vault';
      },
      async remove() {},
    },
    {
      async inspect() {
        return {
          servers: { radarr: [], sonarr: [] },
          radarrServerOptions: {},
          sonarrServerOptions: {},
        };
      },
    },
    () => new Date()
  );
  const endpoint = {
    hostname: 'seerr.local',
    port: 5055,
    useSsl: false,
    apiKey: 'secret',
    urlBase: '',
  };
  const tested = await service.test(endpoint);
  await assert.rejects(
    service.save({
      expectedRevision: 0,
      endpoint,
      testReceipt: tested.testReceipt,
      radarr: {
        serverId: 99,
        profileId: 1,
        rootFolder: '/missing',
        tagIds: [],
      },
      sonarr: { tagIds: [] },
      userCreationMode: 'single',
    }),
    (error: unknown) =>
      error instanceof DownloadConfigurationError &&
      error.code === 'invalid-selection'
  );
});

test('Seerr collection options use the stored connection and validate tag destinations', async () => {
  const stored: SeerrConfiguration = {
    revision: 2,
    endpoint: {
      hostname: 'seerr.local',
      port: 5055,
      useSsl: false,
      urlBase: '',
    },
    secretReference: 'vault:seerr',
    secretConfigured: true,
    radarr: { serverId: 10, profileId: 1, rootFolder: '/movies', tagIds: [] },
    sonarr: { tagIds: [] },
    userCreationMode: 'single',
    verifiedAt: '2026-07-25T00:00:00.000Z',
  };
  const options = {
    servers: {
      radarr: [{
        id: 10,
        name: 'Movies',
        hostname: 'radarr.local',
        port: 7878,
        is4k: false,
        isDefault: true,
      }],
      sonarr: [],
    },
    radarrServerOptions: {
      10: {
        profiles: [{ id: 1, name: 'HD' }],
        rootFolders: [{ id: 1, path: '/movies' }],
        tags: [],
      },
    },
    sonarrServerOptions: {},
  };
  let receivedSecretReference = '';
  const service = new SeerrConfigurationService(
    {
      async get() { return stored; },
      async compareAndSet() { return true; },
      async delete() { return true; },
    },
    {
      async store() { return 'vault'; },
      async remove() {},
    },
    {
      async inspect() { return options; },
    },
    () => new Date(),
    {
      async load(configuration) {
        receivedSecretReference = configuration.secretReference;
        return options;
      },
      async createTag(configuration, kind, serverId, label) {
        assert.equal(configuration.secretReference, 'vault:seerr');
        assert.equal(kind, 'radarr');
        assert.equal(serverId, 10);
        return { id: 7, label };
      },
    }
  );
  assert.deepEqual(await service.options(), options);
  assert.equal(receivedSecretReference, 'vault:seerr');
  assert.deepEqual(
    await service.createTag('radarr', 10, 'collection'),
    { id: 7, label: 'collection' }
  );
  await assert.rejects(
    service.createTag('radarr', 99, 'collection'),
    (error: unknown) =>
      error instanceof DownloadConfigurationError &&
      error.code === 'invalid-selection'
  );
  assert.equal(JSON.stringify(await service.get()).includes('vault:seerr'), false);
});

test('watchlist sync supports independent direct-owner and Seerr-linked-user routing', async () => {
  let stored: WatchlistSettings = {
    revision: 0,
    enableOwner: false,
    enableUsers: false,
    radarr: { tagIds: [], tagWithUsername: false, monitor: true, searchOnAdd: true },
    sonarr: { tagIds: [], tagWithUsername: false, monitor: true, searchOnAdd: true, seasonFolders: true },
  };
  let hasSeerr = false;
  const options = {
    servers: [{ id: 'server', name: 'Default', is4k: false, isDefault: true }],
    serverOptions: {
      server: {
        serviceVersion: '1',
        normalizedUrlBase: '',
        profiles: [{ id: 1, name: 'HD' }],
        rootFolders: [{ id: 2, path: '/media' }],
        tags: [{ id: 3, label: 'watchlist' }],
      },
    },
  };
  const service = new WatchlistSettingsService(
    {
      async get() { return stored; },
      async compareAndSet(expected, next) {
        if (stored.revision !== expected) return false;
        stored = next;
        return true;
      },
    },
    {
      async load() { return options; },
      async createTag(_kind, _serverId, label) { return { id: 4, label }; },
    },
    async () => hasSeerr
  );
  const destination = {
    serverId: 'server',
    profileId: 1,
    rootFolder: '/media',
    tagIds: [3],
    tagWithUsername: true,
    monitor: true,
    searchOnAdd: true,
  };
  const ownerSaved = await service.save({
    expectedRevision: 0,
    enableOwner: true,
    enableUsers: false,
    radarr: destination,
    sonarr: { ...destination, seasonFolders: true },
  });
  assert.equal(ownerSaved.revision, 1);
  await assert.rejects(
    service.save({
      expectedRevision: 1,
      enableOwner: true,
      enableUsers: true,
      radarr: destination,
      sonarr: { ...destination, seasonFolders: true },
    }),
    (error: unknown) =>
      error instanceof DownloadConfigurationError &&
      error.code === 'invalid-selection'
  );
  hasSeerr = true;
  const saved = await service.save({
    expectedRevision: 1,
    enableOwner: false,
    enableUsers: true,
    radarr: ownerSaved.radarr,
    sonarr: ownerSaved.sonarr,
  });
  assert.equal(saved.revision, 2);
  assert.equal(saved.enableUsers, true);
  assert.equal(saved.enableOwner, false);
  assert.equal(saved.sonarr.seasonFolders, true);
});

test('watchlist settings preserve last sync progress and reject stale choices', async () => {
  let stored: WatchlistSettings = {
    revision: 4,
    enableOwner: true,
    enableUsers: false,
    radarr: { tagIds: [], tagWithUsername: false, monitor: true, searchOnAdd: true },
    sonarr: { tagIds: [], tagWithUsername: false, monitor: true, searchOnAdd: true },
    lastSyncAt: '2026-07-25T10:00:00.000Z',
  };
  const service = new WatchlistSettingsService(
    {
      async get() { return stored; },
      async compareAndSet(_expected, next) { stored = next; return true; },
    },
    {
      async load() { return { servers: [], serverOptions: {} }; },
      async createTag(_kind, _serverId, label) { return { id: 1, label }; },
    },
    async () => true
  );
  await assert.rejects(
    service.save({
      expectedRevision: 4,
      enableOwner: true,
      enableUsers: false,
      radarr: { serverId: 'gone', profileId: 1, rootFolder: '/gone', tagIds: [], tagWithUsername: false, monitor: true, searchOnAdd: true },
      sonarr: { serverId: 'gone', profileId: 1, rootFolder: '/gone', tagIds: [], tagWithUsername: false, monitor: true, searchOnAdd: true },
    }),
    (error: unknown) =>
      error instanceof DownloadConfigurationError &&
      error.code === 'invalid-selection'
  );
  assert.equal(stored.lastSyncAt, '2026-07-25T10:00:00.000Z');
});

test('Plex webhook resets only recognized placeholders and ignores duplicate deliveries', async () => {
  const resets: string[] = [];
  let now = new Date('2026-07-25T10:00:00.000Z');
  const service = new PlexPlaceholderWebhookService(
    { async markUnplayed(ratingKey) { resets.push(ratingKey); } },
    () => now
  );
  const payload = {
    event: 'media.scrobble',
    Account: { id: 1 },
    Server: { uuid: 'plex-server' },
    Metadata: {
      ratingKey: '42',
      type: 'episode',
      title: 'Trailer (Placeholder)',
    },
  };
  const processed = await service.receive(payload);
  assert.equal(processed.state, 'processed');
  assert.deepEqual(resets, ['42']);
  const duplicate = await service.receive(payload);
  assert.equal(duplicate.detail, 'Duplicate Plex event ignored safely.');
  assert.deepEqual(resets, ['42']);
  now = new Date('2026-07-25T10:06:00.000Z');
  await service.receive(payload);
  assert.deepEqual(resets, ['42', '42']);
  const ignored = await service.receive({
    event: 'library.new',
    Metadata: { ratingKey: '99', type: 'movie', title: 'Regular movie' },
  });
  assert.equal(ignored.state, 'ignored');
});
