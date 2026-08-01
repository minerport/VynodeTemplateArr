import type {
  PlexDiscoveryResult,
} from '@vynode/contracts';
import type {
  PlexSynchronizationResult,
  ProductionPlexServices,
} from '@vynode/media-servers';

export interface RegisteredBackgroundJob<T> {
  id: string;
  name: string;
  cronSchedule: string;
  execute(signal: AbortSignal): Promise<T>;
}

export interface BackgroundJobRegistrar {
  register<T>(job: RegisteredBackgroundJob<T>): void;
}

export interface PlexFullSynchronizationOutcome {
  discovery: PlexDiscoveryResult;
  synchronization: PlexSynchronizationResult;
}

export const registerPlexBackgroundJobs = (
  registrar: BackgroundJobRegistrar,
  plex: ProductionPlexServices
): void => {
  registrar.register<PlexFullSynchronizationOutcome>({
    id: 'plex-collections-sync',
    name: 'Plex Collections Sync',
    cronSchedule: '0 0 */6 * * *',
    async execute(signal) {
      const discovery = await plex.discover(signal);
      const synchronization = await plex.synchronize(signal);
      return { discovery, synchronization };
    },
  });
  registrar.register<PlexSynchronizationResult>({
    id: 'plex-collections-quick-sync',
    name: 'Collections Quick Sync',
    cronSchedule: '0 */30 * * * *',
    execute: (signal) => plex.synchronize(signal),
  });
};
