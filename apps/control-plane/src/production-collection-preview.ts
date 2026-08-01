import type {
  CollectionPreviewResult,
  ManagedCollection,
} from '@vynode/contracts';
import {
  AniListClient,
  FlixPatrolClient,
  ImdbClient,
  LetterboxdClient,
  MDBListClient,
  MyAnimeListClient,
  TautulliClient,
  TmdbSourceClient,
  TraktClient,
  type TmdbSourceItem,
} from '@vynode/integrations';
import { composeSources } from '@vynode/planner';

type QueryPlex = (path: string, signal?: AbortSignal) => Promise<unknown>;
export interface ProductionCollectionPreviewOptions {
  tmdbApiKey(): Promise<string | undefined>;
  integration(
    id: 'trakt' | 'mdblist' | 'myanimelist' | 'tautulli'
  ): Promise<
    | { values: Record<string, string | number | boolean>; secret?: string }
    | undefined
  >;
  arrSource?(
    kind: 'radarr' | 'sonarr',
    serverId: string,
    tagId: number,
    signal?: AbortSignal
  ): Promise<
    readonly {
      title: string;
      year?: number;
      tmdbId?: number;
      tvdbId?: number;
    }[]
  >;
  arrMonitored?(
    kind: 'radarr' | 'sonarr',
    signal?: AbortSignal
  ): Promise<
    readonly {
      title: string;
      year?: number;
      tmdbId?: number;
      tvdbId?: number;
      releaseAt?: string;
    }[]
  >;
  seerrSource?(
    mediaType: 'movie' | 'show',
    subtype: 'global' | 'server_owner' | 'users' | 'user',
    limit: number,
    requesterId?: number,
    signal?: AbortSignal
  ): Promise<
    readonly { title: string; year?: number; tmdbId: number; tvdbId?: number }[]
  >;
  plexQuery: QueryPlex;
  fetch?: typeof globalThis.fetch;
  imdbClient?: Pick<ImdbClient, 'source'>;
  tautulliClient?: Pick<TautulliClient, 'source'>;
  flixpatrolClient?: Pick<FlixPatrolClient, 'source'>;
}

