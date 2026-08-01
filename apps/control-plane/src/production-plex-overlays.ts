import type { OverlayLibraryConfiguration, OverlayTemplateSummary, PosterOverlayTestResult, PosterTestSearchItem } from '@vynode/contracts';
import { ImdbClient } from '@vynode/integrations';
import { PlexManagementClient, type PlexHttpTransport, type PlexServerConfiguration } from '@vynode/media-servers';
import {
  createFileBackedOverlayApplication,
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

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue | undefined => typeof value === 'object' && value !== null && !Array.isArray(value) ? value as RecordValue : undefined;
const records = (value: unknown): RecordValue[] => Array.isArray(value) ? value.map(record).filter((item): item is RecordValue => Boolean(item)) : [];
const text = (value: unknown) => value === undefined || value === null ? '' : String(value);
const containerMetadata = (value: unknown) => records(record(record(value)?.MediaContainer)?.Metadata);
const epoch = (value: unknown) => { const seconds = Number(value); return Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000).toISOString() : undefined; };

const itemFromMetadata = (metadata: RecordValue, library: { key: string; title: string; type: 'movie' | 'show' }): OverlayApplicationItem | undefined => {
  const ratingKey = text(metadata.ratingKey);
  const title = text(metadata.title);
  if (!ratingKey || !title) return undefined;
  const guids = records(metadata.Guid).map((value) => text(value.id));
  const tmdbId = guids.map((guid) => /^tmdb:\/\/(\d+)$/i.exec(guid)?.[1]).find(Boolean);
  const imdbId = guids.map((guid) => /^imdb:\/(\/)?(tt\d+)$/i.exec(guid)?.[2]).find(Boolean);
  const media = records(metadata.Media).map((entry) => {
    const part = records(entry.Part)[0];
    const streams = records(part?.Stream);
    const video = streams.filter((stream) => text(stream.streamType) === '1');
    const audio = streams.filter((stream) => text(stream.streamType) === '2');
    const selectedAudio = audio.find((stream) => text(stream.selected) === '1') ?? audio[0];
    const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : undefined;
    return {
      ...(number(entry.width) !== undefined ? { width: number(entry.width) } : {}),
      ...(number(entry.height) !== undefined ? { height: number(entry.height) } : {}),
      ...(text(entry.videoResolution) ? { resolution: /^\d{3,4}$/.test(text(entry.videoResolution)) ? `${text(entry.videoResolution)}p` : text(entry.videoResolution) } : {}),
      ...(text(entry.videoCodec) ? { videoCodec: text(entry.videoCodec) } : {}),
      ...(text(entry.container) ? { container: text(entry.container) } : {}),
      ...(text(selectedAudio?.codec ?? entry.audioCodec) ? { audioCodec: text(selectedAudio?.codec ?? entry.audioCodec) } : {}),
      ...(number(selectedAudio?.channels ?? entry.audioChannels) !== undefined ? { audioChannels: number(selectedAudio?.channels ?? entry.audioChannels) } : {}),
      ...(text(part?.file) ? { filePath: text(part?.file) } : {}),
      hdr: video.some((stream) => ['smpte2084', 'arib-std-b67'].includes(text(stream.colorTrc).toLowerCase())),
      dolbyVision: video.some((stream) => text(stream.DOVIPresent).startsWith('1')),
    } as NonNullable<OverlayApplicationItem['media']>[number];
  });
  const number = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : undefined;
  const tags = (value: unknown) => records(value).map((entry) => text(entry.tag)).filter(Boolean);
  const year = number(metadata.year);
  const durationMs = number(metadata.duration);
  const userRating = number(metadata.userRating);
  const addedAt = epoch(metadata.addedAt);
  const lastViewedAt = epoch(metadata.lastViewedAt);
  const base: OverlayApplicationItem = {
    ratingKey, title, mediaType: library.type, libraryId: library.key, libraryName: library.title,
    ...(year !== undefined ? { year } : {}),
    ...(tmdbId ? { tmdbId: Number(tmdbId) } : {}),
    ...(imdbId ? { imdbId } : {}),
    ...(durationMs !== undefined ? { durationMs } : {}),
    ...(userRating !== undefined ? { userRating } : {}),
    ...(text(metadata.studio) ? { studio: text(metadata.studio) } : {}),
    ...(text(metadata.originallyAvailableAt) ? { releaseDate: text(metadata.originallyAvailableAt) } : {}),
    ...(addedAt ? { addedAt } : {}),
    ...(lastViewedAt ? { lastViewedAt } : {}),
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
    imdbClient: Pick<ImdbClient, 'title'> = new ImdbClient()
  ) {
    const imdbMetadataCache = new AdaptiveTtlCache<Awaited<ReturnType<ImdbClient['title']>>>({ minimumTtlMs: 15 * 60_000, initialTtlMs: 6 * 60 * 60_000, maximumTtlMs: 7 * 24 * 60 * 60_000, negativeTtlMs: 5 * 60_000 });
    const tmdbMetadataCache = new AdaptiveTtlCache<RecordValue>({ minimumTtlMs: 15 * 60_000, initialTtlMs: 6 * 60 * 60_000, maximumTtlMs: 7 * 24 * 60 * 60_000, negativeTtlMs: 5 * 60_000 });
    const imdbProvider: OverlayContextProvider = {
      name: 'IMDb',
      fields: new Set(['imdbRating','imdbVotes','imdbContentRating','imdbGenres','imdbKeywords','imdbActors','imdbDirectors','imdbCreators','imdbPlot','imdbAlternateTitle','imdbReleaseDate','imdbRuntime','genre','director','releaseDate','runtime']),
      async load(item, fields, signal) {
        if (!item.imdbId || ![...fields].some((field) => this.fields.has(field))) return {};
        const metadata = await imdbMetadataCache.get(item.imdbId, () => imdbClient.title(item.imdbId!, signal));
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
      },
    };
    const tmdbProvider: OverlayContextProvider = {
      name: 'TMDB',
      fields: new Set(['genre','director','studio','network','releaseDate','runtime']),
      async load(item, fields, signal) {
        if (!item.tmdbId || ![...fields].some((field) => this.fields.has(field))) return {};
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
        return {
          genre: text(records(metadata.genres)[0]?.name),
          director: text(crew.find((entry) => text(entry.job).toLowerCase() === 'director')?.name),
          studio: text(records(metadata.production_companies)[0]?.name),
          network: text(records(metadata.networks)[0]?.name),
          releaseDate: text(metadata.release_date ?? metadata.first_air_date),
          runtime: Number(metadata.runtime ?? records(metadata.episode_run_time)[0]) || undefined,
        };
      },
    };
    this.#contexts = new OverlayContextBuilder([imdbProvider, tmdbProvider]);
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

  async #metadata(ratingKey: string, signal?: AbortSignal) { return containerMetadata(await (await this.plex()).transport.query(`/library/metadata/${encodeURIComponent(ratingKey)}?includeGuids=1&includeCollections=1&includeLabels=1&includeFields=1&includeMedia=1`, signal))[0]; }
  async #item(ratingKey: string, signal?: AbortSignal) {
    const { configured } = await this.plex();
    const metadata = await this.#metadata(ratingKey, signal);
    if (!metadata) return undefined;
    const libraryId = text(metadata.librarySectionID);
    const library = configured.libraries.find((value) => value.key === libraryId && (value.type === 'movie' || value.type === 'show'));
    return library ? itemFromMetadata(metadata, { key: library.key, title: library.title, type: library.type as 'movie' | 'show' }) : undefined;
  }
  async #items(libraryId: string, signal?: AbortSignal) {
    const { configured, transport } = await this.plex();
    const library = configured.libraries.find((value) => value.key === libraryId && value.available && (value.type === 'movie' || value.type === 'show'));
    if (!library) throw new Error('The selected Plex library is unavailable.');
    const summaries = containerMetadata(await transport.query(`/library/sections/${encodeURIComponent(libraryId)}/all?includeGuids=1&includeCollections=1&includeLabels=1&includeFields=1&includeMedia=1`, signal));
    const items: OverlayApplicationItem[] = [];
    for (const summary of summaries) { signal?.throwIfAborted(); const key = text(summary.ratingKey); if (!key) continue; const metadata = await this.#metadata(key, signal); const item = metadata && itemFromMetadata(metadata, { key: library.key, title: library.title, type: library.type as 'movie' | 'show' }); if (item) items.push(item); }
    await this.store.updateLibraryRun(libraryId, { itemCount: items.length, indexedItems: items.length, lastSyncedAt: new Date().toISOString() });
    return items;
  }
  async posterFromPlex(ratingKey: string, signal?: AbortSignal) {
    const { transport } = await this.plex(); const metadata = await this.#metadata(ratingKey, signal); const thumb = text(metadata?.thumb); if (!thumb) return undefined;
    const normalized = /^https?:/.test(thumb) ? `${new URL(thumb).pathname}${new URL(thumb).search}` : thumb;
    return transport.queryBinary(`/photo/:/transcode?${new URLSearchParams({ url: normalized, width: '1000', height: '1500', minSize: '1', upscale: '1' })}`, signal);
  }
  async posterFromTmdb(item: OverlayApplicationItem, language: string, signal?: AbortSignal) {
    if (!item.tmdbId) return undefined; const apiKey = await this.tmdbApiKey(); if (!apiKey) return undefined;
    const response = await this.fetchImplementation(`https://api.themoviedb.org/3/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}?${new URLSearchParams({ api_key: apiKey, language })}`, signal ? { signal } : undefined);
    if (!response.ok) return undefined; const path = text((await response.json() as RecordValue).poster_path); if (!path) return undefined;
    const image = await this.fetchImplementation(`https://image.tmdb.org/t/p/original${path}`, signal ? { signal } : undefined); return image.ok ? new Uint8Array(await image.arrayBuffer()) : undefined;
  }
  async #runLibrary(library: OverlayLibraryConfiguration, signal: AbortSignal, reset = false): Promise<OverlayRunResult> {
    const items = await this.#items(library.id, signal);
    if (reset) return this.#application.reset(items, signal);
    const workspace = await this.store.get(); const templates = workspace.templates.filter((template) => library.enabledTemplateIds.includes(template.id));
    return this.#application.apply(items, templates, workspace.source.source, library.tmdbLanguage, signal);
  }
  async #finish(id: string, result: OverlayRunResult, reset = false) { return this.store.updateLibraryRun(id, { status: result.failed ? 'error' : reset ? 'idle' : 'complete', processedItems: result.items.length - result.failed, failedItems: result.failed, lastAppliedItems: result.applied, lastRestoredItems: result.restored, lastSkippedItems: result.skipped, lastNoMatchItems: result.skipped, lastAppliedAt: new Date().toISOString() }); }
  public async executeAll(signal: AbortSignal) {
    const libraries = (await this.store.get()).libraries;
    let applied = 0, restored = 0, skipped = 0, failed = 0;
    for (const library of libraries) {
      signal.throwIfAborted();
      await this.store.updateLibraryRun(library.id, { status: 'processing', processedItems: 0, failedItems: 0 });
      const result = await this.#runLibrary(library, signal);
      await this.#finish(library.id, result);
      applied += result.applied; restored += result.restored; skipped += result.skipped; failed += result.failed;
    }
    return { libraries: libraries.length, applied, restored, skipped, failed };
  }
  async startLibraryJob(id: string) {
    const library = (await this.store.get()).libraries.find((value) => value.id === id); if (!library || this.#controllers.has(id)) return undefined;
    const controller = new AbortController(); this.#controllers.set(id, controller); await this.store.updateLibraryRun(id, { status: 'processing', processedItems: 0, failedItems: 0 });
    void this.#runLibrary(library, controller.signal).then((result) => this.#finish(id, result)).catch((error) => this.store.updateLibraryRun(id, { status: controller.signal.aborted ? 'idle' : 'error', failedItems: controller.signal.aborted ? 0 : 1 })).finally(() => this.#controllers.delete(id));
    return this.store.get();
  }
  async startAllLibraryJobs() { const workspace = await this.store.get(); if (this.#controllers.size || !workspace.libraries.length) return undefined; for (const library of workspace.libraries) await this.startLibraryJob(library.id); return this.store.get(); }
  async cancelLibraryJob(id: string) { const controller = this.#controllers.get(id); if (!controller) return undefined; controller.abort(); await this.store.updateLibraryRun(id, { status: 'cancelling' }); return this.store.get(); }
  async resetLibrary(id: string) { const library = (await this.store.get()).libraries.find((value) => value.id === id); if (!library || this.#controllers.has(id)) return undefined; const controller = new AbortController(); this.#controllers.set(id, controller); await this.store.updateLibraryRun(id, { status: 'processing' }); void this.#runLibrary(library, controller.signal, true).then((result) => this.#finish(id, result, true)).catch(() => this.store.updateLibraryRun(id, { status: controller.signal.aborted ? 'idle' : 'error', failedItems: controller.signal.aborted ? 0 : 1 })).finally(() => this.#controllers.delete(id)); return this.store.get(); }
  async searchItems(query: string, libraryId?: string): Promise<readonly PosterTestSearchItem[]> { const workspace = await this.store.get(); const normalized = query.trim().toLowerCase(); const results: PosterTestSearchItem[] = []; for (const library of workspace.libraries.filter((value) => !libraryId || value.id === libraryId)) for (const item of await this.#items(library.id)) { if (normalized && !item.title.toLowerCase().includes(normalized)) continue; results.push({ ratingKey: item.ratingKey, title: item.title, ...(item.year ? { year: item.year } : {}), type: item.mediaType, libraryId: item.libraryId, libraryName: item.libraryName, posterUrl: `/api/posters/overlays/items/${encodeURIComponent(item.ratingKey)}/poster` }); if (results.length >= 50) return results; } return results; }
  async posterForItem(ratingKey: string) { return (await this.#application.preservedBasePoster(ratingKey)) ?? this.posterFromPlex(ratingKey); }
  async testItem(ratingKey: string): Promise<PosterOverlayTestResult | undefined> { const item = await this.#item(ratingKey); if (!item) return undefined; const workspace = await this.store.get(); const built = await this.#contexts.build(item, workspace.templates); return { item: { ratingKey: item.ratingKey, title: item.title, ...(item.year ? { year: item.year } : {}), type: item.mediaType, libraryId: item.libraryId, libraryName: item.libraryName }, templates: workspace.templates.map((template: OverlayTemplateSummary) => ({ id: template.id, name: template.name, matched: template.enabled && evaluateOverlayConditionDetailed(template.condition, built.context).matched, conditionSummary: template.conditionSummary })), context: Object.fromEntries(Object.entries(built.context).filter(([, value]) => value !== undefined).map(([key, value]) => [key, value instanceof Date ? value.toISOString() : Array.isArray(value) ? value.join(', ') : value as string | number | boolean])), errors: built.warnings.map((warning) => `${warning.provider}: ${warning.message}`) }; }
  async applyItem(ratingKey: string) { const item = await this.#item(ratingKey); if (!item) return undefined; const workspace = await this.store.get(); const library = workspace.libraries.find((value) => value.id === item.libraryId); if (!library) return undefined; const result = await this.#application.apply([item], workspace.templates.filter((template) => library.enabledTemplateIds.includes(template.id)), workspace.source.source, library.tmdbLanguage); return this.#finish(library.id, result); }
  async resetItem(ratingKey: string) { const item = await this.#item(ratingKey); if (!item) return undefined; const result = await this.#application.reset([{ ratingKey }]); return this.#finish(item.libraryId, result, true); }
  async generateLocalFolders() { const workspace = await this.store.get(); const items = (await Promise.all(workspace.libraries.map((library) => this.#items(library.id)))).flat(); return generateLocalPosterFolders(workspace.source.localRoot, items); }
  async populateLocalPosters() { const workspace = await this.store.get(); const items = (await Promise.all(workspace.libraries.map((library) => this.#items(library.id)))).flat(); return populateLocalPosters(workspace.source.localRoot, items, async (item, signal) => { const bytes = await this.posterFromPlex(item.ratingKey, signal); if (!bytes) throw new Error(`Plex does not have a poster for "${item.title}".`); return bytes; }); }
}
