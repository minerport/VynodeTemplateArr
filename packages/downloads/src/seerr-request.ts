import type { MissingMediaCandidate, MissingMediaExecutionReport } from './missing-media.js';
import type { SeerrConfiguration } from './index.js';

type FetchLike = typeof fetch;

interface SeerrRequest {
  id: number;
  status: number;
  media?: {
    id?: number;
    tmdbId?: number;
    status?: number;
    status4k?: number;
    mediaType?: 'movie' | 'tv';
  };
}

interface SeerrTvDetails {
  seasons?: {
    seasonNumber?: number;
    airDate?: string;
    episodeCount?: number;
  }[];
}

export interface SeerrMissingMediaSettings {
  autoApproveMovies: boolean;
  autoApproveTv: boolean;
  maxSeasonsToRequest: number;
  seasonsPerShowLimit: number;
  seasonGrabOrder: 'first' | 'latest' | 'airing';
  seerrRadarr: {
    serverId?: number;
    profileId?: number;
    rootFolder?: string;
  };
  seerrSonarr: {
    serverId?: number;
    profileId?: number;
    rootFolder?: string;
  };
}

const endpointUrl = (configuration: SeerrConfiguration, path: string): string =>
  `${configuration.endpoint.useSsl ? 'https' : 'http'}://${configuration.endpoint.hostname}:${configuration.endpoint.port}${configuration.endpoint.urlBase}${path}`;

const failure = (status: number): Error =>
  new Error(`Seerr request failed with status ${status}.`);

const requestStatus = (request: SeerrRequest): 'pending' | 'approved' | 'declined' =>
  request.status === 1 ? 'pending' : request.status === 3 ? 'declined' : 'approved';

const chooseSeasons = (
  details: SeerrTvDetails,
  settings: SeerrMissingMediaSettings,
  remaining: number
): number[] | 'all' => {
  const seasons = (details.seasons ?? [])
    .filter((season) =>
      Number.isInteger(season.seasonNumber) &&
      season.seasonNumber! > 0 &&
      (season.episodeCount ?? 0) > 0)
    .map((season) => ({
      number: season.seasonNumber!,
      airDate: season.airDate ? Date.parse(season.airDate) : Number.MAX_SAFE_INTEGER,
    }));
  if (!seasons.length) return 'all';
  if (settings.seasonGrabOrder === 'latest')
    seasons.sort((a, b) => b.number - a.number);
  else if (settings.seasonGrabOrder === 'airing') {
    const now = Date.now();
    seasons.sort((a, b) =>
      Math.abs(a.airDate - now) - Math.abs(b.airDate - now) ||
      b.number - a.number);
  } else seasons.sort((a, b) => a.number - b.number);
  const perShow = settings.seasonsPerShowLimit > 0
    ? settings.seasonsPerShowLimit
    : seasons.length;
  const limit = remaining > 0 ? Math.min(perShow, remaining) : perShow;
  return seasons.slice(0, limit).map((season) => season.number);
};

export class HttpSeerrRequestCoordinator {
  public constructor(
    private readonly secret: (configuration: SeerrConfiguration) => string | undefined,
    private readonly request: FetchLike = fetch
  ) {}

