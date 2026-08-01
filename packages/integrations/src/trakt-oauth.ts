import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';

export interface TraktOAuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  scope?: string;
  tokenType: string;
}

export interface TraktOAuthStatus {
  connected: boolean;
  expiresAt?: string;
}

export interface TraktOAuthRepository {
  get(): Promise<TraktOAuthTokens | undefined>;
  save(tokens: TraktOAuthTokens): Promise<void>;
  delete(): Promise<void>;
}

export interface TraktOAuthCredentials {
  clientId: string;
  clientSecret: string;
}

export interface TraktOAuthTransport {
  exchange(input: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
  refresh(input: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    signal?: AbortSignal;
  }): Promise<unknown>;
}

export class FetchTraktOAuthTransport implements TraktOAuthTransport {
  public constructor(private readonly baseUrl = 'https://api.trakt.tv') {}

  private async token(
    body: Record<string, string>,
    signal?: AbortSignal
  ): Promise<unknown> {
    const clientId = body.client_id;
    if (!clientId) throw new Error('Trakt Client ID is required.');
    const response = await fetch(`${this.baseUrl}/oauth/token`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'trakt-api-key': clientId,
        'trakt-api-version': '2',
        'user-agent': 'Vynode/1.0',
      },
      body: JSON.stringify(body),
      ...(signal ? { signal } : {}),
    });
    if (!response.ok) {
      const contentType = response.headers.get('content-type') ?? '';
      // Do not include Trakt's response body: OAuth error payloads can echo
      // submitted values. Status-specific text remains safe for the UI.
      throw new Error(
        response.status === 403 && !contentType.includes('json')
          ? 'Trakt API access was blocked by its Cloudflare protection. Wait briefly or change the network route, then try again.'
          : response.status === 401
          ? 'Trakt rejected the application credentials or authorization code.'
          : response.status === 403
            ? 'Trakt rejected the Client ID or has not approved this application.'
          : `Trakt authorization failed with status ${response.status}.`
      );
    }
    return response.json();
  }

  public exchange(input: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    return this.token(
      {
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
      },
      input.signal
    );
  }

  public refresh(input: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    return this.token(
      {
        refresh_token: input.refreshToken,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: 'refresh_token',
      },
      input.signal
    );
  }
}

