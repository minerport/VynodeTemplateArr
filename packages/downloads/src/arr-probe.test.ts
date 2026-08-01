import assert from 'node:assert/strict';
import test from 'node:test';
import { HttpArrProbe } from './arr-probe.js';
import { DownloadConfigurationError, type ArrEndpointDraft } from './index.js';

const endpoint: ArrEndpointDraft = {
  kind: 'radarr',
  name: 'Movies',
  hostname: 'radarr.local',
  port: 7878,
  useSsl: false,
  apiKey: 'secret',
  urlBase: '',
};

test('HttpArrProbe loads real Arr connection options', async () => {
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    calls.push(String(input));
    assert.equal(
      (init?.headers as Record<string, string>)['X-Api-Key'],
      'secret'
    );
    const path = new URL(String(input)).pathname;
    const body =
      path.endsWith('/system/status')
        ? { version: '6.3.0' }
        : path.endsWith('/qualityprofile')
          ? [{ id: 1, name: 'HD-1080p' }]
          : path.endsWith('/rootfolder')
            ? [{ id: 2, path: '/movies' }]
            : [{ id: 3, label: 'vynode' }];
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
  try {
    const result = await new HttpArrProbe().inspect(endpoint);
    assert.equal(result.serviceVersion, '6.3.0');
    assert.deepEqual(result.profiles, [{ id: 1, name: 'HD-1080p' }]);
    assert.deepEqual(result.rootFolders, [{ id: 2, path: '/movies' }]);
    assert.deepEqual(result.tags, [{ id: 3, label: 'vynode' }]);
    assert.equal(calls.length, 4);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('HttpArrProbe reports rejected API keys without exposing them', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('{}', { status: 401 })) as typeof fetch;
  try {
    await assert.rejects(
      new HttpArrProbe().inspect(endpoint),
      (error: unknown) =>
        error instanceof DownloadConfigurationError &&
        error.code === 'invalid-endpoint' &&
        error.message === 'Radarr rejected the API key.' &&
        !error.message.includes(endpoint.apiKey)
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