  public async execute(
    configuration: SeerrConfiguration,
    candidates: readonly MissingMediaCandidate[],
    settings: SeerrMissingMediaSettings,
    signal?: AbortSignal
  ): Promise<MissingMediaExecutionReport> {
    const apiKey = this.secret(configuration);
    if (!apiKey) throw new Error('Seerr credentials are unavailable.');
    const headers = { 'Content-Type': 'application/json', 'X-Api-Key': apiKey };
    const executions: MissingMediaExecutionReport['executions'][number][] = [];
    let requestedSeasons = 0;
    for (const candidate of candidates) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      if (!candidate.tmdbId) {
        executions.push({
          key: candidate.key,
          title: candidate.title,
          mediaType: candidate.mediaType,
          outcome: 'skipped-missing-provider-id',
          message: 'A TMDB ID is required by Seerr.',
        });
        continue;
      }
      try {
        const destination = candidate.mediaType === 'movie'
          ? settings.seerrRadarr
          : settings.seerrSonarr;
        let seasons: number[] | 'all' | undefined;
        if (candidate.mediaType === 'show') {
          const detailsResponse = await this.request(
            endpointUrl(configuration, `/api/v1/tv/${candidate.tmdbId}`),
            { headers: { 'X-Api-Key': apiKey }, ...(signal ? { signal } : {}) }
          );
          if (!detailsResponse.ok) throw failure(detailsResponse.status);
          const remaining = settings.maxSeasonsToRequest > 0
            ? Math.max(0, settings.maxSeasonsToRequest - requestedSeasons)
            : 0;
          if (settings.maxSeasonsToRequest > 0 && remaining === 0) {
            executions.push({
              key: candidate.key,
              title: candidate.title,
              mediaType: candidate.mediaType,
              outcome: 'skipped-unmonitored',
              message: 'The collection season request limit was reached.',
            });
            continue;
          }
          seasons = chooseSeasons(
            await detailsResponse.json() as SeerrTvDetails,
            settings,
            remaining
          );
          if (Array.isArray(seasons)) requestedSeasons += seasons.length;
        }
        const payload = {
          mediaType: candidate.mediaType === 'movie' ? 'movie' : 'tv',
          mediaId: candidate.tmdbId,
          ...(candidate.tvdbId ? { tvdbId: candidate.tvdbId } : {}),
          ...(seasons ? { seasons } : {}),
          is4k: false,
          ...(destination.serverId !== undefined ? { serverId: destination.serverId } : {}),
          ...(destination.profileId !== undefined ? { profileId: destination.profileId } : {}),
          ...(destination.rootFolder ? { rootFolder: destination.rootFolder } : {}),
        };
        const response = await this.request(endpointUrl(configuration, '/api/v1/request'), {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
          ...(signal ? { signal } : {}),
        });
        if (response.status === 409) {
          executions.push({
            key: candidate.key,
            title: candidate.title,
            mediaType: candidate.mediaType,
            outcome: 'existing',
          });
          continue;
        }
        if (!response.ok) throw failure(response.status);
        let created = await response.json() as SeerrRequest;
        const approve = candidate.mediaType === 'movie'
          ? settings.autoApproveMovies
          : settings.autoApproveTv;
        if (approve && requestStatus(created) === 'pending') {
          const approval = await this.request(
            endpointUrl(configuration, `/api/v1/request/${created.id}/approve`),
            {
              method: 'POST',
              headers: { 'X-Api-Key': apiKey },
              ...(signal ? { signal } : {}),
            }
          );
          if (!approval.ok) throw failure(approval.status);
          created = await approval.json() as SeerrRequest;
        }
        executions.push({
          key: candidate.key,
          title: candidate.title,
          mediaType: candidate.mediaType,
          outcome: 'added',
          serviceId: created.id,
          serverId: String(destination.serverId ?? ''),
          message: `Seerr request ${requestStatus(created)}.`,
        });
      } catch (error) {
        if (signal?.aborted || (error instanceof DOMException && error.name === 'AbortError'))
          throw error;
        executions.push({
          key: candidate.key,
          title: candidate.title,
          mediaType: candidate.mediaType,
          outcome: 'failed',
          message: error instanceof Error ? error.message : 'Seerr request failed.',
        });
      }
    }
    return {
      executions,
      added: executions.filter((item) => item.outcome === 'added').length,
      existing: executions.filter((item) => item.outcome === 'existing').length,
      skipped: executions.filter((item) =>
        ['skipped-unmonitored', 'skipped-missing-provider-id'].includes(item.outcome)).length,
      failed: executions.filter((item) => item.outcome === 'failed').length,
    };
  }

  public async retry(
    configuration: SeerrConfiguration,
    requestId: number,
    signal?: AbortSignal
  ): Promise<'pending' | 'approved' | 'declined'> {
    const apiKey = this.secret(configuration);
    if (!apiKey) throw new Error('Seerr credentials are unavailable.');
    const response = await this.request(
      endpointUrl(configuration, `/api/v1/request/${requestId}/retry`),
      {
        method: 'POST',
        headers: { 'X-Api-Key': apiKey },
        ...(signal ? { signal } : {}),
      }
    );
    if (!response.ok) throw failure(response.status);
    return requestStatus(await response.json() as SeerrRequest);
  }

  public async status(
    configuration: SeerrConfiguration,
    requestId: number,
    signal?: AbortSignal
  ): Promise<
    'pending' | 'approved' | 'declined' | 'processing' | 'partially-available' | 'available'
  > {
    const apiKey = this.secret(configuration);
    if (!apiKey) throw new Error('Seerr credentials are unavailable.');
    const response = await this.request(
      endpointUrl(configuration, `/api/v1/request/${requestId}`),
      {
        headers: { 'X-Api-Key': apiKey },
        ...(signal ? { signal } : {}),
      }
    );
    if (!response.ok) throw failure(response.status);
    const current = await response.json() as SeerrRequest;
    const availability = current.media?.status ?? 1;
    if (availability === 5) return 'available';
    if (availability === 4) return 'partially-available';
    if (availability === 3) return 'processing';
    return requestStatus(current);
  }
}
