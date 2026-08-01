import { existsSync } from 'node:fs';

export type TraktMediaType = 'movie' | 'show';
export type TraktPeriod = 'daily' | 'weekly' | 'monthly' | 'all';

export interface TraktSourceItem {
  mediaType: TraktMediaType;
  title: string;
  year?: number;
  tmdbId: number;
  tvdbId?: number;
  traktId?: number;
  rank: number;
  rating?: number;
  releasedAt?: string;
}

export interface TraktSourceRequest {
  mediaType: TraktMediaType;
  subtype:
    | 'trending'
    | 'popular'
    | 'recommendations'
    | 'watchlist'
    | 'played'
    | 'watched'
    | 'collected'
    | 'favorited'
    | 'anticipated'
    | 'boxoffice'
    | 'custom';
  period?: TraktPeriod;
  customUrl?: string;
  limit: number;
}

export interface TraktHttpResponse {
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: unknown;
}

export interface TraktHttpTransport {
  request(input: {
    method: 'GET' | 'POST';
    path: string;
    headers: Readonly<Record<string, string>>;
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<TraktHttpResponse>;
}

export class TraktApiError extends Error {
  public constructor(
    public readonly status: number,
    message: string,
    public readonly retryAfterSeconds?: number
  ) {
    super(message);
  }
}

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null
    ? (value as JsonRecord)
    : undefined;
const records = (value: unknown): readonly JsonRecord[] =>
  Array.isArray(value)
    ? value.map(record).filter((item): item is JsonRecord => Boolean(item))
    : [];
const text = (value: unknown): string =>
  typeof value === 'string' ? value : '';
const integer = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
};
const finite = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
};

export const parseTraktListUrl = (
  value: string
): { path: string; metadataPath: string } => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a valid Trakt list URL.');
  }
  if (
    url.protocol !== 'https:' ||
    !['trakt.tv', 'app.trakt.tv'].includes(url.hostname.toLowerCase()) ||
    url.username ||
    url.password
  ) {
    throw new Error(
      'Trakt list URLs must use HTTPS on trakt.tv or app.trakt.tv.'
    );
  }
  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => decodeURIComponent(segment));
  if (
    segments.length === 4 &&
    segments[0] === 'users' &&
    segments[2] === 'lists'
  ) {
    const root = `/users/${encodeURIComponent(segments[1]!)}/lists/${encodeURIComponent(segments[3]!)}`;
    return { path: `${root}/items`, metadataPath: root };
  }
  if (
    segments.length === 3 &&
    segments[0] === 'lists' &&
    segments[1] === 'official'
  ) {
    const root = `/lists/official/${encodeURIComponent(segments[2]!)}`;
    return { path: `${root}/items`, metadataPath: root };
  }
  throw new Error(
    'Use a Trakt user-list URL or an official Trakt list URL.'
  );
};

export const normalizeTraktRandomListUrls = (
  values: readonly string[]
): readonly string[] => {
  const unique = new Map<string, string>();
  for (const value of values) {
    const trimmed = value.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const parsed = parseTraktListUrl(trimmed);
    const canonical = `https://trakt.tv${parsed.metadataPath}`;
    unique.set(canonical.toLowerCase(), canonical);
  }
  return [...unique.values()];
};

export const selectTraktRandomListUrl = (
  values: readonly string[],
  random: () => number = Math.random
): string => {
  const normalized = normalizeTraktRandomListUrls(values);
  if (!normalized.length)
    throw new Error('Add at least one valid Trakt list URL to the random pool.');
  const sample = random();
  if (!Number.isFinite(sample) || sample < 0 || sample >= 1)
    throw new Error('The random list selector returned an invalid value.');
  return normalized[Math.floor(sample * normalized.length)]!;
};

export class FetchTraktTransport implements TraktHttpTransport {
  public constructor(private readonly baseUrl = 'https://api.trakt.tv') {}

