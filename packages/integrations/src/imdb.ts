import { existsSync } from 'node:fs';

export type ImdbMediaType = 'movie' | 'show';
export type ImdbSubtype =
  | 'top_250'
  | 'top_250_english'
  | 'popular'
  | 'boxoffice'
  | 'custom';

export interface ImdbSourceItem {
  imdbId: string;
  title: string;
  mediaType: ImdbMediaType;
  rank: number;
  year?: number;
}

export interface ImdbTitleMetadata {
  imdbId: string;
  title?: string;
  alternateTitle?: string;
  description?: string;
  contentRating?: string;
  genres?: readonly string[];
  keywords?: readonly string[];
  actors?: readonly string[];
  directors?: readonly string[];
  creators?: readonly string[];
  rating?: number;
  ratingCount?: number;
  durationMinutes?: number;
  releaseDate?: string;
}

export interface ImdbTransportResponse {
  status: number;
  body: string;
}

export interface ImdbTransport {
  get(url: string, signal?: AbortSignal): Promise<ImdbTransportResponse>;
}

export class FetchImdbTransport implements ImdbTransport {
  public async get(
    url: string,
    signal?: AbortSignal
  ): Promise<ImdbTransportResponse> {
    const response = await fetch(url, {
      headers: {
        accept: 'text/html,application/xhtml+xml',
        'accept-language': 'en-US,en;q=0.9',
        'user-agent':
          'Mozilla/5.0 (compatible; Vynode/1.0; +https://github.com/)',
      },
      ...(signal ? { signal } : {}),
    });
    return { status: response.status, body: await response.text() };
  }
}

