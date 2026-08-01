import {
  AnimeIdentityMap,
} from './myanimelist.js';

export type AniListSourceSubtype =
  | 'trending'
  | 'popular'
  | 'top_rated'
  | 'custom';

export interface AniListSourceItem {
  anilistId: number;
  malId?: number;
  title: string;
  rank: number;
  mediaType: 'movie' | 'show';
  year?: number;
  rating?: number;
  posterUrl?: string;
  tmdbIds: readonly number[];
  tvdbId?: number;
  imdbIds: readonly string[];
}

export interface AniListHttpResponse {
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: unknown;
}

export interface AniListHttpTransport {
  request(input: {
    url: string;
    headers: Readonly<Record<string, string>>;
    body: string;
    signal?: AbortSignal;
  }): Promise<AniListHttpResponse>;
}

export class AniListApiError extends Error {
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
const positiveInteger = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};
const finite = (value: unknown): number | undefined => {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};
const text = (value: unknown): string =>
  typeof value === 'string' ? value.trim() : '';

export class FetchAniListTransport implements AniListHttpTransport {
  public async request(input: {
    url: string;
    headers: Readonly<Record<string, string>>;
    body: string;
    signal?: AbortSignal;
  }): Promise<AniListHttpResponse> {
    const response = await fetch(input.url, {
      method: 'POST',
      headers: input.headers,
      body: input.body,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const responseText = await response.text();
    let body: unknown = responseText;
    try {
      body = JSON.parse(responseText);
    } catch {
      // The caller converts non-JSON provider failures into a safe error.
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  }
}

export interface AniListClientOptions {
  transport?: AniListHttpTransport;
  mappingTransport?: import('./myanimelist.js').MyAnimeListHttpTransport;
  endpoint?: string;
  mappingUrl?: string;
  maxRetries?: number;
  wait?: (milliseconds: number, signal?: AbortSignal) => Promise<void>;
}

const waitWithSignal = async (
  milliseconds: number,
  signal?: AbortSignal
): Promise<void> =>
  new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Aborted', 'AbortError'));
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

const customUserName = (urlValue?: string): string => {
  if (!urlValue?.trim())
    throw new Error('Enter an AniList user anime-list URL.');
  let url: URL;
  try {
    url = new URL(urlValue.trim());
  } catch {
    throw new Error('AniList custom list URL is invalid.');
  }
  if (!['anilist.co', 'www.anilist.co'].includes(url.hostname.toLowerCase()))
    throw new Error('AniList custom list URL must use anilist.co.');
  const match = /^\/user\/([^/]+)\/animelist\/?$/i.exec(url.pathname);
  if (!match?.[1])
    throw new Error(
      'AniList custom list URL must look like https://anilist.co/user/username/animelist.'
    );
  return decodeURIComponent(match[1]);
};

const mediaFields = `
  id
  idMal
  title { romaji english native }
  format
  startDate { year }
  averageScore
  coverImage { extraLarge large }
`;

export class AniListClient {
  private readonly transport: AniListHttpTransport;
  private readonly endpoint: string;
  private readonly mappingUrl: string;
  private readonly maxRetries: number;
  private readonly wait: NonNullable<AniListClientOptions['wait']>;
  private identityMap?: AnimeIdentityMap;

  public constructor(private readonly options: AniListClientOptions = {}) {
    this.transport = options.transport ?? new FetchAniListTransport();
    this.endpoint = options.endpoint ?? 'https://graphql.anilist.co';
    this.mappingUrl =
      options.mappingUrl ??
      'https://raw.githubusercontent.com/eliasbenb/PlexAniBridge-Mappings/refs/heads/v2/mappings.json';
    this.maxRetries = options.maxRetries ?? 3;
    this.wait = options.wait ?? waitWithSignal;
  }

  public async test(signal?: AbortSignal): Promise<void> {
    await this.graphql(
      'query { Page(page: 1, perPage: 1) { media(type: ANIME) { id } } }',
      {},
      signal
    );
  }

  public async source(
    input: {
      subtype: AniListSourceSubtype;
      mediaType: 'movie' | 'show';
      limit: number;
      customUrl?: string;
    },
    signal?: AbortSignal
  ): Promise<readonly AniListSourceItem[]> {
    if (!['trending', 'popular', 'top_rated', 'custom'].includes(input.subtype))
      throw new Error(`Unsupported AniList source "${input.subtype}".`);
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 9999)
      throw new Error('AniList item limit must be from 1 through 9,999.');
    const mapping = await this.mapping(signal);
    const items: AniListSourceItem[] = [];
    const seen = new Set<number>();
    const perPage = 50;
    const userName =
      input.subtype === 'custom' ? customUserName(input.customUrl) : undefined;
    for (let page = 1; items.length < input.limit; page += 1) {
      const custom = Boolean(userName);
      const query = custom
        ? `query ($page: Int!, $perPage: Int!, $userName: String!) {
            Page(page: $page, perPage: $perPage) {
              pageInfo { hasNextPage }
              mediaList(userName: $userName, type: ANIME, sort: UPDATED_TIME_DESC) {
                media { ${mediaFields} }
              }
            }
          }`
        : `query ($page: Int!, $perPage: Int!, $sort: [MediaSort]) {
            Page(page: $page, perPage: $perPage) {
              pageInfo { hasNextPage }
              media(type: ANIME, isAdult: false, sort: $sort) { ${mediaFields} }
            }
          }`;
      const sort =
        input.subtype === 'trending'
          ? ['TRENDING_DESC']
          : input.subtype === 'popular'
            ? ['POPULARITY_DESC']
            : ['SCORE_DESC'];
      const payload = record(
        await this.graphql(
          query,
          {
            page,
            perPage,
            ...(userName ? { userName } : { sort }),
          },
          signal
        )
      );
      const pageData = record(record(payload?.data)?.Page);
      if (!pageData)
        throw new Error('AniList returned an invalid page response.');
      const rows = custom
        ? records(pageData.mediaList).map((entry) => record(entry.media))
        : records(pageData.media);
      for (const media of rows) {
        if (!media) continue;
        const anilistId = positiveInteger(media.id);
        const format = text(media.format).toUpperCase();
        const compatible =
          input.mediaType === 'movie'
            ? format === 'MOVIE'
            : ['TV', 'TV_SHORT', 'OVA', 'ONA', 'SPECIAL'].includes(format);
        if (!anilistId || !compatible || seen.has(anilistId)) continue;
        const titles = record(media.title);
        const title =
          text(titles?.english) || text(titles?.romaji) || text(titles?.native);
        if (!title) continue;
        seen.add(anilistId);
        const identity = mapping.getByAniList(anilistId);
        const cover = record(media.coverImage);
        const year = positiveInteger(record(media.startDate)?.year);
        const rating = finite(media.averageScore);
        const malId = positiveInteger(media.idMal);
        items.push({
          anilistId,
          ...(malId ? { malId } : {}),
          title,
          rank: items.length + 1,
          mediaType: input.mediaType,
          tmdbIds:
            input.mediaType === 'movie'
              ? identity?.tmdbMovieIds ?? []
              : identity?.tmdbShowId
                ? [identity.tmdbShowId]
                : [],
          imdbIds: identity?.imdbIds ?? [],
          ...(identity?.tvdbId ? { tvdbId: identity.tvdbId } : {}),
          ...(year ? { year } : {}),
          ...(rating !== undefined ? { rating: rating / 10 } : {}),
          ...(text(cover?.extraLarge) || text(cover?.large)
            ? { posterUrl: text(cover?.extraLarge) || text(cover?.large) }
            : {}),
        });
        if (items.length >= input.limit) break;
      }
      if (!record(pageData.pageInfo)?.hasNextPage || rows.length < perPage)
        break;
    }
    return items;
  }

  private async mapping(signal?: AbortSignal): Promise<AnimeIdentityMap> {
    if (this.identityMap) return this.identityMap;
    const transport =
      this.options.mappingTransport ??
      new (await import('./myanimelist.js')).FetchMyAnimeListTransport();
    const response = await transport.request({
      url: this.mappingUrl,
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
    if (response.status < 200 || response.status >= 300)
      throw new Error(
        `Anime identity mapping request failed with status ${response.status}.`
      );
    this.identityMap = new AnimeIdentityMap(response.body);
    return this.identityMap;
  }

  private async graphql(
    query: string,
    variables: Readonly<Record<string, unknown>>,
    signal?: AbortSignal
  ): Promise<unknown> {
    let delay = 500;
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const response = await this.transport.request({
        url: this.endpoint,
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ query, variables }),
        ...(signal ? { signal } : {}),
      });
      const retryAfter = Number(response.headers['retry-after']);
      if (
        (response.status === 429 || response.status >= 500) &&
        attempt + 1 < this.maxRetries
      ) {
        await this.wait(
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : delay,
          signal
        );
        delay *= 2;
        continue;
      }
      if (response.status < 200 || response.status >= 300) {
        throw new AniListApiError(
          response.status,
          response.status === 429
            ? 'AniList rate limit exceeded.'
            : `AniList request failed with status ${response.status}.`,
          Number.isFinite(retryAfter) ? retryAfter : undefined
        );
      }
      const root = record(response.body);
      const errors = records(root?.errors);
      if (errors.length) {
        const message = text(errors[0]?.message) || 'AniList rejected the query.';
        throw new AniListApiError(422, `AniList: ${message}`);
      }
      return response.body;
    }
    throw new Error('AniList request failed.');
  }
}