const traktOAuthBrowserExecutable = (): string | undefined => {
  const configured = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH?.trim();
  if (configured) return configured;
  if (process.platform !== 'win32') return undefined;
  const candidates = [
    `${process.env.PROGRAMFILES ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env['PROGRAMFILES(X86)'] ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.LOCALAPPDATA ?? ''}\\Google\\Chrome\\Application\\chrome.exe`,
    `${process.env.PROGRAMFILES ?? ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
    `${process.env['PROGRAMFILES(X86)'] ?? ''}\\Microsoft\\Edge\\Application\\msedge.exe`,
  ];
  return candidates.find((candidate) => candidate && existsSync(candidate));
};

export class BrowserTraktOAuthTransport implements TraktOAuthTransport {
  public constructor(private readonly baseUrl = 'https://api.trakt.tv') {}

  private async token(
    body: Record<string, string>,
    signal?: AbortSignal
  ): Promise<unknown> {
    signal?.throwIfAborted();
    const { chromium } = await import('playwright');
    const executablePath = traktOAuthBrowserExecutable();
    const browser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: [
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--no-sandbox',
      ],
    });
    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        locale: 'en-US',
        extraHTTPHeaders: {
          accept: 'application/json',
          'trakt-api-key': body.client_id ?? '',
          'trakt-api-version': '2',
        },
      });
      const page = await context.newPage();
      const abort = () => void page.close().catch(() => undefined);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        await page.goto(`${this.baseUrl}/movies/trending?limit=1`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        const result = await page.evaluate(
          async ({ payload }) => {
            const response = await fetch('/oauth/token', {
              method: 'POST',
              headers: {
                accept: 'application/json',
                'content-type': 'application/json',
                'trakt-api-key': payload.client_id ?? '',
                'trakt-api-version': '2',
              },
              body: JSON.stringify(payload),
            });
            return {
              status: response.status,
              body: await response.json().catch(() => undefined),
            };
          },
          { payload: body }
        );
        if (result.status < 200 || result.status >= 300)
          throw new Error(
            result.status === 400
              ? 'Trakt rejected the authorization grant or redirect URI.'
              : result.status === 401 || result.status === 403
                ? 'Trakt rejected the OAuth application credentials.'
                : `Trakt authorization failed with status ${result.status}.`
          );
        return result.body;
      } finally {
        signal?.removeEventListener('abort', abort);
      }
    } finally {
      await browser.close();
    }
  }

  public exchange(input: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    return this.token(
      {
        code: input.code,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: 'authorization_code',
      },
      input.signal
    );
  }

  public refresh(input: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    signal?: AbortSignal;
  }): Promise<unknown> {
    return this.token(
      {
        refresh_token: input.refreshToken,
        client_id: input.clientId,
        client_secret: input.clientSecret,
        redirect_uri: input.redirectUri,
        grant_type: 'refresh_token',
      },
      input.signal
    );
  }
}

export class ResilientTraktOAuthTransport implements TraktOAuthTransport {
  public constructor(
    private readonly direct: TraktOAuthTransport = new FetchTraktOAuthTransport(),
    private readonly browser: TraktOAuthTransport = new BrowserTraktOAuthTransport()
  ) {}

  private async run<T>(
    direct: () => Promise<T>,
    browser: () => Promise<T>
  ): Promise<T> {
    try {
      return await direct();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        !error.message.includes('Cloudflare protection')
      )
        throw error;
      return browser();
    }
  }

  public exchange(
    input: Parameters<TraktOAuthTransport['exchange']>[0]
  ): Promise<unknown> {
    return this.run(
      () => this.direct.exchange(input),
      () => this.browser.exchange(input)
    );
  }

  public refresh(
    input: Parameters<TraktOAuthTransport['refresh']>[0]
  ): Promise<unknown> {
    return this.run(
      () => this.direct.refresh(input),
      () => this.browser.refresh(input)
    );
  }
}

interface Attempt {
  state: string;
  redirectUri: string;
  expiresAt: number;
}

const validRedirectUri = (value: string): string => {
  const url = new URL(value);
  const local =
    ['localhost', '127.0.0.1', '::1'].includes(url.hostname) &&
    url.protocol === 'http:';
  if (
    (!local && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.hash ||
    url.search
  ) {
    throw new Error(
      'The Trakt redirect URL must not contain a query string or fragment and must use HTTPS, except for a local development address.'
    );
  }
  return url.toString();
};

const tokensFrom = (value: unknown, now: Date): TraktOAuthTokens => {
  const payload =
    typeof value === 'object' && value !== null
      ? (value as Record<string, unknown>)
      : {};
  const accessToken = String(payload.access_token ?? '').trim();
  const refreshToken = String(payload.refresh_token ?? '').trim();
  const expiresIn = Number(payload.expires_in);
  const createdAt = Number(payload.created_at);
  if (
    !accessToken ||
    !refreshToken ||
    !Number.isFinite(expiresIn) ||
    expiresIn <= 0
  ) {
    throw new Error('Trakt returned an incomplete authorization response.');
  }
  const issuedAt =
    Number.isFinite(createdAt) && createdAt > 0
      ? createdAt * 1000
      : now.getTime();
  return {
    accessToken,
    refreshToken,
    expiresAt: new Date(issuedAt + expiresIn * 1000).toISOString(),
    ...(typeof payload.scope === 'string' ? { scope: payload.scope } : {}),
    tokenType:
      typeof payload.token_type === 'string' && payload.token_type.trim()
        ? payload.token_type
        : 'bearer',
  };
};

export class TraktOAuthService {
  private readonly attempts = new Map<string, Attempt>();
  private refreshInFlight: Promise<string> | undefined;

  public constructor(
    private readonly repository: TraktOAuthRepository,
    private readonly credentials: () => Promise<
      TraktOAuthCredentials | undefined
    >,
    private readonly now: () => Date,
    private readonly transport: TraktOAuthTransport =
      new ResilientTraktOAuthTransport(),
    private readonly attemptLifetimeMs = 10 * 60 * 1000,
    private readonly maximumAttempts = 20
  ) {}

  public async status(): Promise<TraktOAuthStatus> {
    const tokens = await this.repository.get();
    return tokens
      ? { connected: true, expiresAt: tokens.expiresAt }
      : { connected: false };
  }

  public async begin(redirectUri: string): Promise<{
    authorizeUrl: string;
    state: string;
    expiresAt: string;
  }> {
    const configured = await this.credentials();
    if (!configured?.clientId || !configured.clientSecret) {
      throw new Error(
        'Save valid Trakt OAuth application credentials before connecting an account.'
      );
    }
    const normalizedRedirectUri = validRedirectUri(redirectUri);
    const currentTime = this.now().getTime();
    for (const [state, attempt] of this.attempts) {
      if (attempt.expiresAt < currentTime) this.attempts.delete(state);
    }
    while (this.attempts.size >= this.maximumAttempts) {
      const oldest = this.attempts.keys().next().value;
      if (typeof oldest !== 'string') break;
      this.attempts.delete(oldest);
    }
    const state = randomUUID();
    const expiresAt = currentTime + this.attemptLifetimeMs;
    this.attempts.set(state, {
      state,
      redirectUri: normalizedRedirectUri,
      expiresAt,
    });
    const url = new URL('https://trakt.tv/oauth/authorize');
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('client_id', configured.clientId);
    url.searchParams.set('redirect_uri', normalizedRedirectUri);
    url.searchParams.set('state', state);
    return {
      authorizeUrl: url.toString(),
      state,
      expiresAt: new Date(expiresAt).toISOString(),
    };
  }

  public async exchange(
    code: string,
    state: string,
    signal?: AbortSignal
  ): Promise<TraktOAuthStatus> {
    const attempt = this.attempts.get(state);
    this.attempts.delete(state);
    if (
      !attempt ||
      attempt.state !== state ||
      attempt.expiresAt < this.now().getTime()
    ) {
      throw new Error(
        'This Trakt authorization attempt is missing, expired, or already used.'
      );
    }
    const normalizedCode = code.trim();
    if (!normalizedCode) throw new Error('Trakt authorization code is required.');
    const configured = await this.credentials();
    if (!configured?.clientId || !configured.clientSecret) {
      throw new Error('Trakt OAuth application credentials are unavailable.');
    }
    const tokens = tokensFrom(
      await this.transport.exchange({
        code: normalizedCode,
        ...configured,
        redirectUri: attempt.redirectUri,
        ...(signal ? { signal } : {}),
      }),
      this.now()
    );
    await this.repository.save(tokens);
    return { connected: true, expiresAt: tokens.expiresAt };
  }

  public async disconnect(): Promise<void> {
    await this.repository.delete();
  }

  public async refreshNow(
    redirectUri: string,
    signal?: AbortSignal
  ): Promise<TraktOAuthStatus> {
    const current = await this.repository.get();
    if (!current) throw new Error('Connect a Trakt account before refreshing.');
    await this.refreshOnce(current, redirectUri, signal);
    const updated = await this.repository.get();
    return {
      connected: true,
      ...(updated?.expiresAt ? { expiresAt: updated.expiresAt } : {}),
    };
  }

  public async accessToken(
    redirectUri: string,
    signal?: AbortSignal
  ): Promise<string | undefined> {
    const current = await this.repository.get();
    if (!current) return undefined;
    if (
      new Date(current.expiresAt).getTime() >
      this.now().getTime() + 60_000
    ) {
      return current.accessToken;
    }
    return this.refreshOnce(current, redirectUri, signal);
  }

  private refreshOnce(
    current: TraktOAuthTokens,
    redirectUri: string,
    signal?: AbortSignal
  ): Promise<string> {
    if (!this.refreshInFlight) {
      this.refreshInFlight = this.refresh(current, redirectUri, signal).finally(
        () => {
          this.refreshInFlight = undefined;
        }
      );
    }
    return this.refreshInFlight;
  }

  private async refresh(
    current: TraktOAuthTokens,
    redirectUri: string,
    signal?: AbortSignal
  ): Promise<string> {
    const configured = await this.credentials();
    if (!configured?.clientId || !configured.clientSecret) {
      throw new Error('Trakt OAuth application credentials are unavailable.');
    }
    const tokens = tokensFrom(
      await this.transport.refresh({
        refreshToken: current.refreshToken,
        ...configured,
        redirectUri: validRedirectUri(redirectUri),
        ...(signal ? { signal } : {}),
      }),
      this.now()
    );
    await this.repository.save(tokens);
    return tokens.accessToken;
  }
}
