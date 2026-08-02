import type { OverlayLibraryConfiguration, OverlayTemplateSummary, PosterOverlayTestResult, PosterTestSearchItem } from '@vynode/contracts';
import { ImdbClient, type MaintainerrOverlayItem } from '@vynode/integrations';
import { PlexManagementClient, type PlexHttpTransport, type PlexServerConfiguration } from '@vynode/media-servers';
import {
  createFileBackedOverlayApplication,
  collectRequiredContextFields,
  evaluateOverlayConditionDetailed,
  generateLocalPosterFolders,
  identifyStreamingProvider,
  NativeOverlayRenderer,
  OverlayContextBuilder,
  populateLocalPosters,
  PosterAcquisitionService,
  type OverlayApplicationItem,
  type OverlayContextProvider,
  type OverlayRunResult,
} from '@vynode/poster-overlays';

import type { ProductionCollectionPosterStore } from './production-collection-posters.js';
import type { ProductionPosterOverlayOperations, ProductionPosterOverlayStore } from './production-poster-overlays.js';
import { AdaptiveTtlCache } from './adaptive-ttl-cache.js';
import type { ProductionOverlayMediaCatalog } from './production-overlay-media-catalog.js';

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : undefined;
const records = (value: unknown): RecordValue[] => Array.isArray(value) ? value.map(record).filter((item): item is RecordValue => Boolean(item)) : [];
const text = (value: unknown) => value === undefined || value === null ? '' : String(value);
const containerMetadata = (value: unknown) => records(record(record(value)?.MediaContainer)?.Metadata);
const epoch = (value: unknown) => { const seconds = Number(value); return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined; };

export const futureTvSchedule = (
  metadata: RecordValue,
  now = Date.now()
): Readonly<Record<string, string | number | undefined>> => {
  const nextEpisode = record(metadata.next_episode_to_air);
  const nextEpisodeAt = Date.parse(text(nextEpisode?.air_date));
  const nextSeason = records(metadata.seasons)
    .map((season) => ({
      number: Number(season.season_number),
      timestamp: Date.parse(text(season.air_date)),
    }))
    .filter((season) =>
      Number.isInteger(season.number) &&
      season.number > 0 &&
      Number.isFinite(season.timestamp) &&
      season.timestamp > now
    )
    .sort((left, right) => left.timestamp - right.timestamp)[0];
  const daysFromNow = (timestamp: number) =>
    Math.max(0, Math.ceil((timestamp - now) / 86_400_000));
  return {
    nextAirDate: Number.isFinite(nextEpisodeAt)
      ? new Date(nextEpisodeAt).toISOString()
      : nextSeason
        ? new Date(nextSeason.timestamp).toISOString()
        : undefined,
    daysUntilNextEpisode: Number.isFinite(nextEpisodeAt)
      ? daysFromNow(nextEpisodeAt)
      : undefined,
    daysUntilNextSeason: nextSeason
      ? daysFromNow(nextSeason.timestamp)
      : undefined,
    seasonNumber: nextSeason?.number,
  };
};

