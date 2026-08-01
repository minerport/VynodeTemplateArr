import assert from 'node:assert/strict';
import test from 'node:test';

import {
  PlexConfigurationError,
  PlexServerConfigurationService,
  validatePlexConnection,
  type PlexServerConfiguration,
} from './index.js';

test('validates and normalizes DNS, IPv4, and IPv6 inputs', () => {
  assert.equal(
    validatePlexConnection({
      host: ' PLEX.Example.COM ',
      port: 32400,
      transport: 'https-verify',
      webAppUrl: 'https://app.plex.tv/desktop/',
      autoEmptyTrash: true,
    }).host,
    'plex.example.com'
  );
  assert.equal(
    validatePlexConnection({
      host: '192.168.1.20',
      port: 32400,
      transport: 'http',
      autoEmptyTrash: false,
    }).host,
    '192.168.1.20'
  );
  assert.equal(
    validatePlexConnection({
      host: '[2001:db8::1]',
      port: 32400,
      transport: 'https-allow-self-signed',
      autoEmptyTrash: true,
    }).host,
    '2001:db8::1'
  );
});

test('failed probes never modify the active configuration', async () => {
  const original: PlexServerConfiguration = {
    revision: 1,
    host: 'old.local',
    port: 32400,
    transport: 'http',
    autoEmptyTrash: true,
    machineIdentifier: 'old-machine',
    name: 'Old server',
    libraries: [],
    verifiedAt: '2026-07-24T00:00:00.000Z',
  };
  let stored = original;
  const service = new PlexServerConfigurationService(
    {
      async get() {
        return stored;
      },
      async compareAndSet(_expected, next) {
        stored = next;
        return true;
      },
    },
    {
      async observe() {
        throw new Error('connection refused');
      },
    }
  );

  await assert.rejects(() =>
    service.save({
      expectedRevision: 1,
      input: {
        host: 'wrong.local',
        port: 32400,
        transport: 'http',
        autoEmptyTrash: true,
      },
      plexTokenReference: 'vault:plex',
      confirmMachineChange: false,
      now: '2026-07-25T00:00:00.000Z',
    })
  );
  assert.deepEqual(stored, original);
});

test('successful saves atomically include libraries and retain missing ones', async () => {
  let stored: PlexServerConfiguration = {
    revision: 3,
    host: 'plex.local',
    port: 32400,
    transport: 'http',
    autoEmptyTrash: true,
    machineIdentifier: 'machine-1',
    name: 'Plex',
    libraries: [
      {
        key: '1',
        title: 'Movies',
        type: 'movie',
        locations: ['/media/movies'],
        available: true,
        observedAt: '2026-07-24T00:00:00.000Z',
      },
      {
        key: '2',
        title: 'TV',
        type: 'show',
        locations: ['/media/tv'],
        available: true,
        observedAt: '2026-07-24T00:00:00.000Z',
      },
    ],
    verifiedAt: '2026-07-24T00:00:00.000Z',
  };
  const service = new PlexServerConfigurationService(
    {
      async get() {
        return stored;
      },
      async compareAndSet(expected, next) {
        if (stored.revision !== expected) return false;
        stored = next;
        return true;
      },
    },
    {
      async observe() {
        return {
          machineIdentifier: 'machine-1',
          name: 'Plex',
          libraries: [
            {
              key: '1',
              title: 'Movies',
              type: 'movie',
              locations: ['/media/movies'],
            },
          ],
        };
      },
    }
  );

  const result = await service.save({
    expectedRevision: 3,
    input: {
      host: 'plex.local',
      port: 32400,
      transport: 'http',
      autoEmptyTrash: false,
    },
    plexTokenReference: 'vault:plex',
    confirmMachineChange: false,
    now: '2026-07-25T00:00:00.000Z',
  });

  assert.equal(result.revision, 4);
  assert.equal(result.libraries[0]?.available, true);
  assert.equal(result.libraries[1]?.available, false);
});

test('machine changes require explicit confirmation', async () => {
  const service = new PlexServerConfigurationService(
    {
      async get() {
        return {
          revision: 1,
          host: 'plex.local',
          port: 32400,
          transport: 'http' as const,
          autoEmptyTrash: true,
          machineIdentifier: 'machine-1',
          name: 'Old',
          libraries: [],
          verifiedAt: '2026-07-24T00:00:00.000Z',
        };
      },
      async compareAndSet() {
        return true;
      },
    },
    {
      async observe() {
        return {
          machineIdentifier: 'machine-2',
          name: 'New',
          libraries: [],
        };
      },
    }
  );

  await assert.rejects(
    () =>
      service.save({
        expectedRevision: 1,
        input: {
          host: 'new.local',
          port: 32400,
          transport: 'http',
          autoEmptyTrash: true,
        },
        plexTokenReference: 'vault:plex',
        confirmMachineChange: false,
        now: '2026-07-25T00:00:00.000Z',
      }),
    (error) =>
      error instanceof PlexConfigurationError &&
      error.code === 'machine-change-confirmation-required'
  );
});