const browserExecutable = (): string | undefined => {
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

export class BrowserImdbTransport implements ImdbTransport {
  public async get(
    url: string,
    signal?: AbortSignal
  ): Promise<ImdbTransportResponse> {
    signal?.throwIfAborted();
    const { chromium } = await import('playwright');
    const executablePath = browserExecutable();
    let browser;
    try {
      browser = await chromium.launch({
        headless: true,
        ...(executablePath ? { executablePath } : {}),
        args: [
          '--disable-blink-features=AutomationControlled',
          '--disable-breakpad',
          '--disable-crash-reporter',
          '--disable-dev-shm-usage',
          '--no-sandbox',
        ],
      });
    } catch (error) {
      throw new Error(
        `IMDb browser transport is unavailable: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
    try {
      const context = await browser.newContext({
        userAgent:
          'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36',
        locale: 'en-US',
        viewport: { width: 1365, height: 900 },
      });
      const page = await context.newPage();
      const abort = () => void page.close().catch(() => undefined);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        let response = await page.goto(url, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });
        if (response?.status() === 202) {
          for (let attempt = 0; attempt < 20; attempt += 1) {
            signal?.throwIfAborted();
            if (
              (await context.cookies()).some(
                (cookie) => cookie.name === 'aws-waf-token'
              )
            )
              break;
            await page.waitForTimeout(500);
          }
          response = await page.goto(url, {
            waitUntil: 'domcontentloaded',
            timeout: 30_000,
          });
        }
        return {
          status: response?.status() ?? 0,
          body: await page.content(),
        };
      } finally {
        signal?.removeEventListener('abort', abort);
      }
    } finally {
      await browser.close();
    }
  }
}

export class ResilientImdbTransport implements ImdbTransport {
  public constructor(
    private readonly direct = new FetchImdbTransport(),
    private readonly browser = new BrowserImdbTransport()
  ) {}

  public async get(
    url: string,
    signal?: AbortSignal
  ): Promise<ImdbTransportResponse> {
    const response = await this.direct.get(url, signal);
    return response.status === 202 || response.status === 403
      ? this.browser.get(url, signal)
      : response;
  }
}

const validImdbId = (value: unknown): string | undefined =>
  typeof value === 'string' && /^tt\d{6,}$/.test(value) ? value : undefined;
const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';
const year = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1870 && parsed <= 2200
    ? parsed
    : undefined;
};
const mediaTypeFromTitleType = (value: unknown): ImdbMediaType =>
  ['tvSeries', 'tvMiniSeries', 'tvShort', 'tvSpecial', 'tvEpisode'].includes(
    text(value)
  )
    ? 'show'
    : 'movie';

const stringList = (value: unknown): string[] =>
  (Array.isArray(value) ? value : typeof value === 'string' ? [value] : [])
    .map((entry) =>
      typeof entry === 'string'
        ? entry.trim()
        : typeof entry === 'object' && entry !== null && 'name' in entry
          ? text((entry as { name?: unknown }).name)
          : ''
    )
    .filter(Boolean);

const finiteNumber = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const durationMinutes = (value: unknown): number | undefined => {
  const match = /^PT(?:(\d+)H)?(?:(\d+)M)?$/i.exec(text(value));
  if (!match) return undefined;
  const minutes = Number(match[1] ?? 0) * 60 + Number(match[2] ?? 0);
  return minutes > 0 ? minutes : undefined;
};

export const parseImdbTitleHtml = (
  html: string,
  expectedImdbId: string
): ImdbTitleMetadata => {
  const imdbId = validImdbId(expectedImdbId);
  if (!imdbId) throw new Error('Enter a valid IMDb title ID.');
  for (const match of html.matchAll(
    /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
  )) {
    try {
      const data = JSON.parse(match[1] ?? '') as Record<string, unknown>;
      const pageId = validImdbId(
        text(data.url).match(/\/title\/(tt\d+)/)?.[1]
      );
      if (pageId && pageId !== imdbId) continue;
      const aggregate = data.aggregateRating as
        | Record<string, unknown>
        | undefined;
      const rating = finiteNumber(aggregate?.ratingValue);
      const ratingCount = finiteNumber(aggregate?.ratingCount);
      const parsedDuration = durationMinutes(data.duration);
      const releaseDate = text(data.datePublished);
      const keywords = text(data.keywords)
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean);
      return {
        imdbId,
        ...(text(data.name) ? { title: text(data.name) } : {}),
        ...(text(data.alternateName)
          ? { alternateTitle: text(data.alternateName) }
          : {}),
        ...(text(data.description)
          ? { description: text(data.description) }
          : {}),
        ...(text(data.contentRating)
          ? { contentRating: text(data.contentRating) }
          : {}),
        ...(stringList(data.genre).length
          ? { genres: stringList(data.genre) }
          : {}),
        ...(keywords.length ? { keywords } : {}),
        ...(stringList(data.actor).length
          ? { actors: stringList(data.actor) }
          : {}),
        ...(stringList(data.director).length
          ? { directors: stringList(data.director) }
          : {}),
        ...(stringList(data.creator).length
          ? { creators: stringList(data.creator) }
          : {}),
        ...(rating !== undefined ? { rating } : {}),
        ...(ratingCount !== undefined ? { ratingCount } : {}),
        ...(parsedDuration !== undefined
          ? { durationMinutes: parsedDuration }
          : {}),
        ...(releaseDate ? { releaseDate } : {}),
      };
    } catch {
      // Continue because IMDb pages can contain unrelated JSON-LD blocks.
    }
  }
  throw new Error(
    'IMDb returned no recognizable title metadata; the page format may have changed.'
  );
};

export const parseImdbListUrl = (value: string): URL => {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error('Enter a valid IMDb list URL.');
  }
  if (
    url.protocol !== 'https:' ||
    !['imdb.com', 'www.imdb.com'].includes(url.hostname.toLowerCase()) ||
    !/^\/list\/ls\d+\/?$/.test(url.pathname)
  )
    throw new Error('IMDb custom lists must use https://www.imdb.com/list/ls…');
  url.hostname = 'www.imdb.com';
  url.search = '';
  url.hash = '';
  if (!url.pathname.endsWith('/')) url.pathname += '/';
  return url;
};

export const parseImdbHtml = (
  html: string,
  expectedMediaType: ImdbMediaType
): readonly Omit<ImdbSourceItem, 'rank'>[] => {
  const output: Omit<ImdbSourceItem, 'rank'>[] = [];
  const seen = new Set<string>();
  const scripts = [
    ...html.matchAll(
      /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi
    ),
  ];
  for (const match of scripts) {
    try {
      const data = JSON.parse(match[1] ?? '') as {
        '@type'?: string;
        itemListElement?: {
          item?: {
            '@type'?: string;
            url?: string;
            name?: string;
            alternateName?: string;
            datePublished?: string;
          };
        }[];
      };
      if (data['@type'] !== 'ItemList') continue;
      for (const entry of data.itemListElement ?? []) {
        const item = entry.item;
        const imdbId = validImdbId(item?.url?.match(/\/title\/(tt\d+)/)?.[1]);
        const title = text(item?.name) || text(item?.alternateName);
        const mediaType =
          item?.['@type'] === 'TVSeries' || item?.['@type'] === 'TVEpisode'
            ? 'show'
            : item?.['@type'] === 'Movie'
              ? 'movie'
              : expectedMediaType;
        if (!imdbId || !title || mediaType !== expectedMediaType || seen.has(imdbId))
          continue;
        seen.add(imdbId);
        const parsedYear = year(item?.datePublished?.slice(0, 4));
        output.push({
          imdbId,
          title,
          mediaType,
          ...(parsedYear ? { year: parsedYear } : {}),
        });
      }
    } catch {
      // Another JSON-LD block may contain the actual ItemList.
    }
  }
  const nextMatch = html.match(
    /<script[^>]+id=["']__NEXT_DATA__["'][^>]*>([\s\S]*?)<\/script>/i
  );
  if (nextMatch) {
    try {
      const next = JSON.parse(nextMatch[1] ?? '') as Record<string, unknown>;
      const pageProps = (next.props as Record<string, unknown>)?.pageProps as
        | Record<string, unknown>
        | undefined;
      const main = pageProps?.mainColumnData as Record<string, unknown> | undefined;
      const holder =
        (main?.list as Record<string, unknown> | undefined) ??
        (main?.predefinedList as Record<string, unknown> | undefined);
      const search = holder?.titleListItemSearch as
        | Record<string, unknown>
        | undefined;
      for (const edge of (search?.edges as unknown[] | undefined) ?? []) {
        const listItem = (edge as Record<string, unknown>)?.listItem as
          | Record<string, unknown>
          | undefined;
        const imdbId = validImdbId(listItem?.id);
        const title =
          text((listItem?.titleText as Record<string, unknown>)?.text) ||
          text((listItem?.originalTitleText as Record<string, unknown>)?.text);
        const mediaType = mediaTypeFromTitleType(
          (listItem?.titleType as Record<string, unknown>)?.id
        );
        if (!imdbId || !title || mediaType !== expectedMediaType || seen.has(imdbId))
          continue;
        seen.add(imdbId);
        const parsedYear = year(
          (listItem?.releaseYear as Record<string, unknown>)?.year
        );
        output.push({
          imdbId,
          title,
          mediaType,
          ...(parsedYear ? { year: parsedYear } : {}),
        });
      }
    } catch {
      // The caller reports an empty or challenge response clearly.
    }
  }
  return output;
};

export class ImdbClient {
  public constructor(
    private readonly transport: ImdbTransport = new ResilientImdbTransport()
  ) {}

  public async source(
    input: {
      mediaType: ImdbMediaType;
      subtype: ImdbSubtype;
      limit: number;
      customUrl?: string;
    },
    signal?: AbortSignal
  ): Promise<readonly ImdbSourceItem[]> {
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 9999)
      throw new Error('IMDb item limit must be from 1 through 9,999.');
    if (
      (input.subtype === 'top_250_english' ||
        input.subtype === 'boxoffice') &&
      input.mediaType === 'show'
    )
      return [];
    const firstUrl =
      input.subtype === 'custom'
        ? parseImdbListUrl(input.customUrl ?? '').toString()
        : `https://www.imdb.com${
            input.subtype === 'top_250'
              ? input.mediaType === 'movie'
                ? '/chart/top/'
                : '/chart/toptv/'
              : input.subtype === 'top_250_english'
                ? '/chart/top-english-movies/'
                : input.subtype === 'popular'
                  ? input.mediaType === 'movie'
                    ? '/chart/moviemeter/'
                    : '/chart/tvmeter/'
                  : '/chart/boxoffice/'
          }`;
    const collected: Omit<ImdbSourceItem, 'rank'>[] = [];
    const seen = new Set<string>();
    for (let page = 1; collected.length < input.limit && page <= 50; page += 1) {
      const url = new URL(firstUrl);
      if (input.subtype === 'custom' && page > 1)
        url.searchParams.set('page', String(page));
      const response = await this.transport.get(url.toString(), signal);
      if (response.status === 202 || response.status === 403)
        throw new Error(
          'IMDb blocked the server request with its web-application firewall. Configure the browser-capable IMDb transport before synchronization.'
        );
      if (response.status < 200 || response.status >= 300)
        throw new Error(`IMDb request failed with status ${response.status}.`);
      const pageItems = parseImdbHtml(response.body, input.mediaType);
      for (const item of pageItems) {
        if (seen.has(item.imdbId)) continue;
        seen.add(item.imdbId);
        collected.push(item);
        if (collected.length >= input.limit) break;
      }
      if (input.subtype !== 'custom' || pageItems.length === 0) break;
      if (!response.body.includes('"hasNextPage":true')) break;
    }
    if (!collected.length)
      throw new Error(
        'IMDb returned no recognizable list items; the page format may have changed.'
      );
    return collected.map((item, rank) => ({ ...item, rank }));
  }

  public async title(
    imdbId: string,
    signal?: AbortSignal
  ): Promise<ImdbTitleMetadata> {
    const normalized = validImdbId(imdbId);
    if (!normalized) throw new Error('Enter a valid IMDb title ID.');
    const response = await this.transport.get(
      `https://www.imdb.com/title/${normalized}/`,
      signal
    );
    if (response.status === 202 || response.status === 403)
      throw new Error(
        'IMDb blocked the server request with its web-application firewall.'
      );
    if (response.status < 200 || response.status >= 300)
      throw new Error(`IMDb request failed with status ${response.status}.`);
    return parseImdbTitleHtml(response.body, normalized);
  }
}
