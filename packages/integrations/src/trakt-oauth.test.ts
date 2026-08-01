import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FetchTraktOAuthTransport,
  ResilientTraktOAuthTransport,
  TraktOAuthService,
  type TraktOAuthTokens,
  type TraktOAuthTransport,
} from './trakt-oauth.js';

test('falls back to server-side browser OAuth only for Cloudflare blocks', async () => {
  const calls: string[] = [];
  const browser: TraktOAuthTransport = {
    async exchange() {
      calls.push('browser');
      return response;
    },
    async refresh() {
      calls.push('browser');
      return response;
    },
  };
  const blocked: TraktOAuthTransport = {
    async exchange() {
      calls.push('direct');
      throw new Error('Trakt API access was blocked by its Cloudflare protection.');
    },
    async refresh() {
      calls.push('direct');
      throw new Error('Trakt API access was blocked by its Cloudflare protection.');
    },
  };
  await new ResilientTraktOAuthTransport(blocked, browser).refresh({
    refreshToken: 'refresh',
    clientId: 'client',
    clientSecret: 'secret',
    redirectUri: 'http://localhost:5174/settings/sources',
  });
  assert.deepEqual(calls, ['direct', 'browser']);

  calls.length = 0;
  const rejected: TraktOAuthTransport = {
    async exchange() {
      calls.push('direct');
      throw new Error('Trakt rejected the OAuth application credentials.');
    },
    async refresh() {
      calls.push('direct');
      throw new Error('Trakt rejected the OAuth application credentials.');
    },
  };
  await assert.rejects(
    new ResilientTraktOAuthTransport(rejected, browser).refresh({
      refreshToken: 'refresh',
      clientId: 'client',
      clientSecret: 'secret',
      redirectUri: 'http://localhost:5174/settings/sources',
    }),
    /credentials/
  );
  assert.deepEqual(calls, ['direct']);
});

const response = {
  access_token: 'access',
  refresh_token: 'refresh',
  expires_in: 3600,
  created_at: 1_700_000_000,
  token_type: 'bearer',
};

