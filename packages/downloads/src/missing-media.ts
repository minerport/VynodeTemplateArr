import type {
  AddRadarrMovieInput,
  AddSonarrSeriesInput,
  ArrRequestClient,
  ArrRequestResult,
} from './arr-request.js';
import type { ArrConfiguration } from './index.js';

export interface MissingMediaCandidate {
  key: string;
  mediaType: 'movie' | 'show';
  title: string;
  year?: number;
  releaseDate?: string;
  tmdbId?: number;
  tvdbId?: number;
}

export interface MissingMediaDestinationOverride {
  serverId?: string;
  profileId?: number;
  rootFolder?: string;
  tagIds: readonly number[];
  monitor: boolean;
  monitorType:
    | 'all'
    | 'future'
    | 'missing'
    | 'existing'
    | 'pilot'
    | 'firstSeason'
    | 'latestSeason'
    | 'none';
  searchOnAdd: boolean;
}

export interface MissingMediaExecution {
  key: string;
  title: string;
  mediaType: 'movie' | 'show';
  outcome:
    | ArrRequestResult['outcome']
    | 'failed'
    | 'skipped-missing-provider-id';
  serviceId?: number;
  serverId?: string;
  message?: string;
}

export interface MissingMediaExecutionReport {
  executions: readonly MissingMediaExecution[];
  added: number;
  existing: number;
  skipped: number;
  failed: number;
}

export interface DirectMissingMediaDependencies {
  configurations(kind: 'radarr' | 'sonarr'): Promise<readonly ArrConfiguration[]>;
  client(configuration: ArrConfiguration): Promise<ArrRequestClient>;
}

const selectConfiguration = (
  configurations: readonly ArrConfiguration[],
  override: MissingMediaDestinationOverride
): ArrConfiguration | undefined =>
  (override.serverId
    ? configurations.find((entry) => entry.id === override.serverId)
    : undefined) ??
  configurations.find(
    (entry) => entry.selection.isDefault && !entry.selection.is4k
  );

export class DirectMissingMediaCoordinator {
  public constructor(private readonly dependencies: DirectMissingMediaDependencies) {}

  public async execute(
    candidates: readonly MissingMediaCandidate[],
    destinations: {
      radarr: MissingMediaDestinationOverride;
      sonarr: MissingMediaDestinationOverride;
    },
    signal?: AbortSignal
  ): Promise<MissingMediaExecutionReport> {
    const executions: MissingMediaExecution[] = [];
    const configurations = {
      radarr: await this.dependencies.configurations('radarr'),
      sonarr: await this.dependencies.configurations('sonarr'),
    };
    for (const candidate of candidates) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const kind = candidate.mediaType === 'movie' ? 'radarr' : 'sonarr';
      const destination = destinations[kind];
      const configuration = selectConfiguration(
        configurations[kind],
        destination
      );
      if (!configuration) {
        executions.push({
          key: candidate.key,
          title: candidate.title,
          mediaType: candidate.mediaType,
          outcome: 'failed',
          message: `No ${kind === 'radarr' ? 'Radarr' : 'Sonarr'} destination is configured.`,
        });
        continue;
      }
      if (
        (candidate.mediaType === 'movie' && !candidate.tmdbId) ||
        (candidate.mediaType === 'show' && !candidate.tvdbId)
      ) {
        executions.push({
          key: candidate.key,
          title: candidate.title,
          mediaType: candidate.mediaType,
          outcome: 'skipped-missing-provider-id',
          message:
            candidate.mediaType === 'movie'
              ? 'A TMDB ID is required by Radarr.'
              : 'A TVDB ID is required by Sonarr.',
        });
        continue;
      }
      try {
        const client = await this.dependencies.client(configuration);
        const profileId =
          destination.profileId ?? configuration.selection.profileId;
        const rootFolder =
          destination.rootFolder ?? configuration.selection.rootFolder;
        let result: ArrRequestResult;
        if (candidate.mediaType === 'movie') {
          const selection =
            configuration.selection.kind === 'radarr'
              ? configuration.selection
              : undefined;
          if (!selection) throw new Error('The selected server is not Radarr.');
          const input: AddRadarrMovieInput = {
            title: candidate.title,
            year: candidate.year ?? new Date().getUTCFullYear(),
            tmdbId: candidate.tmdbId!,
            profileId,
            rootFolder,
            minimumAvailability: selection.minimumAvailability,
            tagIds: destination.tagIds,
            monitor: destination.monitor,
            searchOnAdd: destination.searchOnAdd,
            tagExistingItems: selection.tagExistingItems,
          };
          result = await client.addMovie(input, signal);
        } else {
          const selection =
            configuration.selection.kind === 'sonarr'
              ? configuration.selection
              : undefined;
          if (!selection) throw new Error('The selected server is not Sonarr.');
          const input: AddSonarrSeriesInput = {
            title: candidate.title,
            tvdbId: candidate.tvdbId!,
            profileId,
            rootFolder,
            tagIds: destination.tagIds,
            monitorType: destination.monitorType,
            seriesType: selection.seriesType,
            seasonFolders: selection.seasonFolders,
            searchOnAdd: destination.searchOnAdd,
            tagExistingItems: selection.tagExistingItems,
          };
          result = await client.addSeries(input, signal);
        }
        executions.push({
          key: candidate.key,
          title: candidate.title,
          mediaType: candidate.mediaType,
          outcome: result.outcome,
          serviceId: result.id,
          serverId: configuration.id,
        });
      } catch (error) {
        if (
          signal?.aborted ||
          (error instanceof DOMException && error.name === 'AbortError')
        )
          throw error;
        executions.push({
          key: candidate.key,
          title: candidate.title,
          mediaType: candidate.mediaType,
          outcome: 'failed',
          message:
            error instanceof Error
              ? error.message
              : `${kind === 'radarr' ? 'Radarr' : 'Sonarr'} request failed.`,
        });
      }
    }
    return {
      executions,
      added: executions.filter((item) => item.outcome === 'added').length,
      existing: executions.filter((item) => item.outcome === 'existing').length,
      skipped: executions.filter((item) =>
        ['skipped-unmonitored', 'skipped-missing-provider-id'].includes(
          item.outcome
        )
      ).length,
      failed: executions.filter((item) => item.outcome === 'failed').length,
    };
  }
}
