import assert from 'node:assert/strict';
import test from 'node:test';

import type { ApplicationLogEntry } from '@vynode/contracts';
import { PlexLoginService, type IdentityRecord } from '@vynode/identity';
import {
  PlexServerConfigurationService,
  type PlexServerConfiguration,
} from '@vynode/media-servers';
import { createOnboardingState, OnboardingService } from '@vynode/onboarding';

import {
  createControlPlane,
  isValidCronExpression,
  redactApplicationLogEntry,
} from './app.js';

const headerText = (value: string | string[] | undefined): string =>
  Array.isArray(value) ? value.join('; ') : (value ?? '');

test('application log redaction covers messages, nested data, and registered values', () => {
  const redacted = redactApplicationLogEntry(
    {
      id: 'log-sensitive',
      timestamp: '2026-07-25T00:00:00.000Z',
      level: 'error',
      message:
        'Request failed with Bearer header-token at https://example.test?apiKey=query-key and stored-value.',
      data: {
        apiKey: 'field-key',
        nested: {
          authorization: 'Basic field-token',
          safe: 'stored-value',
        },
        values: ['visible', 'stored-value'],
      },
    },
    ['stored-value']
  );

  const serialized = JSON.stringify(redacted);
  assert.doesNotMatch(
    serialized,
    /header-token|query-key|field-key|field-token|stored-value/
  );
  assert.match(serialized, /\[REDACTED\]/);
  assert.match(serialized, /visible/);
});

test('unexpected request failures are recorded without query-string data', async () => {
  const recorded: ApplicationLogEntry[] = [];
  const app = await createTestApp(undefined, {
    applicationLogs: {
      async list() { return recorded; },
      async appDataPath() { return '/data'; },
      async record(entry) { recorded.push(entry); },
    },
    async aboutInformation() { throw new Error('Unexpected diagnostic failure'); },
  });
  const response = await app.inject({
    method: 'GET',
    url: '/api/settings/about?token=must-not-be-recorded',
  });
  assert.equal(response.statusCode, 500);
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0]?.data?.path, '/api/settings/about');
  assert.doesNotMatch(JSON.stringify(recorded), /must-not-be-recorded/);
  await app.close();
});

test('health reports dependency failures without exposing internal details', async () => {
  const app = await createTestApp(undefined, {
    async healthCheck() { throw new Error('database path and credential details'); },
  });
  const response = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(response.statusCode, 503);
  assert.equal(response.json().status, 'unavailable');
  assert.doesNotMatch(response.body, /database path|credential/i);
  const apiResponse = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(apiResponse.statusCode, 503);
  assert.equal(apiResponse.json().status, 'unavailable');
  assert.doesNotMatch(apiResponse.body, /database path|credential/i);
  await app.close();
});

test('job schedules require valid numeric six-part CRON fields', () => {
  for (const expression of [
    '0 */10 * * * *',
    '0 15 */6 * * *',
    '0 0 0 1,15 * 1-5',
  ]) {
    assert.equal(isValidCronExpression(expression), true, expression);
  }
  for (const expression of [
    '* * * * *',
    '60 * * * * *',
    '0 */0 * * * *',
    '0 0 24 * * *',
    '0 0 0 * JAN *',
    'nonsense nonsense nonsense nonsense nonsense nonsense',
  ]) {
    assert.equal(isValidCronExpression(expression), false, expression);
  }
});

