import type {
  RadarrAvailability,
  SonarrMonitorType,
  SonarrSeriesType,
} from './index.js';

type JsonRecord = Record<string, unknown>;

export interface ArrRequestTransport {
  request(input: {
    method: 'GET' | 'POST' | 'PUT';
    url: string;
    headers: Readonly<Record<string, string>>;
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<{ status: number; body: unknown }>;
}

class FetchArrRequestTransport implements ArrRequestTransport {
  public async request(input: {
    method: 'GET' | 'POST' | 'PUT';
    url: string;
    headers: Readonly<Record<string, string>>;
    body?: unknown;
    signal?: AbortSignal;
  }): Promise<{ status: number; body: unknown }> {
    const response = await fetch(input.url, {
      method: input.method,
      headers: input.headers,
      ...(input.body === undefined
        ? {}
        : { body: JSON.stringify(input.body) }),
      ...(input.signal ? { signal: input.signal } : {}),
    });
    const text = await response.text();
    let body: unknown = text;
    try {
      body = JSON.parse(text);
    } catch {
      // The status-specific error remains credential-safe.
    }
    return { status: response.status, body };
  }
}

export interface ArrRequestClientOptions {
  hostname: string;
  port: number;
  useSsl: boolean;
  urlBase: string;
  apiKey: string;
  transport?: ArrRequestTransport;
}

export interface AddRadarrMovieInput {
  title: string;
  year: number;
  tmdbId: number;
  profileId: number;
  rootFolder: string;
  minimumAvailability: RadarrAvailability;
  tagIds: readonly number[];
  monitor: boolean;
  searchOnAdd: boolean;
  tagExistingItems: boolean;
}

export interface AddSonarrSeriesInput {
  title: string;
  tvdbId: number;
  profileId: number;
  rootFolder: string;
  tagIds: readonly number[];
  monitorType: SonarrMonitorType;
  seriesType: SonarrSeriesType;
  seasonFolders: boolean;
  searchOnAdd: boolean;
  tagExistingItems: boolean;
}

export interface ArrRequestResult {
  id: number;
  outcome: 'added' | 'existing' | 'skipped-unmonitored';
  searched: boolean;
  tagsApplied: boolean;
}

export type ArrItemStatus = 'available' | 'processing';

const record = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : undefined;

const positiveInteger = (value: unknown): number | undefined => {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined;
};

export class ArrRequestClient {
  private readonly baseUrl: string;
  private readonly transport: ArrRequestTransport;
  private readonly headers: Readonly<Record<string, string>>;

  public constructor(options: ArrRequestClientOptions) {
    if (
      !options.hostname.trim() ||
      options.hostname.includes('://') ||
      options.hostname.includes('/') ||
      !Number.isInteger(options.port) ||
      options.port < 1 ||
      options.port > 65535 ||
      !options.apiKey.trim()
    )
      throw new Error('Arr endpoint and API key are required.');
    const urlBase = options.urlBase.trim()
      ? `/${options.urlBase.trim().replace(/^\/+|\/+$/g, '')}`
      : '';
    this.baseUrl = `${options.useSsl ? 'https' : 'http'}://${options.hostname}:${options.port}${urlBase}/api/v3`;
    this.transport = options.transport ?? new FetchArrRequestTransport();
    this.headers = {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'X-Api-Key': options.apiKey,
    };
  }

  public async addMovie(
    input: AddRadarrMovieInput,
    signal?: AbortSignal
  ): Promise<ArrRequestResult> {
    this.validateMovie(input);
    const lookup = await this.request(
      'GET',
      `/movie/lookup?term=${encodeURIComponent(`tmdb:${input.tmdbId}`)}`,
      undefined,
      signal
    );
    const candidate = Array.isArray(lookup) ? record(lookup[0]) : undefined;
    if (!candidate)
      throw new Error('Radarr could not find this TMDB movie.');
    const existingId = positiveInteger(candidate.id);
    if (existingId)
      return this.handleExisting(
        'radarr',
        existingId,
        candidate.monitored !== false,
        input.tagIds,
        input.tagExistingItems,
        input.searchOnAdd,
        signal
      );
    const created = record(
      await this.request(
        'POST',
        '/movie',
        {
          title: input.title,
          year: input.year,
          tmdbId: input.tmdbId,
          titleSlug: String(input.tmdbId),
          qualityProfileId: input.profileId,
          rootFolderPath: input.rootFolder,
          minimumAvailability: input.minimumAvailability,
          monitored: input.monitor,
          tags: [...input.tagIds],
          addOptions: { searchForMovie: input.searchOnAdd },
        },
        signal
      )
    );
    const id = positiveInteger(created?.id);
    if (!id) throw new Error('Radarr did not return the added movie ID.');
    return {
      id,
      outcome: 'added',
      searched: input.searchOnAdd,
      tagsApplied: input.tagIds.length > 0,
    };
  }

  public async addSeries(
    input: AddSonarrSeriesInput,
    signal?: AbortSignal
  ): Promise<ArrRequestResult> {
    this.validateSeries(input);
    const lookup = await this.request(
      'GET',
      `/series/lookup?term=${encodeURIComponent(`tvdb:${input.tvdbId}`)}`,
      undefined,
      signal
    );
    const candidate = Array.isArray(lookup) ? record(lookup[0]) : undefined;
    if (!candidate)
      throw new Error('Sonarr could not find this TVDB series.');
    const existingId = positiveInteger(candidate.id);
    if (existingId)
      return this.handleExisting(
        'sonarr',
        existingId,
        candidate.monitored !== false,
        input.tagIds,
        input.tagExistingItems,
        input.searchOnAdd,
        signal
      );
    const created = record(
      await this.request(
        'POST',
        '/series',
        {
          title: input.title,
          tvdbId: input.tvdbId,
          qualityProfileId: input.profileId,
          rootFolderPath: input.rootFolder,
          tags: [...input.tagIds],
          monitored: input.monitorType !== 'none',
          seasonFolder: input.seasonFolders,
          seriesType: input.seriesType,
          addOptions: {
            monitor: input.monitorType,
            searchForMissingEpisodes: input.searchOnAdd,
          },
        },
        signal
      )
    );
    const id = positiveInteger(created?.id);
    if (!id) throw new Error('Sonarr did not return the added series ID.');
    return {
      id,
      outcome: 'added',
      searched: input.searchOnAdd,
      tagsApplied: input.tagIds.length > 0,
    };
  }

  public async itemStatus(
    kind: 'radarr' | 'sonarr',
    id: number,
    signal?: AbortSignal
  ): Promise<ArrItemStatus> {
    if (!positiveInteger(id)) throw new Error('A valid Arr item ID is required.');
    const item = record(
      await this.request(
        'GET',
        `${kind === 'radarr' ? '/movie' : '/series'}/${id}`,
        undefined,
        signal
      )
    );
    if (!item) throw new Error('Arr returned an invalid item status.');
    if (kind === 'radarr') return item.hasFile === true ? 'available' : 'processing';
    const statistics = record(item.statistics);
    return Number(statistics?.episodeFileCount ?? 0) > 0
      ? 'available'
      : 'processing';
  }

  private async handleExisting(
    kind: 'radarr' | 'sonarr',
    id: number,
    monitored: boolean,
    tagIds: readonly number[],
    tagExistingItems: boolean,
    searchOnAdd: boolean,
    signal?: AbortSignal
  ): Promise<ArrRequestResult> {
    if (!monitored)
      return {
        id,
        outcome: 'skipped-unmonitored',
        searched: false,
        tagsApplied: false,
      };
    let tagsApplied = false;
    if (tagExistingItems && tagIds.length > 0) {
      await this.request(
        'PUT',
        kind === 'radarr' ? '/movie/editor' : '/series/editor',
        {
          [kind === 'radarr' ? 'movieIds' : 'seriesIds']: [id],
          tags: [...tagIds],
          applyTags: 'add',
        },
        signal
      );
      tagsApplied = true;
    }
    if (searchOnAdd) {
      await this.request(
        'POST',
        '/command',
        kind === 'radarr'
          ? { name: 'MoviesSearch', movieIds: [id] }
          : { name: 'SeriesSearch', seriesId: id },
        signal
      );
    }
    return {
      id,
      outcome: 'existing',
      searched: searchOnAdd,
      tagsApplied,
    };
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT',
    path: string,
    body?: unknown,
    signal?: AbortSignal
  ): Promise<unknown> {
    const response = await this.transport.request({
      method,
      url: `${this.baseUrl}${path}`,
      headers: this.headers,
      ...(body === undefined ? {} : { body }),
      ...(signal ? { signal } : {}),
    });
    if (response.status < 200 || response.status >= 300)
      throw new Error(
        [401, 403].includes(response.status)
          ? 'Arr rejected the API key.'
          : `Arr request failed with status ${response.status}.`
      );
    return response.body;
  }

  private validateMovie(input: AddRadarrMovieInput): void {
    if (
      !input.title.trim() ||
      !positiveInteger(input.year) ||
      !positiveInteger(input.tmdbId) ||
      !positiveInteger(input.profileId) ||
      !input.rootFolder.trim()
    )
      throw new Error('Complete Radarr movie metadata is required.');
  }

  private validateSeries(input: AddSonarrSeriesInput): void {
    if (
      !input.title.trim() ||
      !positiveInteger(input.tvdbId) ||
      !positiveInteger(input.profileId) ||
      !input.rootFolder.trim()
    )
      throw new Error('Complete Sonarr series metadata is required.');
  }
}
