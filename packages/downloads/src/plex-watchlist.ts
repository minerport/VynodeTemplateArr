export type PlexWatchlistMediaType = 'movie' | 'show';

export interface PlexWatchlistItem {
  key: string;
  mediaType: PlexWatchlistMediaType;
  title: string;
  year?: number;
  tmdbId?: number;
  tvdbId?: number;
}

export type PlexWatchlistRouteOutcome =
  | 'added'
  | 'existing'
  | 'skipped';

export interface PlexWatchlistRouter {
  route(
    item: PlexWatchlistItem,
    signal?: AbortSignal
  ): Promise<PlexWatchlistRouteOutcome>;
}

export interface PlexWatchlistSyncReport {
  scanned: number;
  added: number;
  existing: number;
  skipped: number;
  failed: number;
  failures: readonly string[];
  disabled: boolean;
}

export interface PlexWatchlistFetch {
  (
    url: string,
    init: {
      headers: Readonly<Record<string, string>>;
      signal?: AbortSignal;
    }
  ): Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;
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
const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';
const positiveInteger = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
};

const metadataFrom = (value: unknown): readonly JsonRecord[] =>
  records(record(record(value)?.MediaContainer)?.Metadata);

export class PlexWatchlistClient {
  public constructor(
    private readonly token: string,
    private readonly request: PlexWatchlistFetch = fetch,
    private readonly clientIdentifier = 'vynode-watchlist-sync'
  ) {
    if (!token.trim()) throw new Error('A Plex account token is required.');
  }

  public async items(signal?: AbortSignal): Promise<readonly PlexWatchlistItem[]> {
    const headers = {
      Accept: 'application/json',
      'X-Plex-Product': 'Vynode',
      'X-Plex-Version': '0.1.0',
      'X-Plex-Client-Identifier': this.clientIdentifier,
    };
    const summaries: JsonRecord[] = [];
    const pageSize = 100;
    for (let start = 0; start < 10_000; start += pageSize) {
      signal?.throwIfAborted();
      const listPayload = await this.get(
        `https://discover.provider.plex.tv/library/sections/watchlist/all?includeCollections=0&includeExternalMedia=1&includeAdvanced=0&includeMeta=0&X-Plex-Container-Start=${start}&X-Plex-Container-Size=${pageSize}`,
        headers,
        signal
      );
      const page = metadataFrom(listPayload);
      summaries.push(...page);
      const totalSize = positiveInteger(
        record(record(listPayload)?.MediaContainer)?.totalSize
      );
      if (page.length < pageSize || (totalSize && summaries.length >= totalSize))
        break;
    }
    const output: PlexWatchlistItem[] = [];
    for (let index = 0; index < summaries.length; index += 5) {
      signal?.throwIfAborted();
      const batch = summaries.slice(index, index + 5);
      const details = await Promise.all(
        batch.map(async (summary) => {
          const ratingKey = text(summary.ratingKey);
          if (!ratingKey) return undefined;
          const payload = await this.get(
            `https://discover.provider.plex.tv/library/metadata/${encodeURIComponent(ratingKey)}?includeGuids=1`,
            headers,
            signal
          );
          const item = metadataFrom(payload)[0];
          if (!item) return undefined;
          const mediaType =
            item.type === 'movie'
              ? ('movie' as const)
              : item.type === 'show'
                ? ('show' as const)
                : undefined;
          if (!mediaType) return undefined;
          const guids = records(item.Guid).map((guid) => text(guid.id));
          const tmdbId = positiveInteger(
            guids.find((guid) => guid.startsWith('tmdb://'))?.slice(7)
          );
          const tvdbId = positiveInteger(
            guids.find((guid) => guid.startsWith('tvdb://'))?.slice(7)
          );
          const title = text(item.title).trim();
          if (!title || (mediaType === 'movie' ? !tmdbId : !tvdbId))
            return undefined;
          return {
            key: `${mediaType}:${ratingKey}`,
            mediaType,
            title,
            ...(positiveInteger(item.year) ? { year: Number(item.year) } : {}),
            ...(tmdbId ? { tmdbId } : {}),
            ...(tvdbId ? { tvdbId } : {}),
          } satisfies PlexWatchlistItem;
        })
      );
      output.push(
        ...details.filter(
          (item): item is PlexWatchlistItem => item !== undefined
        )
      );
    }
    return output;
  }

  private async get(
    url: string,
    headers: Readonly<Record<string, string>>,
    signal?: AbortSignal
  ): Promise<unknown> {
    const authenticatedUrl = new URL(url);
    authenticatedUrl.searchParams.set('X-Plex-Token', this.token);
    const response = await this.request(authenticatedUrl.toString(), {
      headers,
      ...(signal ? { signal } : {}),
    });
    if (!response.ok)
      throw new Error(
        [401, 403].includes(response.status)
          ? 'Plex rejected the account authorization.'
          : `Plex watchlist request failed with status ${response.status}.`
      );
    return response.json();
  }
}

export class PlexWatchlistSyncCoordinator {
  public constructor(
    private readonly source: Pick<PlexWatchlistClient, 'items'>,
    private readonly router: PlexWatchlistRouter
  ) {}

  public async run(
    enabled: boolean,
    signal?: AbortSignal
  ): Promise<PlexWatchlistSyncReport> {
    signal?.throwIfAborted();
    if (!enabled)
      return {
        scanned: 0,
        added: 0,
        existing: 0,
        skipped: 0,
        failed: 0,
        failures: [],
        disabled: true,
      };
    const items = await this.source.items(signal);
    let added = 0;
    let existing = 0;
    let skipped = 0;
    const failures: string[] = [];
    for (const item of items) {
      signal?.throwIfAborted();
      try {
        const outcome = await this.router.route(item, signal);
        if (outcome === 'added') added += 1;
        else if (outcome === 'existing') existing += 1;
        else skipped += 1;
      } catch (error) {
        if (
          signal?.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        )
          throw error;
        failures.push(
          `${item.title}: ${
            error instanceof Error ? error.message : 'request failed'
          }`
        );
      }
    }
    return {
      scanned: items.length,
      added,
      existing,
      skipped,
      failed: failures.length,
      failures,
      disabled: false,
    };
  }
}
