import assert from 'node:assert/strict';
import test from 'node:test';
import type { SeerrConfiguration } from './index.js';
import { HttpSeerrProvider } from './seerr.js';

const configuration: SeerrConfiguration = {
  revision: 1,
  endpoint: { hostname: 'seerr.local', port: 5055, useSsl: false, urlBase: '' },
  secretReference: 'vault:seerr',
  secretConfigured: true,
  radarr: { serverId: 1, profileId: 2, rootFolder: '/movies', tagIds: [] },
  sonarr: { serverId: 3, profileId: 4, rootFolder: '/tv', tagIds: [] },
  userCreationMode: 'per-service',
  verifiedAt: '2026-07-30T10:00:00.000Z',
};

test('Seerr loads real download servers and dependent options', async () => {
  const calls: { url: string; init?: RequestInit }[] = [];
  const request = async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, ...(init ? { init } : {}) });
    if (url.endsWith('/auth/me')) return Response.json({ id: 1 });
    if (url.endsWith('/settings/radarr'))
      return Response.json([{ id: 1, name: 'Radarr', hostname: 'radarr', port: 7878, apiKey: 'arr-secret', isDefault: true }]);
    if (url.endsWith('/settings/sonarr'))
      return Response.json([{ id: 3, name: 'Sonarr', hostname: 'sonarr', port: 8989, apiKey: 'arr-secret', isDefault: true }]);
    return Response.json({
      profiles: [{ id: 2, name: 'HD-1080p' }],
      rootFolders: [{ id: 1, path: url.includes('radarr') ? '/movies' : '/tv' }],
      tags: [{ id: 8, label: 'vynode' }],
    });
  };
  const provider = new HttpSeerrProvider(() => 'seerr-secret', request as typeof fetch);

  const result = await provider.load(configuration);

  assert.equal(result.servers.radarr[0]?.name, 'Radarr');
  assert.equal(result.servers.sonarr[0]?.isDefault, true);
  assert.equal(result.radarrServerOptions[1]?.profiles[0]?.name, 'HD-1080p');
  assert.equal(result.sonarrServerOptions[3]?.rootFolders[0]?.path, '/tv');
  assert.equal(calls.length, 5);
  assert.ok(calls.every((call) => new Headers(call.init?.headers).get('X-Api-Key') === 'seerr-secret'));
  assert.equal(JSON.stringify(result).includes('secret'), false);
});

test('Seerr remains connectable when one downstream Arr destination returns 500', async () => {
  const request = async (input: string | URL | Request) => {
    const url = String(input);
    if (url.endsWith('/auth/me')) return Response.json({ id: 1 });
    if (url.endsWith('/settings/radarr'))
      return Response.json([{ id: 1, name: 'Radarr', hostname: 'radarr', port: 7878, apiKey: 'arr-secret' }]);
    if (url.endsWith('/settings/sonarr')) return Response.json([]);
    if (url.endsWith('/settings/radarr/test')) return new Response(null, { status: 500 });
    return new Response(null, { status: 404 });
  };
  const result = await new HttpSeerrProvider(() => 'seerr-secret', request as typeof fetch).load(configuration);
  assert.equal(result.servers.radarr[0]?.name, 'Radarr');
  assert.deepEqual(result.radarrServerOptions[1], { profiles: [], rootFolders: [], tags: [] });
});

test('Seerr triggers the Plex watchlist job with cancellation', async () => {
  const controller = new AbortController();
  let receivedUrl = '';
  let receivedInit: RequestInit | undefined;
  const provider = new HttpSeerrProvider(
    () => 'seerr-secret',
    (async (input: string | URL | Request, init?: RequestInit) => {
      receivedUrl = String(input);
      receivedInit = init;
      return new Response(null, { status: 204 });
    }) as typeof fetch
  );

  await provider.triggerWatchlistSync(configuration, controller.signal);

  assert.equal(receivedUrl, 'http://seerr.local:5055/api/v1/settings/jobs/plex-watchlist-sync/run');
  assert.equal(receivedInit?.method, 'POST');
  assert.equal(receivedInit?.signal, controller.signal);
  assert.equal(new Headers(receivedInit?.headers).get('X-Api-Key'), 'seerr-secret');
});

test('Seerr failures expose status but never credentials', async () => {
  const provider = new HttpSeerrProvider(
    () => 'never-print-this',
    (async () => new Response(null, { status: 401 })) as typeof fetch
  );

  await assert.rejects(
    provider.triggerWatchlistSync(configuration),
    (error: unknown) =>
      error instanceof Error &&
      error.message === 'Seerr request failed with status 401.' &&
      !error.message.includes('never-print-this')
  );
});
