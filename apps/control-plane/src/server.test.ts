import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildProductionControlPlane } from './server.js';

test('builds the production control plane with durable onboarding and redacted diagnostics', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-server-'));
  const masterKey = Buffer.alloc(32, 6).toString('base64');
  try {
    const built = await buildProductionControlPlane({
      VYNODE_DATA_DIR: directory,
      VYNODE_PUBLIC_URL: 'http://127.0.0.1:7171',
      VYNODE_MASTER_KEY: masterKey,
      VYNODE_VERSION: '1.2.3',
      VYNODE_LATEST_VERSION: '1.2.4',
      VYNODE_BUILD: 'test-build',
      VYNODE_COMMIT: 'abc123',
    });
    const health = await built.app.inject({ method: 'GET', url: '/health' });
    assert.equal(health.statusCode, 200);
    assert.equal(health.json().status, 'ok');
    const onboarding = await built.app.inject({ method: 'GET', url: '/api/onboarding' });
    assert.equal(onboarding.statusCode, 200);
    assert.equal(onboarding.json().installationId, built.runtime.installationId);

    const about = await built.app.inject({ method: 'GET', url: '/api/settings/about' });
    assert.equal(about.statusCode, 200);
    assert.equal(about.json().version, '1.2.3');
    assert.equal(about.json().build, 'test-build');
    assert.equal(about.json().commit, 'abc123');
    assert.equal(about.json().updateAvailable, true);
    assert.equal(about.json().latestVersion, '1.2.4');
    assert.equal(about.json().sourceUrl, 'https://github.com/minerport/VynodeTemplateArr');

    const logs = await built.app.inject({ method: 'GET', url: '/api/settings/logs' });
    assert.equal(logs.statusCode, 200);
    assert.ok(logs.json().results.some((entry: { label: string }) => entry.label === 'runtime.start'));
    const diagnostic = await built.app.inject({ method: 'GET', url: '/api/settings/logs/export' });
    assert.equal(diagnostic.statusCode, 200);
    assert.match(String(diagnostic.headers['content-disposition']), /vynode-debug\.json/);
    assert.equal(diagnostic.json().system.version, '1.2.3');
    assert.equal(diagnostic.headers['cache-control'], 'no-store');
    assert.doesNotMatch(diagnostic.body, new RegExp(masterKey.replace(/[+/=]/g, '\\$&')));

    const initialPolicy = await built.app.inject({ method: 'GET', url: '/api/fetching-policy' });
    assert.deepEqual(initialPolicy.json(), {
      revision: 0,
      letterboxdUsePlainHttp: false,
      flixpatrolUsePlainHttp: false,
    });
    const savedPolicy = await built.app.inject({
      method: 'PUT',
      url: '/api/fetching-policy',
      headers: { origin: 'http://127.0.0.1:7171' },
      payload: {
        expectedRevision: 0,
        letterboxdUsePlainHttp: true,
        flixpatrolUsePlainHttp: false,
      },
    });
    assert.equal(savedPolicy.statusCode, 200);
    assert.equal(savedPolicy.json().revision, 1);
    await built.close();

    const reopened = await buildProductionControlPlane({
      VYNODE_DATA_DIR: directory,
      VYNODE_PUBLIC_URL: 'http://127.0.0.1:7171',
      VYNODE_MASTER_KEY: masterKey,
    });
    const restoredPolicy = await reopened.app.inject({ method: 'GET', url: '/api/fetching-policy' });
    assert.equal(restoredPolicy.json().revision, 1);
    assert.equal(restoredPolicy.json().letterboxdUsePlainHttp, true);
    const restoredLogs = await reopened.app.inject({ method: 'GET', url: '/api/settings/logs' });
    assert.equal(restoredLogs.statusCode, 200);
    assert.ok(restoredLogs.json().results.some((entry: { label: string }) => entry.label === 'runtime.start'));
    await reopened.close();
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