const ordered = (
  items: readonly TmdbSourceItem[],
  order: string
): TmdbSourceItem[] => {
  const result = [...items];
  if (order === 'reverse') result.reverse();
  else if (order === 'alphabetical')
    result.sort((a, b) => a.title.localeCompare(b.title));
  else if (order === 'rating-desc')
    result.sort((a, b) => (b.voteAverage ?? -1) - (a.voteAverage ?? -1));
  else if (order === 'rating-asc')
    result.sort(
      (a, b) => (a.voteAverage ?? Infinity) - (b.voteAverage ?? Infinity)
    );
  else if (order === 'release-desc')
    result.sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
  else if (order === 'release-asc')
    result.sort((a, b) => (a.year ?? Infinity) - (b.year ?? Infinity));
  else if (order === 'random')
    for (let i = result.length - 1; i > 0; i--) {
      const target = Math.floor(Math.random() * (i + 1));
      [result[i], result[target]] = [result[target]!, result[i]!];
    }
  return result;
};
interface SourceItem {
  mediaType: 'movie' | 'show';
  title: string;
  year?: number;
  tmdbId?: number;
  imdbId?: string;
  voteAverage?: number;
}
const plexGuids = (
  payload: unknown
): {
  tmdb: Map<number, string>;
  tvdb: Map<number, string>;
  imdb: Map<string, string>;
  keys: Set<string>;
} => {
  const result = {
    tmdb: new Map<number, string>(),
    tvdb: new Map<number, string>(),
    imdb: new Map<string, string>(),
    keys: new Set<string>(),
  };
  const container =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>).MediaContainer
      : undefined;
  const rows =
    container && typeof container === 'object'
      ? (container as Record<string, unknown>).Metadata
      : undefined;
  if (!Array.isArray(rows)) return result;
  for (const row of rows) {
    if (!row || typeof row !== 'object') continue;
    const value = row as Record<string, unknown>;
    const ratingKey =
      typeof value.ratingKey === 'string'
        ? value.ratingKey
        : String(value.ratingKey ?? '');
    if (ratingKey) result.keys.add(ratingKey);
    const guids = Array.isArray(value.Guid) ? value.Guid : [];
    for (const guid of guids) {
      const id =
        guid && typeof guid === 'object'
          ? (guid as Record<string, unknown>).id
          : undefined;
      if (typeof id !== 'string' || !ratingKey) continue;
      const tmdb = id.match(/^tmdb:\/\/(\d+)$/);
      const tvdb = id.match(/^tvdb:\/\/(\d+)$/);
      const imdb = id.match(/^imdb:\/\/(tt\d+)$/);
      if (tmdb) result.tmdb.set(Number(tmdb[1]), ratingKey);
      if (tvdb) result.tvdb.set(Number(tvdb[1]), ratingKey);
      if (imdb) result.imdb.set(imdb[1]!, ratingKey);
    }
  }
  return result;
};
const plexRows = (payload: unknown): Record<string, unknown>[] => {
  const container =
    payload && typeof payload === 'object'
      ? (payload as Record<string, unknown>).MediaContainer
      : undefined;
  const rows =
    container && typeof container === 'object'
      ? (container as Record<string, unknown>).Metadata
      : undefined;
  return Array.isArray(rows)
    ? rows.filter(
        (row): row is Record<string, unknown> =>
          Boolean(row) && typeof row === 'object'
      )
    : [];
};
const generatorValues = (
  row: Record<string, unknown>,
  subtype: string
): string[] => {
  if (subtype === 'genres')
    return (Array.isArray(row.Genre) ? row.Genre : []).flatMap((value) =>
      value &&
      typeof value === 'object' &&
      typeof (value as Record<string, unknown>).tag === 'string'
        ? [(value as Record<string, unknown>).tag as string]
        : []
    );
  if (subtype === 'decades') {
    const year = Number(row.year);
    return Number.isInteger(year) ? [`${Math.floor(year / 10) * 10}s`] : [];
  }
  if (subtype === 'content-ratings')
    return typeof row.contentRating === 'string' ? [row.contentRating] : [];
  if (subtype === 'resolutions')
    return (Array.isArray(row.Media) ? row.Media : []).flatMap((value) =>
      value &&
      typeof value === 'object' &&
      typeof (value as Record<string, unknown>).videoResolution === 'string'
        ? [(value as Record<string, unknown>).videoResolution as string]
        : []
    );
  return [];
};
const ORIGINALS_LISTS: Readonly<Record<string, string>> = {
  apple_originals: 'https://mdblist.com/lists/k0meta/appletv-originals',
  disney_originals: 'https://mdblist.com/lists/k0meta/disney-originals',
  hbomax_originals: 'https://mdblist.com/lists/k0meta/hbomax-originals',
  hulu_originals: 'https://mdblist.com/lists/k0meta/hulu-originals',
  netflix_originals: 'https://mdblist.com/lists/k0meta/netflix-originals',
  paramount_originals: 'https://mdblist.com/lists/k0meta/paramount-originals',
  peacock_originals: 'https://mdblist.com/lists/k0meta/peacock-originals',
  amazon_originals: 'https://mdblist.com/lists/k0meta/amazon-originals',
  discovery_originals: 'https://mdblist.com/lists/k0meta/discovery-movies',
};