const itemFromMetadata = (metadata: RecordValue, library: { key: string; title: string; type: 'movie' | 'show' }): OverlayApplicationItem | undefined => {
  const ratingKey = text(metadata.ratingKey);
  const title = text(metadata.title);
  if (!ratingKey || !title) return undefined;
  const plexType = text(metadata.type).toLowerCase();
  if (
    plexType &&
    (library.type === 'movie'
      ? plexType !== 'movie'
      : !['show', 'season', 'episode'].includes(plexType))
  ) return undefined;
  const guids = records(metadata.Guid).map((value) => text(value.id));
  const tmdbId = guids.map((guid) => /^tmdb:\/\/(\d+)$/i.exec(guid)?.[1]).find(Boolean);
  const tvdbId = guids.map((guid) => /^tvdb:\/\/(\d+)$/i.exec(guid)?.[1]).find(Boolean);
  const imdbId = guids.map((guid) => /^imdb:\/(\/)?(tt\d+)$/i.exec(guid)?.[2]).find(Boolean);
  const media = records(metadata.Media).map((entry) => {
    const part = records(entry.Part)[0];
    const streams = records(part?.Stream);
    const video = streams.filter((stream) => text(stream.streamType) === '1');
    const audio = streams.filter((stream) => text(stream.streamType) === '2');
    const subtitles = streams.filter((stream) => text(stream.streamType) === '3');
    const selectedAudio = audio.find((stream) => text(stream.selected) === '1') ?? audio[0];
    const selectedVideo = video.find((stream) => text(stream.selected) === '1') ?? video[0];
    const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : undefined;
    const language = (stream: RecordValue) => ({
      ...(text(stream.languageCode) ? { code: text(stream.languageCode) } : {}),
      ...(text(stream.language) ? { name: text(stream.language) } : {}),
    });
    const width = number(entry.width);
    const height = number(entry.height);
    return {
      ...(width !== undefined ? { width } : {}),
      ...(height !== undefined ? { height } : {}),
      ...(number(entry.aspectRatio) !== undefined
        ? { aspectRatio: number(entry.aspectRatio) }
        : width && height
          ? { aspectRatio: width / height }
          : {}),
      ...(text(entry.videoResolution) ? { resolution: /^\d{3,4}$/.test(text(entry.videoResolution)) ? `${text(entry.videoResolution)}p` : text(entry.videoResolution) } : {}),
      ...(text(selectedVideo?.codec ?? entry.videoCodec) ? { videoCodec: text(selectedVideo?.codec ?? entry.videoCodec) } : {}),
      ...(text(selectedVideo?.profile ?? entry.videoProfile) ? { videoProfile: text(selectedVideo?.profile ?? entry.videoProfile) } : {}),
      ...(text(entry.videoFrameRate ?? selectedVideo?.frameRate) ? { frameRate: text(entry.videoFrameRate ?? selectedVideo?.frameRate) } : {}),
      ...(number(selectedVideo?.bitDepth) !== undefined ? { bitDepth: number(selectedVideo?.bitDepth) } : {}),
      ...(text(entry.container) ? { container: text(entry.container) } : {}),
      ...(text(selectedAudio?.codec ?? entry.audioCodec) ? { audioCodec: text(selectedAudio?.codec ?? entry.audioCodec) } : {}),
      ...(number(selectedAudio?.channels ?? entry.audioChannels) !== undefined ? { audioChannels: number(selectedAudio?.channels ?? entry.audioChannels) } : {}),
      ...(text(selectedAudio?.channelLayout) ? { audioChannelLayout: text(selectedAudio?.channelLayout) } : {}),
      ...(text(selectedAudio?.profile ?? selectedAudio?.displayTitle) ? { audioFormat: text(selectedAudio?.profile ?? selectedAudio?.displayTitle) } : {}),
      audioLanguages: audio.map(language).filter((value) => value.code || value.name),
      subtitleLanguages: subtitles.map(language).filter((value) => value.code || value.name),
      ...(number(entry.bitrate ?? part?.bitrate) !== undefined ? { bitrateKbps: number(entry.bitrate ?? part?.bitrate) } : {}),
      ...(number(part?.size) !== undefined ? { fileSize: number(part?.size) } : {}),
      ...(text(part?.file) ? { filePath: text(part?.file) } : {}),
      hdr: video.some((stream) => ['smpte2084', 'arib-std-b67'].includes(text(stream.colorTrc).toLowerCase())),
      dolbyVision: video.some((stream) => text(stream.DOVIPresent).startsWith('1')),
      ...(number(selectedVideo?.DOVIProfile) !== undefined ? { dolbyVisionProfile: number(selectedVideo?.DOVIProfile) } : {}),
      ...(text(selectedVideo?.colorTrc) ? { colorTrc: text(selectedVideo?.colorTrc) } : {}),
    } as NonNullable<OverlayApplicationItem['media']>[number];
  });
  const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : undefined;
  const tags = (value: unknown) => records(value).map((entry) => text(entry.tag)).filter(Boolean);
  const year = number(metadata.year);
  const durationMs = number(metadata.duration);
  const userRating = number(metadata.userRating);
  const ratings = records(metadata.Rating);
  const ratingValue = (match: (entry: RecordValue) => boolean) =>
    number(ratings.find(match)?.value);
  const ratingSource = (entry: RecordValue) =>
    `${text(entry.image)} ${text(entry.key)} ${text(entry.type)}`.toLowerCase();
  const imdbRating = ratingValue((entry) => ratingSource(entry).includes('imdb'));
  const normalizeRt = (value: number | undefined) =>
    value !== undefined && value <= 10 ? Math.round(value * 10) : value;
  const rtCriticsScore = normalizeRt(ratingValue(
    (entry) => ratingSource(entry).includes('rottentomatoes') && !ratingSource(entry).includes('audience')
  ));
  const rtAudienceScore = normalizeRt(ratingValue(
    (entry) => ratingSource(entry).includes('rottentomatoes') && ratingSource(entry).includes('audience')
  ));
  const addedAt = epoch(metadata.addedAt);
  const lastViewedAt = epoch(metadata.lastViewedAt);
  const viewCount = number(metadata.viewCount);
  const totalSeasons = !plexType || plexType === 'show' ? number(metadata.childCount) : undefined;
  const seasonsAvailable = totalSeasons;
  const seasonNumber = plexType === 'season'
    ? number(metadata.index)
    : plexType === 'episode'
      ? number(metadata.parentIndex)
      : undefined;
  const episodeNumber = plexType === 'episode' ? number(metadata.index) : undefined;
  const episodeLabel =
    seasonNumber !== undefined && episodeNumber !== undefined
      ? `S${String(seasonNumber).padStart(2, '0')}E${String(episodeNumber).padStart(2, '0')}`
      : undefined;
  const base: OverlayApplicationItem = {
    ratingKey, title, mediaType: library.type, libraryId: library.key, libraryName: library.title,
    ...(year !== undefined ? { year } : {}),
    ...(tmdbId ? { tmdbId: Number(tmdbId) } : {}),
    ...(tvdbId ? { tvdbId: Number(tvdbId) } : {}),
    ...(imdbId ? { imdbId } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(userRating !== undefined ? { userRating } : {}),
    ...(imdbRating !== undefined ? { imdbRating } : {}),
    ...(rtCriticsScore !== undefined ? { rtCriticsScore } : {}),
    ...(rtAudienceScore !== undefined ? { rtAudienceScore } : {}),
    ...(text(metadata.studio) ? { studio: text(metadata.studio) } : {}),
    ...(text(metadata.originallyAvailableAt) ? { releaseDate: text(metadata.originallyAvailableAt) } : {}),
    ...(addedAt ? { addedAt } : {}),
    ...(lastViewedAt ? { lastViewedAt } : {}),
    ...(viewCount !== undefined ? { viewCount } : {}),
    ...(totalSeasons !== undefined ? { totalSeasons } : {}),
    ...(seasonsAvailable !== undefined ? { seasonsAvailable } : {}),
    ...(seasonNumber !== undefined ? { seasonNumber } : {}),
    ...(episodeNumber !== undefined ? { episodeNumber } : {}),
    ...(episodeLabel ? { episodeLabel } : {}),
    ...(text(metadata.contentRating) ? { imdbContentRating: text(metadata.contentRating) } : {}),
    genres: tags(metadata.Genre), directors: tags(metadata.Director), labels: tags(metadata.Label), collections: tags(metadata.Collection),
    networks: [...new Set([...tags(metadata.Network), text(metadata.network)].filter(Boolean))], media,
  };
  const provider = identifyStreamingProvider(base);
  return provider ? { ...base, streamingProvider: provider.name, ...(provider.id ? { streamingProviderId: provider.id } : {}) } : base;
};

export class ProductionPlexOverlayExecutor implements ProductionPosterOverlayOperations {
  readonly #controllers = new Map<string, AbortController>();
  readonly #contexts: OverlayContextBuilder;
  readonly #application;

  public constructor(
    dataDirectory: string,
    private readonly store: ProductionPosterOverlayStore,
    private readonly assets: ProductionCollectionPosterStore,
    private readonly plex: () => Promise<{ configured: PlexServerConfiguration; transport: PlexHttpTransport }>,
    private readonly tmdbApiKey: () => Promise<string | undefined>,
    private readonly fetchImplementation: typeof globalThis.fetch = globalThis.fetch,
    imdbClient: Pick<ImdbClient, 'title'> = new ImdbClient(),
    private readonly maintainerrItems: (signal?: AbortSignal) => Promise<readonly MaintainerrOverlayItem[]> = async () => [],
    private readonly arrContext: (item: OverlayApplicationItem, signal?: AbortSignal) => Promise<Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>> = async () => ({}),
    private readonly reportFailure: (libraryId: string, message: string) => void = () => undefined,
    private readonly catalog?: ProductionOverlayMediaCatalog
  ) {
    const durableContext = async (
      item: Pick<OverlayApplicationItem, 'ratingKey'>,
      provider: string,
      maxAgeMs: number,
      load: () => Promise<Readonly<Record<string, string | number | boolean | readonly string[] | undefined>>>
    ) => {
      const cached = this.catalog?.getEnrichment(item.ratingKey, provider, maxAgeMs);
      if (cached) return cached;
      const values = await load();
      await this.catalog?.putEnrichment(item.ratingKey, provider, values);
      return values;
    };
    const imdbMetadataCache = new AdaptiveTtlCache<Awaited<ReturnType<ImdbClient['title']>>>({ minimumTtlMs: 15 * 60_000, initialTtlMs: 6 * 60 * 60_000, maximumTtlMs: 7 * 24 * 60 * 60_000, negativeTtlMs: 5 * 60_000 });
    const tmdbMetadataCache = new AdaptiveTtlCache<RecordValue>({ minimumTtlMs: 15 * 60_000, initialTtlMs: 6 * 60 * 60_000, maximumTtlMs: 7 * 24 * 60 * 60_000, negativeTtlMs: 5 * 60_000 });
    const imdbProvider: OverlayContextProvider = {
      name: 'IMDb',
      fields: new Set(['imdbRating','imdbVotes','imdbContentRating','imdbGenres','imdbKeywords','imdbActors','imdbDirectors','imdbCreators','imdbPlot','imdbAlternateTitle','imdbReleaseDate','imdbRuntime','genre','director','releaseDate','runtime']),
      async load(item, fields, signal) {
        if (!item.imdbId || ![...fields].some((field) => this.fields.has(field))) return {};
        return durableContext(item, 'imdb', 24 * 60 * 60_000, async () => {
          const metadata = await imdbMetadataCache.get(item.imdbId!, () => imdbClient.title(item.imdbId!, signal));
          return {
          imdbRating: metadata.rating,
          imdbVotes: metadata.ratingCount,
          imdbContentRating: metadata.contentRating,
          imdbGenres: metadata.genres,
          imdbKeywords: metadata.keywords,
          imdbActors: metadata.actors,
          imdbDirectors: metadata.directors,
          imdbCreators: metadata.creators,
          imdbPlot: metadata.description,
          imdbAlternateTitle: metadata.alternateTitle,
          imdbReleaseDate: metadata.releaseDate,
          imdbRuntime: metadata.durationMinutes,
          genre: metadata.genres?.[0],
          director: metadata.directors?.[0],
          releaseDate: metadata.releaseDate,
          runtime: metadata.durationMinutes,
          };
        });
      },
    };
    const tmdbProvider: OverlayContextProvider = {
      name: 'TMDB',
      fields: new Set(['genre','director','studio','network','releaseDate','runtime','streamingProvider','streamingProviderId','nextAirDate','daysUntilNextEpisode','daysUntilNextSeason','seasonNumber']),
      async load(item, fields, signal) {
        if (!item.tmdbId || ![...fields].some((field) => this.fields.has(field))) return {};
        return durableContext(item, 'tmdb-origin-v2', 24 * 60 * 60_000, async () => {
          const apiKey = await tmdbApiKey();
          if (!apiKey) return {};
          const metadata = await tmdbMetadataCache.get(`${item.mediaType}:${item.tmdbId}`, async () => {
          const response = await fetchImplementation(
            `https://api.themoviedb.org/3/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}?${new URLSearchParams({ api_key: apiKey, append_to_response: 'credits' })}`,
            signal ? { signal } : undefined
          );
          if (!response.ok) throw new Error(`TMDB metadata request failed (status ${response.status}).`);
          return response.json() as Promise<RecordValue>;
          });
          const crew = records(record(metadata.credits)?.crew);
          const networks = records(metadata.networks).map((entry) => text(entry.name)).filter(Boolean);
          const companies = records(metadata.production_companies).map((entry) => text(entry.name)).filter(Boolean);
          const origin = identifyStreamingProvider({ networks, studio: companies.join(' | ') });
          return {
          genre: text(records(metadata.genres)[0]?.name),
          director: text(crew.find((entry) => text(entry.job).toLowerCase() === 'director')?.name),
          studio: companies[0],
          network: networks[0],
          streamingProvider: origin?.name,
          streamingProviderId: origin?.id,
          releaseDate: text(metadata.release_date ?? metadata.first_air_date),
          runtime: Number(metadata.runtime ?? records(metadata.episode_run_time)[0]) || undefined,
          ...futureTvSchedule(metadata),
          };
        });
      },
    };
    const maintainerrProvider: OverlayContextProvider = {
      name: 'Maintainerr', fields: new Set(['daysUntilAction']),
      load: async (item, _fields, signal) => durableContext(item, 'maintainerr', 60_000, async () => ({ daysUntilAction: (await this.maintainerrItems(signal)).find((candidate) => candidate.mediaId === item.ratingKey)?.daysRemaining })),
    };
    const arrProvider: OverlayContextProvider = {
      name: 'Radarr/Sonarr', fields: new Set(['inRadarr','inSonarr','isMonitored','radarrTags','sonarrTags','downloaded']),
      load: (item, _fields, signal) => durableContext(item, 'arr', 5 * 60_000, () => this.arrContext(item as OverlayApplicationItem, signal)),
    };
    this.#contexts = new OverlayContextBuilder([imdbProvider, tmdbProvider, maintainerrProvider, arrProvider]);
    const plexPoster = async (item: Pick<OverlayApplicationItem, 'ratingKey'>, signal?: AbortSignal) => this.posterFromPlex(item.ratingKey, signal);
    this.#application = createFileBackedOverlayApplication(dataDirectory, {
      acquisition: {
        acquire: async (source, item, language, signal) => new PosterAcquisitionService({
          localRoot: (await this.store.get()).source.localRoot,
          plex: { poster: (candidate, _language, candidateSignal) => plexPoster(candidate, candidateSignal) },
          tmdb: { poster: (candidate, candidateLanguage, candidateSignal) => this.posterFromTmdb(candidate as OverlayApplicationItem, candidateLanguage, candidateSignal) },
        }).acquire(source, item, language, signal),
      },
      contexts: this.#contexts,
      renderer: new NativeOverlayRenderer({ assets: { resolve: async (path, signal) => {
        signal?.throwIfAborted();
        const id = /^asset:\/\/([0-9a-f-]{36})$/i.exec(path)?.[1];
        if (!id) throw new Error('The overlay references an unsupported asset path.');
        const stored = await this.assets.readAsset(id);
        if (!stored) throw new Error('The overlay asset is no longer available.');
        return stored.bytes;
      } } }),
      plex: {
        uploadPoster: async (ratingKey, bytes, signal) => new PlexManagementClient((await this.plex()).transport).uploadPoster(ratingKey, bytes, signal),
        setOverlayLabel: async (ratingKey, enabled, signal) => new PlexManagementClient((await this.plex()).transport).setOverlayLabel(ratingKey, enabled, signal),
      },
    });
  }

  async #metadata(ratingKey: string, signal?: AbortSignal) { return containerMetadata(await (await this.plex()).transport.query(`/library/metadata/${encodeURIComponent(ratingKey)}?includeGuids=1&includeCollections=1&includeLabels=1&includeFields=1&includeMedia=1&includeRatings=1`, signal))[0]; }
  async #item(ratingKey: string, signal?: AbortSignal) {
    const { configured } = await this.plex();
    const metadata = await this.#metadata(ratingKey, signal);
    if (!metadata) return undefined;
    const libraryId = text(metadata.librarySectionID);
    const library = configured.libraries.find((value) => value.key === libraryId && (value.type === 'movie' || value.type === 'show'));
    return library ? itemFromMetadata(metadata, { key: library.key, title: library.title, type: library.type as 'movie' | 'show' }) : undefined;
  }
  async #items(libraryId: string, signal?: AbortSignal) {
    const cached = this.catalog?.get(libraryId);
    if (cached) return cached;
    const { configured, transport } = await this.plex();
    const library = configured.libraries.find((value) => value.key === libraryId && value.available && (value.type === 'movie' || value.type === 'show'));
    if (!library) throw new Error('The selected Plex library is unavailable.');
    const summaries = containerMetadata(await transport.query(`/library/sections/${encodeURIComponent(libraryId)}/all?type=${library.type === 'movie' ? '1' : '2'}&includeGuids=1&includeCollections=1&includeLabels=1&includeFields=1&includeMedia=1&includeRatings=1`, signal));
    const items: OverlayApplicationItem[] = [];
    for (const summary of summaries) {
      signal?.throwIfAborted();
      const key = text(summary.ratingKey);
      if (!key) continue;
      const enriched = Object.hasOwn(summary, 'Guid') && Object.hasOwn(summary, 'Media');
      const metadata = enriched ? summary : await this.#metadata(key, signal);
      const item = metadata && itemFromMetadata(metadata, {
        key: library.key,
        title: library.title,
        type: library.type as 'movie' | 'show',
      });
      if (item) items.push(item);
    }
    await this.store.updateLibraryRun(libraryId, { itemCount: items.length, indexedItems: items.length, lastSyncedAt: new Date().toISOString() });
    await this.catalog?.put(libraryId, items);
    return items;
  }
  async posterFromPlex(ratingKey: string, signal?: AbortSignal) {
    const { transport } = await this.plex(); const metadata = await this.#metadata(ratingKey, signal); const thumb = text(metadata?.thumb); if (!thumb) return undefined;
    const normalized = /^https?:/.test(thumb) ? `${new URL(thumb).pathname}${new URL(thumb).search}` : thumb;
    return transport.queryBinary(`/photo/:/transcode?${new URLSearchParams({ url: normalized, width: '1000', height: '1500', minSize: '1', upscale: '1' })}`, signal);
  }
  async plexLabels(): Promise<readonly string[]> {
    const { configured, transport } = await this.plex();
    const labels = new Set<string>();
    for (const library of configured.libraries.filter((item) => item.available && (item.type === 'movie' || item.type === 'show'))) {
      const metadata = containerMetadata(await transport.query(`/library/sections/${encodeURIComponent(library.key)}/all?includeLabels=1`));
      for (const item of metadata)
        for (const label of records(item.Label).map((entry) => text(entry.tag).trim()).filter(Boolean)) labels.add(label);
    }
    return [...labels].sort((left, right) => left.localeCompare(right));
  }
  async posterFromTmdb(item: OverlayApplicationItem, language: string, signal?: AbortSignal) {
    if (!item.tmdbId) return undefined; const apiKey = await this.tmdbApiKey(); if (!apiKey) return undefined;
    const response = await this.fetchImplementation(`https://api.themoviedb.org/3/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}?${new URLSearchParams({ api_key: apiKey, language })}`, signal ? { signal } : undefined);
    if (!response.ok) return undefined; const path = text((await response.json() as RecordValue).poster_path); if (!path) return undefined;
    const image = await this.fetchImplementation(`https://image.tmdb.org/t/p/original${path}`, signal ? { signal } : undefined); return image.ok ? new Uint8Array(await image.arrayBuffer()) : undefined;
  }
  async #runLibrary(library: OverlayLibraryConfiguration, signal: AbortSignal, reset = false): Promise<OverlayRunResult> {
    const workspace = await this.store.get();
    const templates = workspace.templates.filter((template) => library.enabledTemplateIds.includes(template.id));
    let items = await this.#items(library.id, signal);
    const required = collectRequiredContextFields(templates);
    const requiresEpisodeMedia = [...required].some((field) =>
      field.startsWith('show') || field.startsWith('episode') || [
        'resolution', 'hdr', 'dolbyVision', 'dolbyVisionProfile', 'videoCodec',
        'audioCodec', 'audioChannels', 'bitDepth', 'fileSize', 'bitrate',
      ].includes(field)
    );
    if (library.type === 'show' && (library.enableEpisodeScanning || requiresEpisodeMedia)) {
      const { transport } = await this.plex();
      items = await Promise.all(items.map(async (item) => {
        const episodes = containerMetadata(await transport.query(`/library/metadata/${encodeURIComponent(item.ratingKey)}/allLeaves?includeMedia=1`, signal));
        const media = episodes.flatMap((episode) => itemFromMetadata(episode, { key: library.id, title: library.name, type: 'show' })?.media ?? []);
        return { ...item, media };
      }));
      await this.catalog?.put(library.id, items);
    }
    if (reset) return this.#application.reset(items, signal);
    const primary = await this.#application.apply(
      items, templates, workspace.source.source, library.tmdbLanguage, signal,
      (completed, failed) => this.store.updateLibraryRun(library.id, {
        processedItems: completed - failed,
        failedItems: failed,
      }).then(() => undefined)
    );
    const seasonTemplates = templates.filter((template) => template.tags.some((tag) => tag.toLowerCase() === 'maintainerr') || template.condition?.sections.some((section) => section.rules.some((rule) => rule.field === 'daysUntilAction')));
    if (library.type !== 'show' || !library.maintainerrSeasonOverlays || !seasonTemplates.length) return primary;
    const seasonItems = (await Promise.all((await this.maintainerrItems(signal)).filter((candidate) => !candidate.libraryId || candidate.libraryId === library.id).map((candidate) => this.#item(candidate.mediaId, signal)))).filter((item): item is OverlayApplicationItem => Boolean(item));
    if (!seasonItems.length) return primary;
    const seasons = await this.#application.apply(seasonItems, seasonTemplates, 'plex', library.tmdbLanguage, signal);
    return { items: [...primary.items, ...seasons.items], applied: primary.applied + seasons.applied, restored: primary.restored + seasons.restored, skipped: primary.skipped + seasons.skipped, failed: primary.failed + seasons.failed };
  }
  async #finish(id: string, result: OverlayRunResult, reset = false) {
    const unchanged = result.items.filter((item) => item.status === 'skipped' && item.reason === 'The rendered poster is unchanged.').length;
    const noMatchItems = result.items.filter((item) => item.status === 'skipped' && item.reason?.startsWith('No enabled overlay template matched this item'));
    const noMatch = noMatchItems.length;
    const failures = result.items.filter((item) => item.status === 'failed').map((item) => `${item.ratingKey}: ${item.reason ?? 'Overlay application failed.'}`);
    for (const failure of failures) this.reportFailure(id, failure);
    return this.store.updateLibraryRun(id, {
      status: result.failed ? 'error' : reset ? 'idle' : 'complete', operation: undefined,
      processedItems: result.items.length - result.failed, failedItems: result.failed,
      lastAppliedItems: result.applied, lastRestoredItems: result.restored,
      lastSkippedItems: result.skipped, lastUnchangedItems: unchanged,
      lastNoMatchItems: noMatch,
      lastError: failures.length
        ? failures.join(' | ')
        : noMatchItems.length === result.items.length
          ? [...new Set(noMatchItems.map((item) => item.reason).filter((value): value is string => Boolean(value)))].slice(0, 5).join(' | ')
          : undefined,
      lastAppliedAt: new Date().toISOString(),
    });
  }
  public async executeAll(signal: AbortSignal) {
    const libraries = (await this.store.get()).libraries;
    let applied = 0, restored = 0, skipped = 0, failed = 0;
    for (const library of libraries) {
      signal.throwIfAborted();
      await this.store.updateLibraryRun(library.id, { status: 'processing', operation: 'apply', processedItems: 0, failedItems: 0 });
      const result = await this.#runLibrary(library, signal);
      await this.#finish(library.id, result);
      applied += result.applied; restored += result.restored; skipped += result.skipped; failed += result.failed;
    }
    return { libraries: libraries.length, applied, restored, skipped, failed };
  }
  async startLibraryJob(id: string) {
    const library = (await this.store.get()).libraries.find((value) => value.id === id); if (!library || this.#controllers.has(id)) return undefined;
    if (!library.enabledTemplateIds.length)
      throw new Error(`Choose at least one overlay for "${library.name}" before applying.`);
    const controller = new AbortController(); this.#controllers.set(id, controller); await this.store.updateLibraryRun(id, { status: 'processing', operation: 'apply', processedItems: 0, failedItems: 0 });
    void this.#runLibrary(library, controller.signal).then((result) => this.#finish(id, result)).catch((error) => { const message = error instanceof Error ? error.message : String(error); if (!controller.signal.aborted) this.reportFailure(id, message); return this.store.updateLibraryRun(id, { status: controller.signal.aborted ? 'idle' : 'error', operation: undefined, failedItems: controller.signal.aborted ? 0 : 1, lastError: controller.signal.aborted ? undefined : message }); }).finally(() => this.#controllers.delete(id));
    return this.store.get();
  }
  async startAllLibraryJobs() { const workspace = await this.store.get(); if (this.#controllers.size || !workspace.libraries.length) return undefined; for (const library of workspace.libraries) await this.startLibraryJob(library.id); return this.store.get(); }
  async startCleanBaseDownload() {
    const workspace = await this.store.get();
    if (this.#controllers.size || !workspace.libraries.length) return undefined;
    for (const library of workspace.libraries) {
      const controller = new AbortController();
      this.#controllers.set(library.id, controller);
      await this.store.updateLibraryRun(library.id, { status: 'processing', operation: 'download-base-posters', processedItems: 0, failedItems: 0 });
      void this.#items(library.id, controller.signal)
        .then((items) => this.#application.downloadCleanPlexBases(
          items,
          controller.signal,
          (completed, failed) => this.store.updateLibraryRun(library.id, {
            processedItems: completed - failed,
            failedItems: failed,
          }).then(() => undefined)
        ))
        .then((result) => this.store.updateLibraryRun(library.id, {
          status: result.failed ? 'error' : 'complete', operation: undefined,
          processedItems: result.downloaded,
          failedItems: result.failed,
          lastAppliedItems: 0,
          lastRestoredItems: 0,
          lastSkippedItems: 0,
          lastNoMatchItems: 0,
          lastAppliedAt: new Date().toISOString(),
        }))
        .catch(() => this.store.updateLibraryRun(library.id, {
          status: controller.signal.aborted ? 'idle' : 'error',
          failedItems: controller.signal.aborted ? 0 : 1,
        }))
        .finally(() => this.#controllers.delete(library.id));
    }
    return this.store.get();
  }
  async cancelLibraryJob(id: string) { const controller = this.#controllers.get(id); if (!controller) return undefined; controller.abort(); await this.store.updateLibraryRun(id, { status: 'cancelling' }); return this.store.get(); }
  async resetLibrary(id: string) { const library = (await this.store.get()).libraries.find((value) => value.id === id); if (!library || this.#controllers.has(id)) return undefined; const controller = new AbortController(); this.#controllers.set(id, controller); await this.store.updateLibraryRun(id, { status: 'processing', operation: 'reset' }); void this.#runLibrary(library, controller.signal, true).then((result) => this.#finish(id, result, true)).catch(() => this.store.updateLibraryRun(id, { status: controller.signal.aborted ? 'idle' : 'error', operation: undefined, failedItems: controller.signal.aborted ? 0 : 1 })).finally(() => this.#controllers.delete(id)); return this.store.get(); }
  async searchItems(query: string, libraryId?: string): Promise<readonly PosterTestSearchItem[]> { const workspace = await this.store.get(); const normalized = query.trim().toLowerCase(); const results: PosterTestSearchItem[] = []; for (const library of workspace.libraries.filter((value) => !libraryId || value.id === libraryId)) for (const item of await this.#items(library.id)) { if (normalized && !item.title.toLowerCase().includes(normalized)) continue; results.push({ ratingKey: item.ratingKey, title: item.title, ...(item.year ? { year: item.year } : {}), type: item.mediaType, libraryId: item.libraryId, libraryName: item.libraryName, posterUrl: `/api/posters/overlays/items/${encodeURIComponent(item.ratingKey)}/poster` }); if (results.length >= 50) return results; } return results; }
  async posterForItem(ratingKey: string) { return (await this.#application.preservedBasePoster(ratingKey)) ?? this.posterFromPlex(ratingKey); }
  async previewItem(ratingKey: string) {
    const item = await this.#item(ratingKey);
    if (!item) return undefined;
    const workspace = await this.store.get();
    const library = workspace.libraries.find((value) => value.id === item.libraryId);
    if (!library) return undefined;
    const templates = workspace.templates.filter((template) =>
      library.enabledTemplateIds.includes(template.id)
    );
    if (!templates.length)
      throw new Error('No overlay templates are selected for this Plex library.');
    return this.#application.preview(
      item,
      templates,
      workspace.source.source,
      library.tmdbLanguage
    );
  }
  async testItem(ratingKey: string): Promise<PosterOverlayTestResult | undefined> {
    const item = await this.#item(ratingKey);
    if (!item) return undefined;
    const workspace = await this.store.get();
    const library = workspace.libraries.find((value) => value.id === item.libraryId);
    if (!library) return undefined;
    const templates = workspace.templates.filter((template) =>
      library.enabledTemplateIds.includes(template.id)
    );
    const built = await this.#contexts.build(item, templates);
    return {
      item: { ratingKey: item.ratingKey, title: item.title, ...(item.year ? { year: item.year } : {}), type: item.mediaType, libraryId: item.libraryId, libraryName: item.libraryName },
      templates: templates.map((template: OverlayTemplateSummary) => {
        const evaluation = evaluateOverlayConditionDetailed(template.condition, built.context);
        const failed = evaluation.sectionResults.flatMap((section) =>
          section.ruleResults.filter((rule) => !rule.matched).map((rule) =>
            `${rule.field}: expected ${rule.operator} ${JSON.stringify(rule.expectedValue)}, actual ${rule.actualValue === undefined ? 'missing' : JSON.stringify(rule.actualValue)}`
          )
        );
        return { id: template.id, name: template.name, matched: template.enabled && evaluation.matched, conditionSummary: template.conditionSummary, ...(failed.length ? { actualValue: failed.join(' | ') } : {}) };
      }),
      context: Object.fromEntries(Object.entries(built.context).filter(([, value]) => value !== undefined).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join(', ') : value as string | number | boolean])),
      errors: [
        ...(!templates.length ? ['No overlay templates are selected for this Plex library.'] : []),
        ...built.warnings.map((warning) => `${warning.provider}: ${warning.message}`),
      ],
    };
  }
  async applyItem(ratingKey: string) {
    const item = await this.#item(ratingKey);
    if (!item) return undefined;
    const workspace = await this.store.get();
    const library = workspace.libraries.find((value) => value.id === item.libraryId);
    if (!library) return undefined;
    const templates = workspace.templates.filter((template) =>
      library.enabledTemplateIds.includes(template.id)
    );
    if (!templates.length)
      throw new Error('No overlay templates are selected for this Plex library.');
    const result = await this.#application.apply(
      [item],
      templates,
      workspace.source.source,
      library.tmdbLanguage
    );
    const outcome = result.items[0];
    if (!outcome || outcome.status === 'failed' || outcome.status === 'skipped')
      throw new Error(outcome?.reason ?? 'The overlay was not applied.');
    return this.store.get();
  }
  async resetItem(ratingKey: string) {
    const item = await this.#item(ratingKey);
    if (!item) return undefined;
    const result = await this.#application.reset([{ ratingKey }]);
    const outcome = result.items[0];
    if (!outcome || outcome.status !== 'restored')
      throw new Error(outcome?.reason ?? 'The original poster was not restored.');
    return this.store.get();
  }
  async generateLocalFolders() { const workspace = await this.store.get(); const items = (await Promise.all(workspace.libraries.map((library) => this.#items(library.id)))).flat(); return generateLocalPosterFolders(workspace.source.localRoot, items); }
  async populateLocalPosters() { const workspace = await this.store.get(); const items = (await Promise.all(workspace.libraries.map((library) => this.#items(library.id)))).flat(); return populateLocalPosters(workspace.source.localRoot, items, async (item, signal) => { const bytes = await this.posterFromPlex(item.ratingKey, signal); if (!bytes) throw new Error(`Plex does not have a poster for "${item.title}".`); return bytes; }); }
}
