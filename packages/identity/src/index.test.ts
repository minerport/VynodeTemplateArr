import assert from 'node:assert/strict';
import test from 'node:test';

import type { RoutePolicy } from '@vynode/contracts';

import {
  authorizeRoute,
  PlexLoginService,
  type IdentityRecord,
} from './index.js';

const protectedPolicy: RoutePolicy = {
  authentication: 'authenticated',
  onboarding: 'activated-only',
};

test('route policy sends incomplete installations to setup', () => {
  assert.deepEqual(
    authorizeRoute(protectedPolicy, { onboardingActivated: false }),
    {
      allowed: false,
      status: 302,
      reason: 'onboarding-required',
      redirectTo: '/setup',
    }
  );
});

test('route policy rejects a viewer when an operator role is required', () => {
  assert.deepEqual(
    authorizeRoute(
      {
        authentication: 'authenticated',
        onboarding: 'activated-only',
        roles: ['operator'],
      },
      {
        onboardingActivated: true,
        principal: {
          userId: 'viewer',
          role: 'viewer',
          mediaServerScopes: [],
          sessionId: 'session',
        },
      }
    ),
    { allowed: false, status: 403, reason: 'insufficient-role' }
  );
});

test('first Plex identity becomes owner and session is rotated', async () => {
  const identities = new Map<string, IdentityRecord>();
  const storedSecrets: string[] = [];
  const service = new PlexLoginService(
    {
      async createPin() {
        return {
          providerPinId: 'pin-1',
          code: 'code',
          authorizationUrl: 'https://app.plex.tv/auth',
          expiresAt: '2026-07-25T01:00:00.000Z',
        };
      },
      async pollPin() {
        return {
          token: 'secret-token',
          account: {
            id: 'plex-1',
            email: 'OWNER@EXAMPLE.COM',
            username: 'owner',
            hasPlexPass: true,
          },
        };
      },
      async accountForToken() {
        return {
          id: 'plex-1',
          email: 'OWNER@EXAMPLE.COM',
          username: 'owner',
          hasPlexPass: true,
        };
      },
    },
    {
      async count() {
        return identities.size;
      },
      async findByPlexAccountId(id) {
        return [...identities.values()].find(
          (identity) => identity.plexAccountId === id
        );
      },
      async findById(id) {
        return identities.get(id);
      },
      async save(identity) {
        identities.set(identity.id, identity);
      },
      async transaction(operation) {
        return operation();
      },
    },
    {
      async rotateForUser(previousSessionId, userId) {
        assert.equal(previousSessionId, 'old-session');
        assert.equal(userId, 'owner');
        return {
          sessionId: 'new-session',
          expiresAt: '2026-08-25T00:00:00.000Z',
        };
      },
      async revoke() {},
    },
    {
      async store(secret) {
        storedSecrets.push(secret);
        return 'vault:token-1';
      },
      async replace(_reference, secret) {
        storedSecrets.push(secret);
        return 'vault:token-2';
      },
    },
    {
      async canSignIn() {
        return true;
      },
      async allowAutomaticSharedUserCreation() {
        return false;
      },
    },
    { now: () => new Date('2026-07-25T00:00:00.000Z') }
  );

  const attempt = await service.begin();
  const result = await service.poll(attempt.id, 'old-session');

  assert.equal(result.attempt.state, 'authorized');
  assert.equal(result.attempt.userId, 'owner');
  assert.deepEqual(storedSecrets, ['secret-token']);
  assert.equal(identities.get('owner')?.role, 'owner');
  assert.equal(
    identities.get('owner')?.verifiedEmail,
    'owner@example.com'
  );
  assert.ok('session' in result);
});

test('expired login attempts never poll the provider', async () => {
  let polled = false;
  const service = new PlexLoginService(
    {
      async createPin() {
        return {
          providerPinId: 'pin-expired',
          code: 'code',
          authorizationUrl: 'https://app.plex.tv/auth',
          expiresAt: '2026-07-24T00:00:00.000Z',
        };
      },
      async pollPin() {
        polled = true;
        return undefined;
      },
      async accountForToken() {
        throw new Error('not expected');
      },
    },
    {
      async count() {
        return 0;
      },
      async findByPlexAccountId() {
        return undefined;
      },
      async findById() {
        return undefined;
      },
      async save() {},
      async transaction(operation) {
        return operation();
      },
    },
    {
      async rotateForUser() {
        throw new Error('not expected');
      },
      async revoke() {},
    },
    {
      async store() {
        throw new Error('not expected');
      },
      async replace() {
        throw new Error('not expected');
      },
    },
    {
      async canSignIn() {
        return false;
      },
      async allowAutomaticSharedUserCreation() {
        return false;
      },
    },
    { now: () => new Date('2026-07-25T00:00:00.000Z') }
  );

  const attempt = await service.begin();
  const result = await service.poll(attempt.id);

  assert.equal(result.attempt.state, 'expired');
  assert.equal(polled, false);
});