export class ProductionCollectionPreview {
  public constructor(
    private readonly options: ProductionCollectionPreviewOptions
  ) {}
  async #network(
    collection: ManagedCollection,
    signal?: AbortSignal
  ): Promise<{ items: readonly TmdbSourceItem[]; warnings: string[] }> {
    const settings = collection.sourceSettings!;
    const key = await this.options.tmdbApiKey();
    if (!key)
      throw new Error(
        'Configure and test TMDB in Settings before previewing Networks Top 10.'
      );
    if (!settings.subtype) throw new Error('Choose a streaming platform.');
    const listed = await (
      this.options.flixpatrolClient ??
      new FlixPatrolClient({
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      })
    ).source(
      {
        platform: settings.subtype,
        country: settings.networkCountry ?? settings.region ?? 'US',
        mediaType: collection.mediaType,
        limit: settings.maxItems,
      },
      signal
    );
    const client = new TmdbSourceClient({
      apiKey: key,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
    const resolved: TmdbSourceItem[] = [];
    for (const item of listed) {
      signal?.throwIfAborted();
      const match = await client.search(
        collection.mediaType,
        item.title,
        undefined,
        signal
      );
      if (match) resolved.push(match);
    }
    const missing = listed.length - resolved.length;
    return {
      items: ordered(resolved, settings.itemOrder),
      warnings: missing
        ? [
            `${missing} FlixPatrol title${missing === 1 ? ' could' : 's could'} not be resolved through TMDB.`,
          ]
        : [],
    };
  }
  async #originals(
    collection: ManagedCollection,
    signal?: AbortSignal
  ): Promise<{ items: readonly TmdbSourceItem[]; warnings: string[] }> {
    const settings = collection.sourceSettings!;
    const configured = await this.options.integration('mdblist');
    if (!configured?.secret)
      throw new Error(
        'Configure and test MDBList in Settings before previewing Network Originals.'
      );
    const listUrl = ORIGINALS_LISTS[settings.subtype];
    if (!listUrl) throw new Error('Choose a supported originals provider.');
    const items = await new MDBListClient({ apiKey: configured.secret }).source(
      { listUrl, mediaType: collection.mediaType, limit: settings.maxItems },
      signal
    );
    return { items: ordered(items, settings.itemOrder), warnings: [] };
  }
  async #comingSoonTmdb(
    collection: ManagedCollection,
    signal?: AbortSignal
  ): Promise<{ items: readonly TmdbSourceItem[]; warnings: string[] }> {
    const settings = collection.sourceSettings!;
    const key = await this.options.tmdbApiKey();
    if (!key)
      throw new Error(
        'Configure and test TMDB in Settings before previewing TMDB Coming Soon.'
      );
    const items = await new TmdbSourceClient({
      apiKey: key,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    }).source(
      {
        mediaType: collection.mediaType,
        subtype: 'upcoming',
        limit: settings.maxItems,
        ...(settings.region ? { region: settings.region } : {}),
      },
      signal
    );
    return { items: ordered(items, settings.itemOrder), warnings: [] };
  }
  async #tmdb(
    collection: ManagedCollection,
    signal?: AbortSignal
  ): Promise<readonly TmdbSourceItem[]> {
    const key = await this.options.tmdbApiKey();
    if (!key)
      throw new Error(
        'Configure and test TMDB in Settings before previewing this source.'
      );
    const settings = collection.sourceSettings;
    if (!settings) throw new Error('The collection source is incomplete.');
    const client = new TmdbSourceClient({
      apiKey: key,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
    if (collection.sourceType === 'letterboxd') {
      if (collection.mediaType !== 'movie')
        throw new Error('Letterboxd sources require a Movie library.');
      const listed = await new LetterboxdClient({
        ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      }).source(
        {
          subtype: settings.subtype as 'custom' | 'watchlist' | 'random',
          limit: settings.maxItems,
          ...(settings.customUrl ? { url: settings.customUrl } : {}),
          ...(settings.randomListUrls
            ? { randomUrls: settings.randomListUrls }
            : {}),
        },
        signal
      );
      const resolved: TmdbSourceItem[] = [];
      for (const item of listed) {
        signal?.throwIfAborted();
        const match = await client.search(
          'movie',
          item.title,
          item.year,
          signal
        );
        if (match) resolved.push(match);
      }
      return ordered(resolved, settings.itemOrder);
    }
    const randomUrl =
      settings.subtype === 'random'
        ? settings.randomListUrls?.filter(Boolean)[
            Math.floor(
              Math.random() *
                (settings.randomListUrls?.filter(Boolean).length ?? 0)
            )
          ]
        : undefined;
    const subtype =
      settings.subtype === 'random' || settings.subtype === 'custom'
        ? 'custom'
        : settings.subtype === 'advanced_custom_tmdb'
          ? 'discover'
          : settings.subtype;
    if (
      ![
        'trending_day',
        'trending_week',
        'popular',
        'top_rated',
        'upcoming',
        'custom',
        'discover',
      ].includes(subtype)
    )
      throw new Error(`Unsupported TMDB subtype "${settings.subtype}".`);
    const discover: Record<string, string | number | boolean> = {
      sort_by:
        collection.mediaType === 'movie'
          ? (collection.tmdbDiscoverSettings?.movieSortBy ?? 'popularity.desc')
          : (collection.tmdbDiscoverSettings?.tvSortBy ?? 'popularity.desc'),
    };
    for (const group of collection.tmdbDiscoverSettings?.filterGroups ?? [])
      for (const rule of group.filters)
        if (rule.field) discover[rule.field] = rule.value;
    return ordered(
      await client.source(
        {
          mediaType: collection.mediaType,
          subtype: subtype as
            | 'trending_day'
            | 'trending_week'
            | 'popular'
            | 'top_rated'
            | 'upcoming'
            | 'custom'
            | 'discover',
          limit: settings.maxItems,
          ...(randomUrl || settings.customUrl
            ? { customUrl: randomUrl ?? settings.customUrl }
            : {}),
          ...(subtype === 'discover' ? { discover } : {}),
          ...(settings.region ? { region: settings.region } : {}),
        },
        signal
      ),
      settings.itemOrder
    );
  }
  async #source(
    collection: ManagedCollection,
    signal?: AbortSignal
  ): Promise<{ items: readonly TmdbSourceItem[]; warnings: string[] }> {
    const settings = collection.sourceSettings;
    if (!settings) throw new Error('The collection source is incomplete.');
    if (
      collection.sourceType === 'tmdb' ||
      collection.sourceType === 'letterboxd'
    )
      return { items: await this.#tmdb(collection, signal), warnings: [] };
    if (
      collection.sourceType === 'trakt' ||
      collection.sourceType === 'comingsoon'
    ) {
      const configured = await this.options.integration('trakt');
      const clientId = String(configured?.values.clientId ?? '');
      if (!clientId)
        throw new Error(
          'Configure and test Trakt in Settings before previewing this source.'
        );
      const subtype =
        collection.sourceType === 'comingsoon'
          ? 'anticipated'
          : settings.subtype;
      const items = await new TraktClient({ clientId }).source(
        {
          mediaType: collection.mediaType,
          subtype: subtype as
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
            | 'custom',
          limit: settings.maxItems,
          ...(settings.timePeriod ? { period: settings.timePeriod } : {}),
          ...(settings.customUrl ? { customUrl: settings.customUrl } : {}),
        },
        signal
      );
      return { items: ordered(items, settings.itemOrder), warnings: [] };
    }
    if (collection.sourceType === 'mdblist') {
      const configured = await this.options.integration('mdblist');
      if (!configured?.secret)
        throw new Error(
          'Configure and test MDBList in Settings before previewing this source.'
        );
      if (!settings.customUrl) throw new Error('An MDBList URL is required.');
      const items = await new MDBListClient({
        apiKey: configured.secret,
      }).source(
        {
          listUrl: settings.customUrl,
          mediaType: collection.mediaType,
          limit: settings.maxItems,
        },
        signal
      );
      return { items: ordered(items, settings.itemOrder), warnings: [] };
    }
    if (collection.sourceType === 'mal') {
      const configured = await this.options.integration('myanimelist');
      if (!configured?.secret)
        throw new Error(
          'Configure and test MyAnimeList in Settings before previewing this source.'
        );
      const items = await new MyAnimeListClient({
        clientId: configured.secret,
      }).source(
        {
          rankingType: settings.subtype as
            | 'all'
            | 'airing'
            | 'tv'
            | 'ova'
            | 'movie'
            | 'special'
            | 'bypopularity'
            | 'favorite',
          mediaType: collection.mediaType,
          limit: settings.maxItems,
        },
        signal
      );
      return {
        items: ordered(
          items.flatMap((item) =>
            item.tmdbIds[0]
              ? [
                  {
                    tmdbId: item.tmdbIds[0],
                    mediaType: item.mediaType,
                    title: item.title,
                    ...(item.year ? { year: item.year } : {}),
                  },
                ]
              : []
          ),
          settings.itemOrder
        ),
        warnings: items.some((item) => !item.tmdbIds.length)
          ? ['Some MyAnimeList items had no TMDB identity and were skipped.']
          : [],
      };
    }
    if (collection.sourceType === 'anilist') {
      const items = await new AniListClient().source(
        {
          subtype: settings.subtype as
            | 'trending'
            | 'popular'
            | 'top_rated'
            | 'custom',
          mediaType: collection.mediaType,
          limit: settings.maxItems,
          ...(settings.customUrl ? { customUrl: settings.customUrl } : {}),
        },
        signal
      );
      return {
        items: ordered(
          items.flatMap((item) =>
            item.tmdbIds[0]
              ? [
                  {
                    tmdbId: item.tmdbIds[0],
                    mediaType: item.mediaType,
                    title: item.title,
                    ...(item.year ? { year: item.year } : {}),
                  },
                ]
              : []
          ),
          settings.itemOrder
        ),
        warnings: items.some((item) => !item.tmdbIds.length)
          ? ['Some AniList items had no TMDB identity and were skipped.']
          : [],
      };
    }
    if (collection.sourceType === 'multi-source') {
      const multi = collection.multiSourceSettings;
      if (!multi?.sources.length)
        throw new Error(
          'Add at least one dependency to this multi-source collection.'
        );
      const composed = await composeSources(
        multi.sources.map((entry) => ({
          id: entry.id,
          priority: entry.priority,
          load: async () => {
            const child: ManagedCollection = {
              ...collection,
              sourceType: entry.type,
              sourceSettings: {
                ...settings,
                subtype: entry.subtype,
                ...(entry.customUrl ? { customUrl: entry.customUrl } : {}),
                ...(entry.timePeriod ? { timePeriod: entry.timePeriod } : {}),
              },
            };
            return (await this.#source(child, signal)).items.map((item) => ({
              ...item,
              key: `${item.mediaType}:tmdb:${item.tmdbId}`,
            }));
          },
        })),
        {
          mode: multi.combineMode,
          limit: settings.maxItems,
          cycleIndex: new Date().getUTCDate() - 1,
        },
        signal
      );
      return {
        items: composed.items,
        warnings: composed.failures.map(
          (failure) => `${failure.sourceId}: ${failure.message}`
        ),
      };
    }
    throw new Error(
      `${collection.sourceType} production preview is not connected yet.`
    );
  }
  public async preview(
    collection: ManagedCollection,
    signal?: AbortSignal
  ): Promise<CollectionPreviewResult> {
    const episodeHub =
      collection.sourceType === 'filtered-hub' &&
      collection.sourceSettings?.subtype === 'recently_released_episodes';
    const requestedType =
      collection.itemType === 'episode' || episodeHub
        ? '4'
        : collection.itemType === 'season'
          ? '3'
          : collection.mediaType === 'show'
            ? '2'
            : '1';
    const libraryPayload = await this.options.plexQuery(
      `/library/sections/${encodeURIComponent(collection.libraryId)}/all?includeGuids=1&type=${requestedType}`,
      signal
    );
    const plex = plexGuids(libraryPayload);
    if (collection.sourceType === 'manual') {
      const selected = collection.sourceSettings?.manualMembers ?? [];
      const items = selected.map((item) => ({
        title: item.title,
        ...(item.year ? { year: item.year } : {}),
        ...(plex.keys.has(item.ratingKey)
          ? { plexRatingKey: item.ratingKey }
          : {}),
        available: plex.keys.has(item.ratingKey),
      }));
      const matchedCount = items.filter((item) => item.available).length;
      return {
        collectionId: collection.id,
        sourceType: collection.sourceType,
        fetchedCount: items.length,
        matchedCount,
        missingCount: items.length - matchedCount,
        items,
        warnings:
          items.length === 0
            ? ['Add at least one Plex item to this manual collection.']
            : matchedCount === items.length
              ? []
              : [
                  `${items.length - matchedCount} selected Plex item${items.length - matchedCount === 1 ? ' no longer exists' : 's no longer exist'} in this library.`,
                ],
      };
    }
    if (
      collection.sourceType === 'radarrtag' ||
      collection.sourceType === 'sonarrtag'
    ) {
      const settings = collection.sourceSettings;
      const kind = collection.sourceType === 'radarrtag' ? 'radarr' : 'sonarr';
      const arrSource = this.options.arrSource;
      if (!arrSource)
        throw new Error('Production download-service sources are unavailable.');
      if (
        !settings?.arrServerId ||
        !Number.isInteger(settings.arrTagId) ||
        settings.arrTagId! < 1
      )
        throw new Error(
          `Choose a verified ${kind === 'radarr' ? 'Radarr' : 'Sonarr'} server and tag.`
        );
      const source = await arrSource(
        kind,
        settings.arrServerId,
        settings.arrTagId!,
        signal
      );
      const items = source.map((item) => {
        const plexRatingKey = item.tmdbId
          ? plex.tmdb.get(item.tmdbId)
          : item.tvdbId
            ? plex.tvdb.get(item.tvdbId)
            : undefined;
        return {
          title: item.title,
          ...(item.year ? { year: item.year } : {}),
          ...(item.tmdbId ? { tmdbId: item.tmdbId } : {}),
          ...(item.tvdbId ? { tvdbId: item.tvdbId } : {}),
          ...(plexRatingKey ? { plexRatingKey } : {}),
          available: Boolean(plexRatingKey),
        };
      });
      const matchedCount = items.filter((item) => item.available).length;
      return {
        collectionId: collection.id,
        sourceType: collection.sourceType,
        fetchedCount: items.length,
        matchedCount,
        missingCount: items.length - matchedCount,
        items,
        warnings:
          items.length === 0
            ? [
                `${kind === 'radarr' ? 'Radarr' : 'Sonarr'} returned no items with the selected tag.`,
              ]
            : matchedCount === items.length
              ? []
              : [
                  `${items.length - matchedCount} tagged item${items.length - matchedCount === 1 ? ' is' : 's are'} not available in this Plex library.`,
                ],
      };
    }
    if (collection.sourceType === 'seerr') {
      const settings = collection.sourceSettings;
      if (!settings)
        throw new Error('The Seerr collection source is incomplete.');
      const sourceProvider = this.options.seerrSource;
      if (!sourceProvider)
        throw new Error(
          'The Seerr production source is not connected. Connect and test Seerr before previewing it.'
        );
      if (
        !['global', 'server_owner', 'users', 'user'].includes(settings.subtype)
      )
        throw new Error(`Unsupported Seerr subtype "${settings.subtype}".`);
      if (
        settings.subtype === 'user' &&
        (!Number.isInteger(settings.seerrUserId) || settings.seerrUserId! <= 0)
      )
        throw new Error(
          'Choose a valid Seerr user for this private collection.'
        );
      const source = await sourceProvider(
        collection.mediaType,
        settings.subtype as 'global' | 'server_owner' | 'users' | 'user',
        settings.maxItems,
        settings.seerrUserId,
        signal
      );
      const items = source.map((item) => {
        const plexRatingKey =
          plex.tmdb.get(item.tmdbId) ??
          (item.tvdbId ? plex.tvdb.get(item.tvdbId) : undefined);
        return {
          title: item.title,
          ...(item.year ? { year: item.year } : {}),
          tmdbId: item.tmdbId,
          ...(item.tvdbId ? { tvdbId: item.tvdbId } : {}),
          ...(plexRatingKey ? { plexRatingKey } : {}),
          available: Boolean(plexRatingKey),
        };
      });
      const matchedCount = items.filter((item) => item.available).length;
      return {
        collectionId: collection.id,
        sourceType: collection.sourceType,
        fetchedCount: items.length,
        matchedCount,
        missingCount: items.length - matchedCount,
        items,
        warnings:
          items.length === 0
            ? ['Seerr returned no requests for this collection.']
            : matchedCount === items.length
              ? []
              : [
                  `${items.length - matchedCount} Seerr request${items.length - matchedCount === 1 ? ' is' : 's are'} not available in this Plex library.`,
                ],
      };
    }
    if (
      collection.sourceType === 'comingsoon' &&
      collection.sourceSettings?.subtype === 'monitored'
    ) {
      const arrMonitored = this.options.arrMonitored;
      if (!arrMonitored)
        throw new Error(
          'Production monitored Coming Soon sources are unavailable.'
        );
      const kind = collection.mediaType === 'movie' ? 'radarr' : 'sonarr';
      const settings = collection.sourceSettings;
      const source = [...(await arrMonitored(kind, signal))].slice(
        0,
        settings.maxItems
      );
      const items = source.map((item) => {
        const plexRatingKey = item.tmdbId
          ? plex.tmdb.get(item.tmdbId)
          : item.tvdbId
            ? plex.tvdb.get(item.tvdbId)
            : undefined;
        return {
          title: item.title,
          ...(item.year ? { year: item.year } : {}),
          ...(item.tmdbId ? { tmdbId: item.tmdbId } : {}),
          ...(item.tvdbId ? { tvdbId: item.tvdbId } : {}),
          ...(plexRatingKey ? { plexRatingKey } : {}),
          available: Boolean(plexRatingKey),
        };
      });
      const matchedCount = items.filter((item) => item.available).length;
      return {
        collectionId: collection.id,
        sourceType: collection.sourceType,
        fetchedCount: items.length,
        matchedCount,
        missingCount: items.length - matchedCount,
        items,
        warnings: items.length
          ? []
          : [
              `${kind === 'radarr' ? 'Radarr' : 'Sonarr'} has no monitored titles with a future release.`,
            ],
      };
    }
    if (collection.sourceType === 'tautulli') {
      const settings = collection.sourceSettings;
      if (!settings)
        throw new Error('The Tautulli collection source is incomplete.');
      const configured = await this.options.integration('tautulli');
      if (
        !this.options.tautulliClient &&
        (!configured?.secret || !configured.values.hostname)
      )
        throw new Error(
          'Configure and test Tautulli in Settings before previewing this source.'
        );
      const subtype = settings.subtype;
      if (
        ![
          'most_popular_plays',
          'most_popular_duration',
          'most_watched_plays',
          'most_watched_duration',
        ].includes(subtype)
      )
        throw new Error(`Unsupported Tautulli subtype "${subtype}".`);
      const client =
        this.options.tautulliClient ??
        new TautulliClient({
          hostname: String(configured!.values.hostname),
          port: Number(configured!.values.port),
          useSsl: Boolean(configured!.values.useSsl),
          urlBase: String(configured!.values.urlBase ?? ''),
          apiKey: configured!.secret!,
        });
      let source = [
        ...(await client.source(
          {
            mediaType: collection.mediaType,
            statType: subtype.endsWith('_duration') ? 'duration' : 'plays',
            collectionType: subtype.startsWith('most_watched')
              ? 'most_watched'
              : 'most_popular',
            days: settings.customDays ?? 30,
            minimumPlays: settings.minimumPlays ?? 3,
            limit: settings.maxItems,
          },
          signal
        )),
      ];
      if (settings.itemOrder === 'reverse') source.reverse();
      else if (settings.itemOrder === 'alphabetical')
        source.sort((a, b) => a.title.localeCompare(b.title));
      else if (settings.itemOrder === 'rating-desc')
        source.sort((a, b) => (b.rating ?? -1) - (a.rating ?? -1));
      else if (settings.itemOrder === 'rating-asc')
        source.sort((a, b) => (a.rating ?? Infinity) - (b.rating ?? Infinity));
      const items = source.map((item) => ({
        title: item.title,
        ...(item.year ? { year: item.year } : {}),
        ...(plex.keys.has(item.ratingKey)
          ? { plexRatingKey: item.ratingKey }
          : {}),
        available: plex.keys.has(item.ratingKey),
      }));
      const matchedCount = items.filter((item) => item.available).length;
      return {
        collectionId: collection.id,
        sourceType: collection.sourceType,
        fetchedCount: items.length,
        matchedCount,
        missingCount: items.length - matchedCount,
        items,
        warnings:
          items.length === 0
            ? ['Tautulli returned no media for this collection.']
            : matchedCount === items.length
              ? []
              : [
                  `${items.length - matchedCount} Tautulli item${items.length - matchedCount === 1 ? ' is' : 's are'} not available in this Plex library.`,
                ],
      };
    }
    if (collection.sourceType === 'filtered-hub') {
      const settings = collection.sourceSettings;
      if (!settings) throw new Error('The filtered hub source is incomplete.');
      const days = Math.max(1, Math.min(365, settings.customDays ?? 30));
      const cutoff = Date.now() - days * 86_400_000;
      const rows = plexRows(libraryPayload)
        .filter((row) => {
          const raw =
            settings.subtype === 'recently_added'
              ? row.addedAt
              : row.originallyAvailableAt;
          const timestamp =
            typeof raw === 'number'
              ? raw * 1000
              : typeof raw === 'string'
                ? Date.parse(raw)
                : NaN;
          return Number.isFinite(timestamp) && timestamp >= cutoff;
        })
        .sort((a, b) => {
          const field =
            settings.subtype === 'recently_added'
              ? 'addedAt'
              : 'originallyAvailableAt';
          const time = (row: Record<string, unknown>) =>
            typeof row[field] === 'number'
              ? Number(row[field]) * 1000
              : Date.parse(String(row[field] ?? ''));
          return time(b) - time(a);
        })
        .slice(0, settings.maxItems);
      const items = rows.flatMap((row) => {
        const ratingKey = String(row.ratingKey ?? '');
        const title = String(row.title ?? '').trim();
        if (!ratingKey || !title) return [];
        const year = Number(row.year);
        return [
          {
            title,
            ...(Number.isInteger(year) ? { year } : {}),
            plexRatingKey: ratingKey,
            available: true,
          },
        ];
      });
      return {
        collectionId: collection.id,
        sourceType: collection.sourceType,
        fetchedCount: items.length,
        matchedCount: items.length,
        missingCount: 0,
        items,
        warnings: items.length
          ? []
          : [`No Plex items matched the most recent ${days}-day window.`],
      };
    }
    if (collection.sourceType === 'plex') {
      const settings = collection.sourceSettings;
      if (!settings)
        throw new Error(
          'Configure a Plex library generator before previewing this collection.'
        );
      if (settings.subtype === 'actors' || settings.subtype === 'directors') {
        const counts = new Map<string, { name: string; count: number }>();
        for (const row of plexRows(libraryPayload)) {
          const entries = Array.isArray(
            settings.subtype === 'actors' ? row.Role : row.Director
          )
            ? settings.subtype === 'actors'
              ? (row.Role as unknown[])
              : (row.Director as unknown[])
            : [];
          for (const entry of entries) {
            const name =
              entry && typeof entry === 'object'
                ? String((entry as Record<string, unknown>).tag ?? '').trim()
                : '';
            const key = name.toLocaleLowerCase();
            if (!key) continue;
            const current = counts.get(key);
            counts.set(key, {
              name: current?.name ?? name,
              count: (current?.count ?? 0) + 1,
            });
          }
        }
        const minimum = settings.personMinimumItems ?? 5;
        const token = settings.subtype === 'actors' ? '{actor}' : '{director}';
        const items = [...counts.values()]
          .filter((person) => person.count >= minimum)
          .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
          .slice(0, settings.maxItems)
          .map((person) => ({
            title: collection.title.includes(token)
              ? collection.title.replaceAll(token, person.name)
              : person.name,
            available: true,
          }));
        return {
          collectionId: collection.id,
          sourceType: collection.sourceType,
          fetchedCount: counts.size,
          matchedCount: items.length,
          missingCount: counts.size - items.length,
          items,
          warnings: items.length
            ? []
            : [
                `No ${settings.subtype} meet the ${minimum}-item minimum in this Plex library.`,
              ],
        };
      }
      const generator = settings.plexGenerator;
      if (!generator)
        throw new Error(
          'Configure a Plex library generator before previewing this collection.'
        );
      const selected = new Set(
        generator.selectedValues.length
          ? generator.selectedValues
          : plexRows(libraryPayload).flatMap((row) =>
              generatorValues(row, settings.subtype)
            )
      );
      const rows = plexRows(libraryPayload)
        .filter((row) => {
          const matches = generatorValues(row, settings.subtype).some((value) =>
            selected.has(value)
          );
          return generator.selectionMode === 'include' ? matches : !matches;
        })
        .slice(0, settings.maxItems);
      const items = rows.flatMap((row) => {
        const ratingKey = String(row.ratingKey ?? '');
        const title = String(row.title ?? '').trim();
        if (!ratingKey || !title) return [];
        const year = Number(row.year);
        return [
          {
            title,
            ...(Number.isInteger(year) ? { year } : {}),
            plexRatingKey: ratingKey,
            available: true,
          },
        ];
      });
      return {
        collectionId: collection.id,
        sourceType: collection.sourceType,
        fetchedCount: items.length,
        matchedCount: items.length,
        missingCount: 0,
        items,
        warnings: items.length
          ? []
          : ['No Plex library items matched the selected generator values.'],
      };
    }
    if (collection.sourceType === 'imdb') {
      const settings = collection.sourceSettings;
      if (!settings)
        throw new Error('The IMDb collection source is incomplete.');
      const subtype =
        settings.subtype === 'random' ? 'custom' : settings.subtype;
      if (
        ![
          'top_250',
          'top_250_english',
          'popular',
          'boxoffice',
          'custom',
        ].includes(subtype)
      )
        throw new Error(`Unsupported IMDb subtype "${settings.subtype}".`);
      const source = await (this.options.imdbClient ?? new ImdbClient()).source(
        {
          mediaType: collection.mediaType,
          subtype: subtype as
            | 'top_250'
            | 'top_250_english'
            | 'popular'
            | 'boxoffice'
            | 'custom',
          limit: settings.maxItems,
          ...(settings.customUrl ? { customUrl: settings.customUrl } : {}),
        },
        signal
      );
      const items = source.map((item) => {
        const plexRatingKey = plex.imdb.get(item.imdbId);
        return {
          title: item.title,
          ...(item.year ? { year: item.year } : {}),
          ...(plexRatingKey ? { plexRatingKey } : {}),
          available: Boolean(plexRatingKey),
        };
      });
      const matchedCount = items.filter((item) => item.available).length;
      return {
        collectionId: collection.id,
        sourceType: collection.sourceType,
        fetchedCount: items.length,
        matchedCount,
        missingCount: items.length - matchedCount,
        items,
        warnings:
          items.length === 0
            ? ['IMDb returned no media for this collection.']
            : matchedCount === items.length
              ? []
              : [
                  `${items.length - matchedCount} IMDb item${items.length - matchedCount === 1 ? ' is' : 's are'} not currently available in this Plex library.`,
                ],
      };
    }
    if (
      collection.sourceType === 'comingsoon' &&
      collection.sourceSettings?.subtype === 'monitored'
    )
      throw new Error(
        'Monitored Coming Soon requires a default Radarr or Sonarr production source and is not connected yet.'
      );
    const source =
      collection.sourceType === 'networks'
        ? await this.#network(collection, signal)
        : collection.sourceType === 'originals'
          ? await this.#originals(collection, signal)
          : collection.sourceType === 'comingsoon' &&
              collection.sourceSettings?.subtype === 'tmdb_anticipated'
            ? await this.#comingSoonTmdb(collection, signal)
            : await this.#source(collection, signal);
    const items = source.items.map((item) => {
      const plexRatingKey = plex.tmdb.get(item.tmdbId);
      return {
        title: item.title,
        ...(item.year ? { year: item.year } : {}),
        tmdbId: item.tmdbId,
        ...(plexRatingKey ? { plexRatingKey } : {}),
        available: Boolean(plexRatingKey),
      };
    });
    const matchedCount = items.filter((item) => item.available).length;
    return {
      collectionId: collection.id,
      sourceType: collection.sourceType,
      fetchedCount: items.length,
      matchedCount,
      missingCount: items.length - matchedCount,
      items,
      warnings: [
        ...source.warnings,
        ...(items.length === 0
          ? ['The provider returned no media for this collection.']
          : matchedCount === items.length
            ? []
            : [
                `${items.length - matchedCount} item${items.length - matchedCount === 1 ? ' is' : 's are'} not currently available in this Plex library.`,
              ]),
      ],
    };
  }
}