  public async request(input: {
    method: 'GET' | 'POST';
    path: string;
    headers: Readonly<Record<string, string>>;
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<TraktHttpResponse> {
    const response = await fetch(`${this.baseUrl}${input.path}`, {
      method: input.method,
      headers: input.headers,
      ...(input.body === undefined
        ? {}
        : { body: JSON.stringify(input.body) }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const body = contentType.includes('json')
      ? await response.json()
      : await response.text();
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  }
}

const traktBrowserExecutable = (): string | undefined => {
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

export class BrowserTraktTransport implements TraktHttpTransport {
  public constructor(private readonly baseUrl = 'https://api.trakt.tv') {}

  public async request(input: {
    method: 'GET' | 'POST';
    path: string;
    headers: Readonly<Record<string, string>>;
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<TraktHttpResponse> {
    if (input.method !== 'GET' || input.body !== undefined)
      throw new Error(
        'The Trakt browser transport supports read requests only.'
      );
    input.signal?.throwIfAborted();
    const { chromium } = await import('playwright');
    const executablePath = traktBrowserExecutable();
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
        extraHTTPHeaders: input.headers,
      });
      const page = await context.newPage();
      const abort = () => void page.close().catch(() => undefined);
      input.signal?.addEventListener('abort', abort, { once: true });
      try {
        const response = await page.goto(`${this.baseUrl}${input.path}`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        const bodyText = await page.locator('body').innerText();
        const contentType = response?.headers()['content-type'] ?? '';
        let body: unknown = bodyText;
        if (contentType.includes('json')) {
          try {
            body = JSON.parse(bodyText);
          } catch {
            // TraktClient will report the invalid payload without leaking it.
          }
        }
        return {
          status: response?.status() ?? 0,
          headers: response?.headers() ?? {},
          body,
        };
      } finally {
        input.signal?.removeEventListener('abort', abort);
      }
    } finally {
      await browser.close();
    }
  }
}

export class ResilientTraktTransport implements TraktHttpTransport {
  public constructor(
    private readonly direct: TraktHttpTransport = new FetchTraktTransport(),
    private readonly browser: TraktHttpTransport = new BrowserTraktTransport()
  ) {}

  public async request(input: {
    method: 'GET' | 'POST';
    path: string;
    headers: Readonly<Record<string, string>>;
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<TraktHttpResponse> {
    const response = await this.direct.request(input);
    const contentType = response.headers['content-type'] ?? '';
    return response.status === 403 && !contentType.includes('json')
      ? this.browser.request(input)
      : response;
  }
}

export interface TraktClientOptions {
  clientId: string;
  accessToken?: () => Promise<string | undefined>;
  transport?: TraktHttpTransport;
  maxRetries?: number;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

const waitWithSignal = async (
  milliseconds: number,
  signal?: AbortSignal
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = setTimeout(resolve, milliseconds);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new DOMException('Aborted', 'AbortError'));
      },
      { once: true }
    );
  });

export class TraktClient {
  private readonly transport: TraktHttpTransport;
  private readonly maxRetries: number;
  private readonly wait: NonNullable<TraktClientOptions['wait']>;

  public constructor(private readonly options: TraktClientOptions) {
    if (!options.clientId.trim()) throw new Error('Trakt Client ID is required.');
    this.transport = options.transport ?? new ResilientTraktTransport();
    this.maxRetries = options.maxRetries ?? 3;
    this.wait = options.wait ?? waitWithSignal;
  }

  public async test(signal?: AbortSignal): Promise<void> {
    await this.get('/movies/trending?limit=1&page=1', false, signal);
  }

  public async listMetadata(
    listUrl: string,
    signal?: AbortSignal
  ): Promise<{ name: string; itemCount?: number }> {
    const response = record(
      await this.get(parseTraktListUrl(listUrl).metadataPath, false, signal)
    );
    if (!response || !text(response.name))
      throw new Error('Trakt returned invalid list metadata.');
    return {
      name: text(response.name),
      ...(integer(response.item_count)
        ? { itemCount: integer(response.item_count)! }
        : {}),
    };
  }

  public async source(
    input: TraktSourceRequest,
    signal?: AbortSignal
  ): Promise<readonly TraktSourceItem[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 9999)
      throw new Error('Trakt item limit must be from 1 through 9,999.');
    const authenticated = ['recommendations', 'watchlist'].includes(
      input.subtype
    );
    const type = input.mediaType === 'movie' ? 'movies' : 'shows';
    const period = input.period ?? 'weekly';
    const basePath =
      input.subtype === 'trending'
        ? `/${type}/trending`
        : input.subtype === 'popular'
          ? `/${type}/popular`
          : input.subtype === 'played' ||
              input.subtype === 'watched' ||
              input.subtype === 'collected' ||
              input.subtype === 'favorited'
            ? `/${type}/${input.subtype}/${period}`
            : input.subtype === 'anticipated'
              ? `/${type}/anticipated`
            : input.subtype === 'boxoffice'
              ? '/movies/boxoffice'
              : input.subtype === 'recommendations'
                ? `/recommendations/${type}`
                : input.subtype === 'watchlist'
                ? `/sync/watchlist/${type}`
                : input.subtype === 'custom' && input.customUrl
                    ? `${parseTraktListUrl(input.customUrl).path}/${type}`
                    : '';
    if (!basePath)
      throw new Error('The selected Trakt source is incomplete.');
    if (input.subtype === 'boxoffice' && input.mediaType !== 'movie') return [];

    const collected: TraktSourceItem[] = [];
    const seen = new Set<number>();
    const pageSize = Math.min(input.limit, 100);
    for (let page = 1; collected.length < input.limit; page += 1) {
      const query = new URLSearchParams({
        limit: String(pageSize),
        page: String(page),
        ...(input.subtype === 'recommendations'
          ? { ignore_collected: 'false', ignore_watchlisted: 'false' }
          : {}),
      });
      const response = await this.getResponse(
        `${basePath}?${query}`,
        authenticated,
        signal
      );
      const pageItems = this.normalize(response.body, input.mediaType);
      for (const item of pageItems) {
        if (seen.has(item.tmdbId)) continue;
        seen.add(item.tmdbId);
        collected.push({ ...item, rank: collected.length });
        if (collected.length >= input.limit) break;
      }
      const pageCount = integer(response.headers['x-pagination-page-count']);
      if (
        (pageCount !== undefined && page >= pageCount) ||
        records(response.body).length < pageSize ||
        records(response.body).length === 0
      )
        break;
    }
    return collected;
  }

  private normalize(
    value: unknown,
    requestedType: TraktMediaType
  ): readonly TraktSourceItem[] {
    const output: TraktSourceItem[] = [];
    const seen = new Set<number>();
    records(value).forEach((wrapper, rank) => {
      const movie = record(wrapper.movie);
      const show = record(wrapper.show);
      const episode = record(wrapper.episode);
      const season = record(wrapper.season);
      const episodeShow = record(episode?.show);
      const seasonShow = record(season?.show);
      const direct = record(wrapper.ids) ? wrapper : undefined;
      const entity =
        requestedType === 'movie'
          ? movie ?? direct
          : show ?? episodeShow ?? seasonShow ?? direct;
      if (!entity) return;
      const ids = record(entity.ids);
      const tmdbId = integer(ids?.tmdb);
      if (!tmdbId || seen.has(tmdbId)) return;
      const title = text(entity.title);
      if (!title) return;
      seen.add(tmdbId);
      const year = integer(entity.year);
      const traktId = integer(ids?.trakt);
      const tvdbId = integer(ids?.tvdb);
      const rating = finite(entity.rating);
      const releasedAt =
        text(entity.released) || text(entity.first_aired) || undefined;
      output.push({
        mediaType: requestedType,
        title,
        tmdbId,
        rank,
        ...(year ? { year } : {}),
        ...(traktId ? { traktId } : {}),
        ...(tvdbId ? { tvdbId } : {}),
        ...(rating !== undefined ? { rating } : {}),
        ...(releasedAt ? { releasedAt } : {}),
      });
    });
    return output;
  }

  private async get(
    path: string,
    authenticated: boolean,
    signal?: AbortSignal
  ): Promise<unknown> {
    return (await this.getResponse(path, authenticated, signal)).body;
  }

  private async getResponse(
    path: string,
    authenticated: boolean,
    signal?: AbortSignal
  ): Promise<TraktHttpResponse> {
    let delay = 500;
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const accessToken = await this.options.accessToken?.();
      if (authenticated && !accessToken)
        throw new Error('Connect a Trakt account for this source.');
      let response: TraktHttpResponse;
      try {
        response = await this.transport.request({
          method: 'GET',
          path,
          headers: {
            'Content-Type': 'application/json',
            'trakt-api-version': '2',
            'trakt-api-key': this.options.clientId,
            ...(accessToken
              ? { Authorization: `Bearer ${accessToken}` }
              : {}),
          },
          ...(signal ? { signal } : {}),
        });
      } catch (error) {
        if (signal?.aborted) throw error;
        if (attempt + 1 >= this.maxRetries) throw error;
        await this.wait(delay, signal);
        delay *= 2;
        continue;
      }
      if (response.status >= 200 && response.status < 300) return response;
      const retryAfter = integer(response.headers['retry-after']);
      const retryable = response.status === 429 || response.status >= 500;
      if (!retryable || attempt + 1 >= this.maxRetries) {
        throw new TraktApiError(
          response.status,
          response.status === 401 || response.status === 403
            ? 'Trakt authorization is invalid or expired.'
            : `Trakt request failed with status ${response.status}.`,
          retryAfter
        );
      }
      await this.wait((retryAfter ?? delay / 1000) * 1000, signal);
      delay *= 2;
    }
    throw new Error('Trakt request retry limit was exceeded.');
  }
}
