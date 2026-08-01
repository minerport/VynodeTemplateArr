import assert from 'node:assert/strict';
import test from 'node:test';

import {
  IntegrationConfigurationError,
  IntegrationConfigurationService,
  type IntegrationId,
  type IntegrationRepository,
} from './index.js';

const harness = () => {
  const records = new Map<IntegrationId, any>();
  const secrets = new Map<string, string>();
  let tests = 0;
  let clock = new Date('2026-07-25T00:00:00.000Z');
  const repository: IntegrationRepository = {
    async get(id) {
      return records.get(id);
    },
    async compareAndSet(id, expected, next) {
      if ((records.get(id)?.revision ?? 0) !== expected) return false;
      records.set(id, next);
      return true;
    },
    async delete(id, expected) {
      if (records.get(id)?.revision !== expected) return false;
      return records.delete(id);
    },
  };
  const service = new IntegrationConfigurationService(
    repository,
    {
      async store(secret) {
        const reference = `vault:${secrets.size + 1}`;
        secrets.set(reference, secret);
        return reference;
      },
      async remove(reference) {
        secrets.delete(reference);
      },
    },
    {
      async test() {
        tests += 1;
      },
    },
    () => clock,
    1_000
  );
  return {
    service,
    records,
    secrets,
    tests: () => tests,
    advance: () => {
      clock = new Date(clock.getTime() + 2_000);
    },
  };
};

test('testing a draft never mutates active configuration', async () => {
  const state = harness();
  await state.service.test({ id: 'myanimelist', apiKey: 'draft-secret' });
  assert.equal(state.tests(), 1);
  assert.equal(state.records.size, 0);
  assert.equal(state.secrets.size, 0);
});

test('save requires the exact successfully tested draft', async () => {
  const state = harness();
  const tested = await state.service.test({
    id: 'tautulli',
    hostname: 'TAUTULLI.local',
    port: 8181,
    useSsl: false,
    urlBase: 'tautulli/',
    externalUrl: 'https://stats.example.test/',
    apiKey: 'secret',
  });
  await assert.rejects(
    state.service.save({
      expectedRevision: 0,
      verificationReceipt: tested.verificationReceipt,
      draft: {
        id: 'tautulli',
        hostname: 'tautulli.local',
        port: 8182,
        useSsl: false,
        urlBase: '/tautulli',
        externalUrl: 'https://stats.example.test',
        apiKey: 'secret',
      },
    }),
    (error: unknown) =>
      error instanceof IntegrationConfigurationError &&
      error.code === 'verification-required'
  );
});

test('reads expose configuration but never secret material', async () => {
  const state = harness();
  const draft = { id: 'mdblist' as const, apiKey: 'top-secret' };
  const tested = await state.service.test(draft);
  const saved = await state.service.save({
    expectedRevision: 0,
    draft,
    verificationReceipt: tested.verificationReceipt,
  });
  assert.equal(saved.secretConfigured, true);
  assert.equal(JSON.stringify(saved).includes('top-secret'), false);
  assert.equal(state.secrets.size, 1);
});

test('expired verification receipts and stale revisions are rejected', async () => {
  const state = harness();
  const draft = { id: 'myanimelist' as const, apiKey: 'secret' };
  const expired = await state.service.test(draft);
  state.advance();
  await assert.rejects(
    state.service.save({
      expectedRevision: 0,
      draft,
      verificationReceipt: expired.verificationReceipt,
    }),
    (error: unknown) =>
      error instanceof IntegrationConfigurationError &&
      error.code === 'verification-expired'
  );
});

test('switching Trakt to public-only mode removes the stored OAuth secret', async () => {
  const state = harness();
  const oauth = {
    id: 'trakt' as const,
    clientId: 'client',
    clientSecret: 'oauth-secret',
    mode: 'oauth' as const,
  };
  const oauthTest = await state.service.test(oauth);
  const saved = await state.service.save({
    expectedRevision: 0,
    draft: oauth,
    verificationReceipt: oauthTest.verificationReceipt,
  });
  assert.equal(saved.secretConfigured, true);
  assert.equal(state.secrets.size, 1);

  const basic = {
    id: 'trakt' as const,
    clientId: 'client',
    mode: 'basic' as const,
  };
  const basicTest = await state.service.test(basic);
  const updated = await state.service.save({
    expectedRevision: saved.revision,
    draft: basic,
    verificationReceipt: basicTest.verificationReceipt,
  });
  assert.equal(updated.secretConfigured, false);
  assert.equal(state.secrets.size, 0);
});
