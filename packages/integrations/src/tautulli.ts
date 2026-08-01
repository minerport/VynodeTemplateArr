export type TautulliMediaType = 'movie' | 'show';
export type TautulliStatType = 'plays' | 'duration';
export type TautulliCollectionType = 'most_popular' | 'most_watched';

export interface TautulliSourceItem {
  ratingKey: string;
  title: string;
  mediaType: TautulliMediaType;
  totalPlays: number;
  totalDurationSeconds: number;
  uniqueViewers: number;
  rank: number;
  year?: number;
  rating?: number;
}

export interface TautulliActivitySummary {
  totalPlays: number;
  moviePlays: number;
  showPlays: number;
}

export interface TautulliCollectionInput {
  ratingKey: string;
  title: string;
  mediaType: TautulliMediaType;
  itemCount?: number;
}

export interface TautulliCollectionStatistic extends TautulliCollectionInput {
  itemCount: number;
  totalPlays: number;
  totalDurationSeconds: number;
  viewerCount: number;
}

export interface TautulliHttpResponse {
  status: number;
  body: unknown;
}

export interface TautulliHttpTransport {
  request(input: {
    url: string;
    signal?: AbortSignal;
  }): Promise<TautulliHttpResponse>;
}

export class FetchTautulliTransport implements TautulliHttpTransport {
  public async request(input: {
    url: string;
    signal?: AbortSignal;
  }): Promise<TautulliHttpResponse> {
    const response = await fetch(input.url, {
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // Status handling below reports non-JSON failures without exposing secrets.
    }
    return { status: response.status, body };
  }
}

type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;
const records = (value: unknown): readonly JsonRecord[] =>
  Array.isArray(value)
    ? value.map(record).filter((item): item is JsonRecord => Boolean(item))
    : [];
const finite = (value: unknown): number => {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : 0;
};

export interface TautulliClientOptions {
  hostname: string;
  port: number;
  useSsl: boolean;
  urlBase: string;
  apiKey: string;
  transport?: TautulliHttpTransport;
}

export class TautulliClient {
  private readonly transport: TautulliHttpTransport;
  private readonly baseUrl: string;

  public constructor(private readonly options: TautulliClientOptions) {
    if (!options.apiKey.trim()) throw new Error('Tautulli API key is required.');
    if (
      !options.hostname.trim() ||
      options.hostname.includes('://') ||
      options.hostname.includes('/') ||
      !Number.isInteger(options.port) ||
      options.port < 1 ||
      options.port > 65535
    )
      throw new Error('Tautulli hostname and port are invalid.');
    const base = options.urlBase.trim()
      ? `/${options.urlBase.trim().replace(/^\/+|\/+$/g, '')}`
      : '';
    this.baseUrl = `${options.useSsl ? 'https' : 'http'}://${options.hostname}:${options.port}${base}/api/v2`;
    this.transport = options.transport ?? new FetchTautulliTransport();
  }

  public async test(signal?: AbortSignal): Promise<void> {
    await this.command('get_tautulli_info', {}, signal);
  }

  public async activitySummary(
    days = 7,
    signal?: AbortSignal
  ): Promise<TautulliActivitySummary> {
    this.validateDays(days);
    const [movies, shows] = await Promise.all([
      this.homeStatRows('top_movies', 'plays', days, 100, signal),
      this.homeStatRows('top_tv', 'plays', days, 100, signal),
    ]);
    const moviePlays = movies.reduce(
      (total, row) => total + finite(row.total_plays ?? row.plays),
      0
    );
    const showPlays = shows.reduce(
      (total, row) => total + finite(row.total_plays ?? row.plays),
      0
    );
    return { totalPlays: moviePlays + showPlays, moviePlays, showPlays };
  }

  public async collectionStatistics(
    collections: readonly TautulliCollectionInput[],
    days: number,
    signal?: AbortSignal
  ): Promise<readonly TautulliCollectionStatistic[]> {
    if (!Number.isInteger(days) || days < 0 || days > 9999)
      throw new Error(
        'Tautulli collection-statistics days must be from 0 through 9,999.'
      );
    const results = await Promise.allSettled(
      collections.map(async (collection) => {
        const [watchPayload, usersPayload, metadataPayload] = await Promise.all([
          this.command(
            'get_item_watch_time_stats',
            {
              rating_key: collection.ratingKey,
              media_type: 'collection',
              grouping: '1',
              query_days: String(days),
            },
            signal
          ),
          this.command(
            'get_item_user_stats',
            {
              rating_key: collection.ratingKey,
              media_type: 'collection',
              grouping: '1',
            },
            signal
          ),
          this.command(
            'get_metadata',
            { rating_key: collection.ratingKey },
            signal
          ),
        ]);
        const watchRows = records(record(record(watchPayload)?.response)?.data);
        const watch =
          watchRows.find((row) => finite(row.query_days) === days) ??
          watchRows[0];
        const userRows = records(record(record(usersPayload)?.response)?.data);
        const metadata = record(
          record(record(metadataPayload)?.response)?.data
        );
        return {
          ...collection,
          title: String(metadata?.title ?? collection.title).trim(),
          itemCount:
            finite(metadata?.children_count ?? collection.itemCount) || 0,
          totalPlays: finite(watch?.total_plays),
          totalDurationSeconds: finite(watch?.total_time),
          viewerCount: userRows.length,
        };
      })
    );
    return results.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : []
    );
  }