const createTestApp = async (
  collectionSurface?: NonNullable<
    Parameters<typeof createControlPlane>[0]['collectionSurface']
  >,
  options?: {
    activated?: boolean;
    sessionRole?: 'owner' | 'administrator' | 'operator' | 'viewer';
    collectionSourceValidator?: Parameters<
      typeof createControlPlane
    >[0]['collectionSourceValidator'];
    arrCollectionSources?: Parameters<
      typeof createControlPlane
    >[0]['arrCollectionSources'];
    apiKey?: string;
    allowedOrigin?: string;
    applicationLogs?: Parameters<typeof createControlPlane>[0]['applicationLogs'];
    aboutInformation?: Parameters<typeof createControlPlane>[0]['aboutInformation'];
    healthCheck?: Parameters<typeof createControlPlane>[0]['healthCheck'];
  }
) => {
  let onboarding = options?.activated
    ? {
        ...createOnboardingState('installation-1'),
        revision: 7,
        stage: 'review' as const,
        completed: [
          'deployment',
          'owner',
          'media-server',
          'sources',
          'downloads',
          'review',
        ] as const,
        activatedAt: '2026-07-25T00:00:00.000Z',
      }
    : createOnboardingState('installation-1');
  const identities = new Map<string, IdentityRecord>();
  const sessions = new Map<string, string>();
  let plexConfiguration: PlexServerConfiguration | undefined;
  const sessionRepository = {
    async rotateForUser(previous: string | undefined, userId: string) {
      if (previous) sessions.delete(previous);
      sessions.set('session-new', userId);
      return {
        sessionId: 'session-new',
        expiresAt: '2026-08-25T00:00:00.000Z',
      };
    },
    async revoke(sessionId: string) {
      sessions.delete(sessionId);
    },
    async resolve(sessionId: string) {
      const userId = sessions.get(sessionId);
          return userId
          ? {
            userId,
            role: options?.sessionRole ?? ('owner' as const),
            mediaServerScopes: [],
            sessionId,
          }
        : undefined;
    },
  };
  const plexLogin = new PlexLoginService(
    {
      async createPin() {
        return {
          providerPinId: 'plex-pin',
          code: 'code',
          authorizationUrl: 'https://app.plex.tv/auth',
          expiresAt: '2026-07-25T01:00:00.000Z',
        };
      },
      async pollPin() {
        return {
          token: 'secret',
          account: {
            id: 'plex-owner',
            email: 'owner@example.com',
            username: 'owner',
            hasPlexPass: false,
          },
        };
      },
      async accountForToken() {
        return {
          id: 'plex-owner',
          email: 'owner@example.com',
          username: 'owner',
          hasPlexPass: false,
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
    sessionRepository,
    {
      async store() {
        return 'vault:plex-owner';
      },
      async replace(reference) {
        return reference;
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

  return createControlPlane({
    onboarding: new OnboardingService({
      async get() {
        return onboarding;
      },
      async compareAndSet(expectedRevision, next) {
        if (onboarding.revision !== expectedRevision) return false;
        onboarding = next;
        return true;
      },
    }),
    plexLogin,
    plexServer: new PlexServerConfigurationService(
      {
        async get() {
          return plexConfiguration;
        },
        async compareAndSet(expectedRevision, next) {
          if ((plexConfiguration?.revision ?? 0) !== expectedRevision) {
            return false;
          }
          plexConfiguration = next;
          return true;
        },
      },
      {
        async observe() {
          return {
            machineIdentifier: 'machine-1',
            name: 'Living Room Plex',
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
    ),
    plexServerDirectory: {
      async discover() {
        return [
          {
            id: 'candidate-1',
            serverName: 'Living Room Plex',
            machineIdentifier: 'machine-1',
            input: {
              host: 'plex.local',
              port: 32400,
              transport: 'http',
              autoEmptyTrash: true,
            },
            local: true,
            reachable: true,
            latencyMs: 12,
          },
        ];
      },
    },
    async ownerPlexTokenReference() {
      return 'vault:plex-owner';
    },
    sessions: sessionRepository,
    ...(options?.allowedOrigin ? { allowedOrigin: options.allowedOrigin } : {}),
    ...(options?.applicationLogs ? { applicationLogs: options.applicationLogs } : {}),
    ...(options?.aboutInformation ? { aboutInformation: options.aboutInformation } : {}),
    ...(options?.healthCheck ? { healthCheck: options.healthCheck } : {}),
    ...(options?.apiKey ? {apiKeyAuthentication:{async authenticate(value:string){return value===options.apiKey?{userId:'api-key',role:'administrator' as const,mediaServerScopes:[],sessionId:'api-key'}:undefined;}}} : {}),
    ...(collectionSurface ? { collectionSurface } : {}),
    ...(options?.collectionSourceValidator
      ? { collectionSourceValidator: options.collectionSourceValidator }
      : {}),
    ...(options?.arrCollectionSources
      ? { arrCollectionSources: options.arrCollectionSources }
      : {}),
    production: true,
    now: () => new Date('2026-07-25T00:00:00.000Z'),
  });
};

test('collection source validation can return live provider metadata', async () => {
  const app = await createTestApp(undefined, {
    collectionSourceValidator: async (input) =>
      input.type === 'mdblist'
        ? {
            valid: true,
            title: 'Award Winners',
            contentType: 'mixed',
            message: 'MDBList verified: 36 items.',
          }
        : undefined,
  });
  const response = await app.inject({
    method: 'POST',
    url: '/api/collections/source/validate',
    payload: {
      type: 'mdblist',
      subtype: 'custom',
      customUrl: 'https://mdblist.com/lists/owner/awards',
    },
  });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(response.json(), {
    valid: true,
    title: 'Award Winners',
    contentType: 'mixed',
    message: 'MDBList verified: 36 items.',
  });
});

test('collection Arr source routes expose verified servers and live tags', async () => {
  const app = await createTestApp(undefined, {
    arrCollectionSources: {
      async servers(kind) {
        return [
          {
            id: `${kind}-1`,
            name: kind === 'radarr' ? 'Primary Radarr' : 'Primary Sonarr',
            kind,
          },
        ];
      },
      async tags(serverId) {
        return serverId === 'radarr-1'
          ? [{ id: 7, label: 'award-winners' }]
          : [];
      },
    },
  });

  const servers = await app.inject({
    method: 'GET',
    url: '/api/collection-sources/arr/radarr',
  });
  assert.equal(servers.statusCode, 200);
  assert.deepEqual(servers.json(), [
    { id: 'radarr-1', name: 'Primary Radarr', kind: 'radarr' },
  ]);

  const tags = await app.inject({
    method: 'GET',
    url: '/api/collection-sources/arr-server/radarr-1/tags',
  });
  assert.equal(tags.statusCode, 200);
  assert.deepEqual(tags.json(), [{ id: 7, label: 'award-winners' }]);
});

test('onboarding endpoints enforce optimistic concurrency', async () => {
  const app = await createTestApp();
  const first = await app.inject({
    method: 'POST',
    url: '/api/onboarding/events',
    payload: {
      expectedRevision: 0,
      event: { type: 'complete', stage: 'deployment' },
    },
  });
  assert.equal(first.statusCode, 200);

  const stale = await app.inject({
    method: 'POST',
    url: '/api/onboarding/events',
    payload: {
      expectedRevision: 0,
      event: { type: 'complete', stage: 'deployment' },
    },
  });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.json().current.revision, 1);
  await app.close();
});

test('Plex settings are verified with libraries before being returned', async () => {
  const app = await createTestApp();
  const saved = await app.inject({
    method: 'PUT',
    url: '/api/media-servers/plex',
    payload: {
      expectedRevision: 0,
      input: {
        host: 'plex.local',
        port: 32400,
        transport: 'http',
        webAppUrl: 'https://app.plex.tv/desktop',
        autoEmptyTrash: true,
      },
    },
  });
  assert.equal(saved.statusCode, 200);
  assert.equal(saved.json().machineIdentifier, 'machine-1');
  assert.equal(saved.json().libraries[0].title, 'Movies');

  const fetched = await app.inject({
    method: 'GET',
    url: '/api/media-servers/plex',
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json().revision, 1);
  await app.close();
});

test('Plex candidates are discovered through the owner account', async () => {
  const app = await createTestApp();
  const response = await app.inject({
    method: 'GET',
    url: '/api/media-servers/plex/candidates',
  });
  assert.equal(response.statusCode, 200);
  assert.equal(response.json()[0].serverName, 'Living Room Plex');
  assert.equal(response.json()[0].reachable, true);
  await app.close();
});

test('Plex login establishes an HTTP-only secure session', async () => {
  const app = await createTestApp();
  const begin = await app.inject({
    method: 'POST',
    url: '/api/auth/plex/attempts',
  });
  assert.equal(begin.statusCode, 200);
  const attemptId = begin.json().id as string;

  const poll = await app.inject({
    method: 'POST',
    url: `/api/auth/plex/attempts/${attemptId}/poll`,
  });
  assert.equal(poll.statusCode, 200);
  assert.equal(poll.json().state, 'authorized');
  const cookie = headerText(poll.headers['set-cookie']);
  assert.match(cookie, /vynode\.session=session-new/);
  assert.match(cookie, /HttpOnly/i);
  assert.match(cookie, /Secure/i);

  const me = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: 'vynode.session=session-new' },
  });
  assert.equal(me.statusCode, 200);
  assert.equal(me.json().role, 'owner');
  await app.close();
});

test('activated APIs enforce sessions and role levels on the server', async () => {
  const anonymousApp = await createTestApp(undefined, { activated: true });
  const anonymous = await anonymousApp.inject({
    method: 'GET',
    url: '/api/dashboard/summary',
  });
  assert.equal(anonymous.statusCode, 401);
  const publicWebhook = await anonymousApp.inject({
    method: 'POST',
    url: '/plex-webhook',
    payload: {},
  });
  assert.equal(publicWebhook.statusCode, 503);
  await anonymousApp.close();

  const signIn = async (
    app: Awaited<ReturnType<typeof createTestApp>>
  ): Promise<string> => {
    const begin = await app.inject({
      method: 'POST',
      url: '/api/auth/plex/attempts',
    });
    const poll = await app.inject({
      method: 'POST',
      url: `/api/auth/plex/attempts/${begin.json().id}/poll`,
    });
    return headerText(poll.headers['set-cookie']).split(';')[0]!;
  };

  const viewerApp = await createTestApp(undefined, {
    activated: true,
    sessionRole: 'viewer',
  });
  const viewerCookie = await signIn(viewerApp);
  const viewerRead = await viewerApp.inject({
    method: 'GET',
    url: '/api/dashboard/summary',
    headers: { cookie: viewerCookie },
  });
  assert.equal(viewerRead.statusCode, 503);
  const viewerMutation = await viewerApp.inject({
    method: 'POST',
    url: '/api/dashboard/missing-items/sync',
    headers: { cookie: viewerCookie },
  });
  assert.equal(viewerMutation.statusCode, 403);
  assert.equal(viewerMutation.json().code, 'insufficient-role');
  await viewerApp.close();

  const operatorApp = await createTestApp(undefined, {
    activated: true,
    sessionRole: 'operator',
  });
  const operatorCookie = await signIn(operatorApp);
  const operationalMutation = await operatorApp.inject({
    method: 'POST',
    url: '/api/dashboard/missing-items/sync',
    headers: { cookie: operatorCookie },
  });
  assert.equal(operationalMutation.statusCode, 503);
  const configurationMutation = await operatorApp.inject({
    method: 'PUT',
    url: '/api/settings/general',
    headers: { cookie: operatorCookie },
    payload: {},
  });
  assert.equal(configurationMutation.statusCode, 403);
  assert.match(configurationMutation.json().message, /Administrator/);
  await operatorApp.close();
});

test('activated APIs accept bearer and X-API-Key authentication',async()=>{
  const app=await createTestApp(undefined,{activated:true,apiKey:'automation-secret'});
  const unauthorized=await app.inject({method:'GET',url:'/api/dashboard/summary',headers:{'x-api-key':'wrong'}}); assert.equal(unauthorized.statusCode,401);
  const bearer=await app.inject({method:'GET',url:'/api/dashboard/summary',headers:{authorization:'Bearer automation-secret'}}); assert.equal(bearer.statusCode,503);
  const header=await app.inject({method:'PUT',url:'/api/settings/general',headers:{'x-api-key':'automation-secret'},payload:{}}); assert.equal(header.statusCode,503);
  await app.close();
});

test('browser mutations require the configured origin while API keys and webhooks remain supported', async () => {
  const origin = 'https://vynode.example.test';
  const app = await createTestApp(undefined, {
    activated: true,
    apiKey: 'automation-secret',
    allowedOrigin: origin,
  });
  const missingOrigin = await app.inject({
    method: 'POST',
    url: '/api/auth/plex/attempts',
  });
  assert.equal(missingOrigin.statusCode, 403);
  assert.equal(missingOrigin.json().code, 'csrf-origin-invalid');
  const foreignOrigin = await app.inject({
    method: 'POST',
    url: '/api/auth/plex/attempts',
    headers: { origin: 'https://attacker.example' },
  });
  assert.equal(foreignOrigin.statusCode, 403);
  const sameOrigin = await app.inject({
    method: 'POST',
    url: '/api/auth/plex/attempts',
    headers: { origin },
  });
  assert.equal(sameOrigin.statusCode, 200);
  const apiKeyMutation = await app.inject({
    method: 'PUT',
    url: '/api/settings/general',
    headers: { 'x-api-key': 'automation-secret' },
    payload: {},
  });
  assert.equal(apiKeyMutation.statusCode, 503);
  const webhook = await app.inject({
    method: 'POST',
    url: '/plex-webhook',
    payload: {},
  });
  assert.equal(webhook.statusCode, 503);
  const health = await app.inject({ method: 'GET', url: '/health' });
  assert.equal(health.headers['x-frame-options'], 'DENY');
  assert.match(String(health.headers['content-security-policy']), /frame-ancestors 'none'/);
  assert.match(String(health.headers['content-security-policy']), /img-src[^;]*https:\/\/image\.tmdb\.org/);
  await app.close();
});

test('logout revokes the session and clears the cookie', async () => {
  const app = await createTestApp();
  const begin = await app.inject({
    method: 'POST',
    url: '/api/auth/plex/attempts',
  });
  await app.inject({
    method: 'POST',
    url: `/api/auth/plex/attempts/${begin.json().id}/poll`,
  });

  const logout = await app.inject({
    method: 'POST',
    url: '/api/auth/logout',
    headers: { cookie: 'vynode.session=session-new' },
  });
  assert.equal(logout.statusCode, 204);
  assert.match(headerText(logout.headers['set-cookie']), /Max-Age=0/i);

  const me = await app.inject({
    method: 'GET',
    url: '/api/auth/me',
    headers: { cookie: 'vynode.session=session-new' },
  });
  assert.equal(me.statusCode, 401);
  await app.close();
});

test('collection link routes validate payloads and expose atomic conflict responses', async () => {
  const calls: { masterId: string; memberIds: readonly string[] }[] = [];
  const reorderCalls: {
    firstId: string;
    secondId: string;
    orderKey: 'sharedOrder' | 'libraryOrder';
  }[] = [];
  const app = await createTestApp({
    async get() {
      return {
        libraries: [],
        collections: [],
        timestamp: '2026-07-25T00:00:00.000Z',
      };
    },
    async updatePlacement() {
      return undefined;
    },
    async reorderPlacement(firstId, secondId, orderKey) {
      reorderCalls.push({ firstId, secondId, orderKey });
      return firstId !== 'stale';
    },
    async save() {
      return undefined;
    },
    async copy() {
      return undefined;
    },
    async delete() {
      return false;
    },
    async link(masterId, memberIds) {
      calls.push({ masterId, memberIds });
      if (memberIds.includes('incompatible')) return undefined;
      return { groupId: 'group-1', collections: [] };
    },
    async unlink(id) {
      return id === 'linked'
        ? { groupId: 'group-1', collections: [] }
        : undefined;
    },
    async discoverPlex() {
      return {
        imported: [],
        totalHubs: 1,
        totalPreExistingCollections: 1,
        validated: 2,
        missingIds: [],
        completedAt: '2026-07-25T00:00:00.000Z',
      };
    },
    async updateDiscoveredPlexItem() {
      return undefined;
    },
    async linkDiscoveredPlexItems(_masterId, memberIds) {
      return memberIds.includes('compatible')
        ? { groupId: 'plex-group-1', items: [] }
        : undefined;
    },
    async unlinkDiscoveredPlexItems(id) {
      return id === 'linked-plex'
        ? { groupId: 'plex-group-1', items: [] }
        : undefined;
    },
    async cleanupMissingPlexItems() {
      return { cleanupCount: 1, plexHubDeleteCount: 1, warnings: [] };
    },
    async searchPlexItems(libraryId, query) {
      return [
        {
          ratingKey: '614',
          title: `Match for ${query}`,
          year: 2026,
          type: 'movie',
          libraryId,
          libraryName: 'Movies',
        },
      ];
    },
  });

  const shortSearch = await app.inject({
    method: 'GET',
    url: '/api/collections/plex-items?libraryId=1&query=a',
  });
  assert.equal(shortSearch.statusCode, 400);
  const invalidLibrarySearch = await app.inject({
    method: 'GET',
    url: '/api/collections/plex-items?libraryId=movies&query=the',
  });
  assert.equal(invalidLibrarySearch.statusCode, 400);
  const plexSearch = await app.inject({
    method: 'GET',
    url: '/api/collections/plex-items?libraryId=1&query=the',
  });
  assert.equal(plexSearch.statusCode, 200);
  assert.equal(plexSearch.json().results[0].ratingKey, '614');

  const invalidReorder = await app.inject({
    method: 'POST',
    url: '/api/collections/placement/reorder',
    payload: {
      firstId: 'same',
      secondId: 'same',
      orderKey: 'sharedOrder',
    },
  });
  assert.equal(invalidReorder.statusCode, 400);
  assert.equal(reorderCalls.length, 0);

  const reordered = await app.inject({
    method: 'POST',
    url: '/api/collections/placement/reorder',
    payload: {
      firstId: 'first',
      secondId: 'second',
      orderKey: 'libraryOrder',
    },
  });
  assert.equal(reordered.statusCode, 204);
  assert.deepEqual(reorderCalls[0], {
    firstId: 'first',
    secondId: 'second',
    orderKey: 'libraryOrder',
  });

  const staleReorder = await app.inject({
    method: 'POST',
    url: '/api/collections/placement/reorder',
    payload: {
      firstId: 'stale',
      secondId: 'second',
      orderKey: 'sharedOrder',
    },
  });
  assert.equal(staleReorder.statusCode, 409);

  const malformed = await app.inject({
    method: 'POST',
    url: '/api/collections/master/link',
    payload: { memberIds: 'other' },
  });
  assert.equal(malformed.statusCode, 400);
  assert.equal(calls.length, 0);

  const linked = await app.inject({
    method: 'POST',
    url: '/api/collections/master/link',
    payload: { memberIds: ['other'] },
  });
  assert.equal(linked.statusCode, 200);
  assert.equal(linked.json().groupId, 'group-1');
  assert.deepEqual(calls[0], { masterId: 'master', memberIds: ['other'] });

  const incompatible = await app.inject({
    method: 'POST',
    url: '/api/collections/master/link',
    payload: { memberIds: ['incompatible'] },
  });
  assert.equal(incompatible.statusCode, 409);

  const unlinked = await app.inject({
    method: 'POST',
    url: '/api/collections/not-linked/unlink',
  });
  assert.equal(unlinked.statusCode, 409);

  const discovery = await app.inject({
    method: 'POST',
    url: '/api/collections/discovery/scan',
  });
  assert.equal(discovery.statusCode, 200);
  assert.equal(discovery.json().validated, 2);

  const invalidDiscoveredUpdate = await app.inject({
    method: 'PUT',
    url: '/api/collections/discovery/items/item-1',
    payload: {
      homeOrder: -1,
      libraryOrder: 0,
      visibility: {
        usersHome: true,
        serverOwnerHome: false,
        libraryRecommended: false,
      },
      timeRestriction: {
        alwaysActive: true,
        removeFromPlexWhenInactive: false,
        inactiveVisibility: {
          usersHome: false,
          serverOwnerHome: false,
          libraryRecommended: false,
        },
        dateRanges: [],
        weeklySchedule: {
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: true,
          sunday: true,
        },
      },
    },
  });
  assert.equal(invalidDiscoveredUpdate.statusCode, 400);

  const invalidDiscoveredDate = await app.inject({
    method: 'PUT',
    url: '/api/collections/discovery/items/item-1',
    payload: {
      homeOrder: 1,
      libraryOrder: 0,
      visibility: {
        usersHome: true,
        serverOwnerHome: false,
        libraryRecommended: false,
      },
      timeRestriction: {
        alwaysActive: false,
        removeFromPlexWhenInactive: false,
        inactiveVisibility: {
          usersHome: false,
          serverOwnerHome: false,
          libraryRecommended: false,
        },
        dateRanges: [{ startDate: '99-99', endDate: '05-01' }],
        weeklySchedule: {
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: true,
          sunday: true,
        },
      },
    },
  });
  assert.equal(invalidDiscoveredDate.statusCode, 400);

  const invalidDiscoveredArtwork = await app.inject({
    method: 'PUT',
    url: '/api/collections/discovery/items/item-1',
    payload: {
      homeOrder: 1,
      libraryOrder: 0,
      visibility: {
        usersHome: true,
        serverOwnerHome: false,
        libraryRecommended: false,
      },
      timeRestriction: {
        alwaysActive: true,
        removeFromPlexWhenInactive: false,
        inactiveVisibility: {
          usersHome: false,
          serverOwnerHome: false,
          libraryRecommended: false,
        },
        dateRanges: [],
        weeklySchedule: {
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: true,
          sunday: true,
        },
      },
      posterSettings: {
        autoGenerate: false,
        applyOverlaysDuringSync: false,
        useTmdbFranchisePoster: false,
        hideIndividualItems: false,
      },
      metadataSettings: {
        enableCustomSummary: true,
        customSummary: '',
        enableCustomWallpaper: false,
        enableCustomTheme: false,
      },
    },
  });
  assert.equal(invalidDiscoveredArtwork.statusCode, 400);

  const missingDiscoveredUpdate = await app.inject({
    method: 'PUT',
    url: '/api/collections/discovery/items/item-1',
    payload: {
      homeOrder: 1,
      libraryOrder: 0,
      visibility: {
        usersHome: true,
        serverOwnerHome: false,
        libraryRecommended: false,
      },
      timeRestriction: {
        alwaysActive: true,
        removeFromPlexWhenInactive: false,
        inactiveVisibility: {
          usersHome: false,
          serverOwnerHome: false,
          libraryRecommended: false,
        },
        dateRanges: [],
        weeklySchedule: {
          monday: true,
          tuesday: true,
          wednesday: true,
          thursday: true,
          friday: true,
          saturday: true,
          sunday: true,
        },
      },
    },
  });
  assert.equal(missingDiscoveredUpdate.statusCode, 404);

  const cleanup = await app.inject({
    method: 'DELETE',
    url: '/api/collections/discovery/missing',
  });
  assert.equal(cleanup.statusCode, 200);
  assert.equal(cleanup.json().cleanupCount, 1);

  const malformedPlexLink = await app.inject({
    method: 'POST',
    url: '/api/collections/discovery/items/master/link',
    payload: { memberIds: [] },
  });
  assert.equal(malformedPlexLink.statusCode, 400);

  const linkedPlex = await app.inject({
    method: 'POST',
    url: '/api/collections/discovery/items/master/link',
    payload: { memberIds: ['compatible'] },
  });
  assert.equal(linkedPlex.statusCode, 200);
  assert.equal(linkedPlex.json().groupId, 'plex-group-1');

  const incompatiblePlex = await app.inject({
    method: 'POST',
    url: '/api/collections/discovery/items/master/link',
    payload: { memberIds: ['incompatible'] },
  });
  assert.equal(incompatiblePlex.statusCode, 409);

  const unlinkedPlex = await app.inject({
    method: 'POST',
    url: '/api/collections/discovery/items/linked-plex/unlink',
  });
  assert.equal(unlinkedPlex.statusCode, 200);

  const notLinkedPlex = await app.inject({
    method: 'POST',
    url: '/api/collections/discovery/items/not-linked/unlink',
  });
  assert.equal(notLinkedPlex.statusCode, 409);
  await app.close();
});