test('sends Trakt application headers during the OAuth token exchange', async () => {
  const originalFetch = globalThis.fetch;
  let headers: Headers | undefined;
  globalThis.fetch = (async (_url, init) => {
    headers = new Headers(init?.headers);
    return new Response(JSON.stringify(response), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  }) as typeof fetch;
  try {
    await new FetchTraktOAuthTransport().exchange({
      code: 'code',
      clientId: 'client-id',
      clientSecret: 'client-secret',
      redirectUri: 'http://localhost:5174/settings/sources',
    });
    assert.equal(headers?.get('trakt-api-key'), 'client-id');
    assert.equal(headers?.get('trakt-api-version'), '2');
    assert.equal(headers?.get('content-type'), 'application/json');
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('distinguishes a Cloudflare HTML block from a Trakt credential rejection', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response('<html>blocked</html>', {
      status: 403,
      headers: {
        'content-type': 'text/html; charset=UTF-8',
        server: 'cloudflare',
      },
    })) as typeof fetch;
  try {
    await assert.rejects(
      new FetchTraktOAuthTransport().exchange({
        code: 'code',
        clientId: 'client-id',
        clientSecret: 'client-secret',
        redirectUri: 'http://localhost:5174/settings/sources',
      }),
      /Cloudflare protection/
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('creates a bounded state-bearing Trakt authorization URL and exchanges it once', async () => {
  let stored: TraktOAuthTokens | undefined;
  let exchangedRedirect = '';
  const transport: TraktOAuthTransport = {
    async exchange(input) {
      exchangedRedirect = input.redirectUri;
      return response;
    },
    async refresh() {
      return response;
    },
  };
  const service = new TraktOAuthService(
    {
      async get() {
        return stored;
      },
      async save(tokens) {
        stored = tokens;
      },
      async delete() {
        stored = undefined;
      },
    },
    async () => ({ clientId: 'client', clientSecret: 'secret' }),
    () => new Date('2024-01-01T00:00:00.000Z'),
    transport
  );
  const attempt = await service.begin(
    'http://localhost:5174/settings/sources'
  );
  const url = new URL(attempt.authorizeUrl);
  assert.equal(url.origin, 'https://trakt.tv');
  assert.equal(url.searchParams.get('client_id'), 'client');
  assert.equal(url.searchParams.get('state'), attempt.state);
  assert.equal(url.searchParams.has('client_secret'), false);

  assert.deepEqual(
    await service.exchange(' code ', attempt.state),
    {
      connected: true,
      expiresAt: '2023-11-14T23:13:20.000Z',
    }
  );
  assert.equal(
    exchangedRedirect,
    'http://localhost:5174/settings/sources'
  );
  await assert.rejects(
    service.exchange('code', attempt.state),
    /already used/
  );
});

test('rejects unsafe redirect URLs and expired state', async () => {
  let now = new Date('2024-01-01T00:00:00.000Z');
  const service = new TraktOAuthService(
    {
      async get() {
        return undefined;
      },
      async save() {},
      async delete() {},
    },
    async () => ({ clientId: 'client', clientSecret: 'secret' }),
    () => now,
    {
      async exchange() {
        return response;
      },
      async refresh() {
        return response;
      },
    },
    1
  );
  await assert.rejects(
    service.begin('http://public.example/callback'),
    /HTTPS/
  );
  await assert.rejects(
    service.begin('http://localhost:5174/settings/sources?oauth=trakt'),
    /query string/
  );
  const attempt = await service.begin('http://localhost:5174/settings/sources');
  now = new Date(now.getTime() + 2);
  await assert.rejects(service.exchange('code', attempt.state), /expired/);
});

test('serializes refreshes and persists rotated Trakt tokens', async () => {
  let refreshCalls = 0;
  let stored: TraktOAuthTokens | undefined = {
    accessToken: 'old',
    refreshToken: 'old-refresh',
    expiresAt: '2024-01-01T00:00:30.000Z',
    tokenType: 'bearer',
  };
  const service = new TraktOAuthService(
    {
      async get() {
        return stored;
      },
      async save(tokens) {
        stored = tokens;
      },
      async delete() {
        stored = undefined;
      },
    },
    async () => ({ clientId: 'client', clientSecret: 'secret' }),
    () => new Date('2024-01-01T00:00:00.000Z'),
    {
      async exchange() {
        return response;
      },
      async refresh() {
        refreshCalls += 1;
        await Promise.resolve();
        return {
          ...response,
          access_token: 'rotated',
          refresh_token: 'rotated-refresh',
          created_at: 1_704_067_200,
        };
      },
    }
  );
  const [first, second, manual] = await Promise.all([
    service.accessToken('http://localhost:5174/settings/sources'),
    service.accessToken('http://localhost:5174/settings/sources'),
    service.refreshNow('http://localhost:5174/settings/sources'),
  ]);
  assert.equal(first, 'rotated');
  assert.equal(second, 'rotated');
  assert.equal(manual.connected, true);
  assert.equal(refreshCalls, 1);
  assert.equal(stored?.refreshToken, 'rotated-refresh');
  const refreshed = await service.refreshNow(
    'http://localhost:5174/settings/sources'
  );
  assert.equal(refreshed.connected, true);
  assert.equal(refreshCalls, 2);
  await service.disconnect();
  assert.equal(stored, undefined);
});

test('bounds pending authorization attempts and purges expired states', async () => {
  let now = new Date('2024-01-01T00:00:00.000Z');
  const service = new TraktOAuthService(
    {
      async get() {
        return undefined;
      },
      async save() {},
      async delete() {},
    },
    async () => ({ clientId: 'client', clientSecret: 'secret' }),
    () => now,
    {
      async exchange() {
        return response;
      },
      async refresh() {
        return response;
      },
    },
    10,
    2
  );
  const first = await service.begin(
    'http://localhost:5174/settings/sources'
  );
  const second = await service.begin(
    'http://localhost:5174/settings/sources'
  );
  const third = await service.begin(
    'http://localhost:5174/settings/sources'
  );
  await assert.rejects(service.exchange('code', first.state), /missing/);
  assert.equal((await service.exchange('code', second.state)).connected, true);

  const expiring = await service.begin(
    'http://localhost:5174/settings/sources'
  );
  now = new Date(now.getTime() + 11);
  const current = await service.begin(
    'http://localhost:5174/settings/sources'
  );
  await assert.rejects(service.exchange('code', expiring.state), /missing/);
  await assert.rejects(service.exchange('code', third.state), /missing/);
  assert.equal((await service.exchange('code', current.state)).connected, true);
});