  public async source(
    input: {
      mediaType: TautulliMediaType;
      statType: TautulliStatType;
      collectionType: TautulliCollectionType;
      days: number;
      minimumPlays: number;
      limit: number;
    },
    signal?: AbortSignal
  ): Promise<readonly TautulliSourceItem[]> {
    this.validateDays(input.days);
    if (
      !Number.isInteger(input.minimumPlays) ||
      input.minimumPlays < 1 ||
      input.minimumPlays > 100
    )
      throw new Error('Tautulli minimum plays must be from 1 through 100.');
    if (!Number.isInteger(input.limit) || input.limit < 1 || input.limit > 9999)
      throw new Error('Tautulli item limit must be from 1 through 9,999.');
    const statId =
      input.collectionType === 'most_watched'
        ? input.mediaType === 'movie'
          ? 'top_movies'
          : 'top_tv'
        : input.mediaType === 'movie'
          ? 'popular_movies'
          : 'popular_tv';
    const rows = await this.homeStatRows(
      statId,
      input.statType,
      input.days,
      input.limit,
      signal
    );
    return rows
      .map((row, index): TautulliSourceItem | undefined => {
        const ratingKey = String(
          input.mediaType === 'show'
            ? row.grandparent_rating_key ?? row.rating_key ?? ''
            : row.rating_key ?? ''
        ).trim();
        const title = String(
          input.mediaType === 'show'
            ? row.grandparent_title ?? row.title ?? ''
            : row.title ?? ''
        ).trim();
        const totalPlays = finite(row.total_plays ?? row.plays);
        const totalDurationSeconds = finite(
          row.total_duration ?? row.total_time
        );
        const uniqueViewers = finite(row.users_watched);
        if (!ratingKey || !title || totalPlays < input.minimumPlays)
          return undefined;
        const year = finite(row.year);
        const rating = finite(row.rating);
        return {
          ratingKey,
          title,
          mediaType: input.mediaType,
          totalPlays,
          totalDurationSeconds,
          uniqueViewers,
          rank: index + 1,
          ...(year > 0 ? { year } : {}),
          ...(rating > 0 ? { rating } : {}),
        };
      })
      .filter((item): item is TautulliSourceItem => Boolean(item))
      .slice(0, input.limit);
  }

  private validateDays(days: number): void {
    if (!Number.isInteger(days) || days < 1 || days > 365)
      throw new Error('Tautulli statistics days must be from 1 through 365.');
  }

  private async homeStatRows(
    statId: string,
    statType: TautulliStatType,
    days: number,
    limit: number,
    signal?: AbortSignal
  ): Promise<readonly JsonRecord[]> {
    const payload = await this.command(
      'get_home_stats',
      {
        time_range: String(days),
        stats_type: statType,
        stat_id: statId,
        stats_count: String(limit),
        stats_start: '0',
      },
      signal
    );
    const data = record(record(payload)?.response)?.data;
    const stat = Array.isArray(data)
      ? records(data).find((item) => item.stat_id === statId)
      : record(data);
    if (stat?.stat_id === statId && Array.isArray(stat.rows))
      return records(stat.rows);
    if (Array.isArray(data)) {
      const rows = records(data);
      if (rows.every((item) => !('stat_id' in item))) return rows;
    }
    throw new Error(`Tautulli returned no "${statId}" statistics payload.`);
  }

  private async command(
    command: string,
    parameters: Readonly<Record<string, string>>,
    signal?: AbortSignal
  ): Promise<unknown> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('apikey', this.options.apiKey);
    url.searchParams.set('cmd', command);
    for (const [name, value] of Object.entries(parameters))
      url.searchParams.set(name, value);
    const response = await this.transport.request({
      url: url.toString(),
      ...(signal ? { signal } : {}),
    });
    if (response.status < 200 || response.status >= 300)
      throw new Error(
        [400, 401, 403].includes(response.status)
          ? 'Tautulli rejected the API key.'
          : `Tautulli request failed with status ${response.status}.`
      );
    const envelope = record(record(response.body)?.response);
    if (!envelope || envelope.result !== 'success')
      throw new Error(
        typeof envelope?.message === 'string'
          ? `Tautulli: ${envelope.message}`
          : 'Tautulli returned an invalid response.'
      );
    return response.body;
  }
}
