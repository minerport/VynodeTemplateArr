export type MyAnimeListRankingType =
  | 'all'
  | 'airing'
  | 'tv'
  | 'ova'
  | 'movie'
  | 'special'
  | 'bypopularity'
  | 'favorite';

export interface MyAnimeListSourceItem {
  malId: number;
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

export interface MyAnimeListHttpResponse {
  status: number;
  headers: Readonly<Record<string, string | undefined>>;
  body: unknown;
}

export interface MyAnimeListHttpTransport {
  request(input: {
    url: string;
    headers: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<MyAnimeListHttpResponse>;
}

export class MyAnimeListApiError extends Error {
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
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(number) && number > 0 ? number : undefined;
};
const finite = (value: unknown): number | undefined => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : undefined;
};
const stringArray = (value: unknown): readonly string[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.toLowerCase())
    .filter((item) => /^tt\d{6,}$/.test(item));
const numberArray = (value: unknown): readonly number[] =>
  (Array.isArray(value) ? value : value === undefined ? [] : [value])
    .map(positiveInteger)
    .filter((item): item is number => item !== undefined);

const rankingTypes = new Set<MyAnimeListRankingType>([
  'all',
  'airing',
  'tv',
  'ova',
  'movie',
  'special',
  'bypopularity',
  'favorite',
]);

export class FetchMyAnimeListTransport implements MyAnimeListHttpTransport {
  public async request(input: {
    url: string;
    headers: Readonly<Record<string, string>>;
    signal?: AbortSignal;
  }): Promise<MyAnimeListHttpResponse> {
    const response = await fetch(input.url, {
      headers: input.headers,
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const contentType = response.headers.get('content-type') ?? '';
    const text = await response.text();
    let body: unknown = text;
    if (
      contentType.includes('json') ||
      /^[\s\r\n]*[[{]/.test(text)
    ) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  }
}

export interface AnimeIdentityMapping {
  tmdbMovieIds: readonly number[];
  tmdbShowId?: number;
  tvdbId?: number;
  imdbIds: readonly string[];
}

export class AnimeIdentityMap {
  private readonly byMal = new Map<number, AnimeIdentityMapping>();
  private readonly byAniList = new Map<number, AnimeIdentityMapping>();

  public constructor(payload: unknown) {
    const root = record(payload);
    if (!root) throw new Error('Anime identity mapping is not an object.');
    for (const [anilistId, value] of Object.entries(root)) {
      if (anilistId.startsWith('$')) continue;
      const row = record(value);
      if (!row) continue;
      const mapping: AnimeIdentityMapping = {
        tmdbMovieIds: numberArray(row.tmdb_movie_id),
        imdbIds: stringArray(row.imdb_id),
        ...(positiveInteger(row.tmdb_show_id)
          ? { tmdbShowId: positiveInteger(row.tmdb_show_id)! }
          : {}),
        ...(positiveInteger(row.tvdb_id)
          ? { tvdbId: positiveInteger(row.tvdb_id)! }
          : {}),
      };
      const parsedAniListId = positiveInteger(anilistId);
      if (parsedAniListId) this.byAniList.set(parsedAniListId, mapping);
      for (const malId of numberArray(row.mal_id))
        this.byMal.set(malId, mapping);
    }
  }

  public get(malId: number): AnimeIdentityMapping | undefined {
    return this.byMal.get(malId);
  }

  public getByAniList(anilistId: number): AnimeIdentityMapping | undefined {
    return this.byAniList.get(anilistId);
  }
}

export interface MyAnimeListClientOptions {
  clientId: string;
  transport?: MyAnimeListHttpTransport;
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

export class MyAnimeListClient {
  private readonly transport: MyAnimeListHttpTransport;
  private readonly mappingUrl: string;
  private readonly maxRetries: number;
  private readonly wait: NonNullable<MyAnimeListClientOptions['wait']>;
  private mapping?: AnimeIdentityMap;

  public constructor(private readonly options: MyAnimeListClientOptions) {
    if (!options.clientId.trim())
      throw new Error('MyAnimeList Client ID is required.');
    this.transport = options.transport ?? new FetchMyAnimeListTransport();
    this.mappingUrl =
      options.mappingUrl ??
      'https://raw.githubusercontent.com/eliasbenb/PlexAniBridge-Mappings/refs/heads/v2/mappings.json';
    this.maxRetries = options.maxRetries ?? 3;
    this.wait = options.wait ?? waitWithSignal;
  }

  public async test(signal?: AbortSignal): Promise<void> {
    await this.request(
      'https://api.myanimelist.net/v2/anime/ranking?ranking_type=all&limit=1&offset=0',
      true,
      signal
    );
  }

  public async source(
    input: {
      rankingType: MyAnimeListRankingType;
      mediaType: 'movie' | 'show';
      limit: number;
    },
    signal?: AbortSignal
  ): Promise<readonly MyAnimeListSourceItem[]> {
    if (!rankingTypes.has(input.rankingType))
      throw new Error(`Unsupported MyAnimeList ranking "${input.rankingType}".`);
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 9999)
      throw new Error('MyAnimeList item limit must be from 1 through 9,999.');
    const mapping = await this.identityMap(signal);
    const items: MyAnimeListSourceItem[] = [];
    const seen = new Set<number>();
    for (let offset = 0; items.length < input.limit && offset < 10000; offset += 500) {
      const query = new URLSearchParams({
        ranking_type: input.rankingType,
        limit: '500',
        offset: String(offset),
        fields: 'id,title,main_picture,start_date,mean,media_type',
      });
      const response = record(
        await this.request(
          `https://api.myanimelist.net/v2/anime/ranking?${query}`,
          true,
          signal
        )
      );
      if (!response || !Array.isArray(response.data))
        throw new Error('MyAnimeList returned an invalid ranking response.');
      const data = records(response?.data);
      for (const wrapper of data) {
        const node = record(wrapper.node);
        const ranking = record(wrapper.ranking);
        const malId = positiveInteger(node?.id);
        const title = typeof node?.title === 'string' ? node.title : '';
        const malMediaType =
          typeof node?.media_type === 'string' ? node.media_type : '';
        const compatible =
          input.mediaType === 'movie'
            ? malMediaType === 'movie'
            : ['tv', 'ova', 'ona', 'special'].includes(malMediaType);
        if (!malId || !title || !compatible || seen.has(malId)) continue;
        seen.add(malId);
        const identity = mapping.get(malId);
        const startDate =
          typeof node?.start_date === 'string' ? node.start_date : '';
        const year = positiveInteger(startDate.slice(0, 4));
        const picture = record(node?.main_picture);
        const posterUrl =
          typeof picture?.large === 'string'
            ? picture.large
            : typeof picture?.medium === 'string'
              ? picture.medium
              : undefined;
        items.push({
          malId,
          title,
          rank: positiveInteger(ranking?.rank) ?? offset + items.length + 1,
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
          ...(finite(node?.mean) !== undefined
            ? { rating: finite(node?.mean)! }
            : {}),
          ...(posterUrl ? { posterUrl } : {}),
        });
        if (items.length >= input.limit) break;
      }
      const paging = record(response.paging);
      if (data.length < 500 || typeof paging?.next !== 'string') break;
    }
    return items;
  }

  private async identityMap(signal?: AbortSignal): Promise<AnimeIdentityMap> {
    if (this.mapping) return this.mapping;
    const payload = await this.request(this.mappingUrl, false, signal);
    this.mapping = new AnimeIdentityMap(payload);
    return this.mapping;
  }

  private async request(
    url: string,
    authenticated: boolean,
    signal?: AbortSignal
  ): Promise<unknown> {
    let delay = 500;
    for (let attempt = 0; attempt < this.maxRetries; attempt += 1) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const response = await this.transport.request({
        url,
        headers: {
          Accept: 'application/json',
          ...(authenticated
            ? { 'X-MAL-Client-ID': this.options.clientId }
            : {}),
        },
        ...(signal ? { signal } : {}),
      });
      if (response.status >= 200 && response.status < 300) return response.body;
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
      const message =
        [401, 403].includes(response.status)
          ? 'MyAnimeList rejected the Client ID.'
          : response.status === 429
            ? 'MyAnimeList rate limit exceeded.'
            : `MyAnimeList request failed with status ${response.status}.`;
      throw new MyAnimeListApiError(
        response.status,
        message,
        Number.isFinite(retryAfter) ? retryAfter : undefined
      );
    }
    throw new Error('MyAnimeList request failed.');
  }
}
