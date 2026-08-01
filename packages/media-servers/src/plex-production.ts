import type {
  CollectionBehaviorSettings,
  PlexDiscoveredItem,
  PlexDiscoveryResult,
} from '@vynode/contracts';
import { createHash } from 'node:crypto';

import type { PlexServerConfiguration } from './index.js';
import {
  PlexDiscoveryCoordinator,
  PlexDiscoveryScanner,
  type PlexDiscoveryRepository,
  type PlexDiscoveryStoreState,
} from './plex-discovery.js';
import {
  PlexHttpTransport,
  PlexManagementClient,
  type PlexHttpTransportOptions,
} from './plex-http.js';
import {
  PlexDiscoveredItemSynchronizer,
  type PlexDiscoveredAssetResolver,
  type PlexDiscoveredSyncReport,
} from './plex-synchronization.js';

export interface ProductionPlexServicesOptions {
  configuration(): Promise<PlexServerConfiguration | undefined>;
  token(): Promise<string>;
  managedCollectionKeys(): Promise<ReadonlySet<string>>;
  repository: PlexDiscoveryRepository;
  assets: PlexDiscoveredAssetResolver;
  checkpoints?: PlexSynchronizationCheckpointRepository;
  clientIdentifier: string;
  allowedMutationServerNames?: ReadonlySet<string>;
  now?(): Date;
  transport?: Pick<
    PlexHttpTransportOptions,
    'product' | 'timeoutMs' | 'maxResponseBytes'
  >;
}

export interface PlexSynchronizationCheckpointState {
  itemFingerprints: Readonly<Record<string, string>>;
  orderFingerprint?: string;
}

export interface PlexSynchronizationCheckpointRepository {
  get(): Promise<PlexSynchronizationCheckpointState>;
  save(state: PlexSynchronizationCheckpointState): Promise<void>;
}

export interface PlexSynchronizationResult {
  completedAt: string;
  itemReports: readonly PlexDiscoveredSyncReport[];
  orderReports: readonly PlexDiscoveredSyncReport[];
}

const fingerprint = (value: unknown): string =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');

export const plexSynchronizationFingerprint = (
  item: PlexDiscoveredItem,
  active: boolean,
  posterDependencyFingerprint?: string
): string =>
  fingerprint({
    kind: item.kind,
    plexKey: item.plexKey,
    libraryId: item.libraryId,
    titleSort: item.titleSort,
    visibility: active
      ? item.visibility
      : item.timeRestriction.inactiveVisibility,
    posterSettings: item.posterSettings,
    posterDependencyFingerprint,
    metadataSettings: item.metadataSettings,
  });

const allItemOperations = (
  item: PlexDiscoveredItem
): PlexDiscoveredSyncReport['skipped'] =>
  item.kind === 'default-hub'
    ? ['visibility']
    : [
        'visibility',
        'sort-title',
        'summary',
        'collection-mode',
        'poster',
        'wallpaper',
        'theme',
      ];

const configuredServer = async (
  provider: ProductionPlexServicesOptions['configuration']
): Promise<PlexServerConfiguration> => {
  const configuration = await provider();
  if (!configuration) {
    throw new Error('Connect and verify Plex before using Plex discovery.');
  }
  return configuration;
};

const dateValue = (value: string): number => {
  const [day, month] = value.split('-').map(Number);
  return (month ?? Number.NaN) * 100 + (day ?? Number.NaN);
};

export const plexItemIsActive = (
  restriction: CollectionBehaviorSettings['timeRestriction'],
  now: Date
): boolean => {
  if (restriction.alwaysActive) return true;
  const day = [
    'sunday',
    'monday',
    'tuesday',
    'wednesday',
    'thursday',
    'friday',
    'saturday',
  ][now.getDay()] as keyof typeof restriction.weeklySchedule;
  if (!restriction.weeklySchedule[day]) return false;
  if (!restriction.dateRanges.length) return true;
  const current = (now.getMonth() + 1) * 100 + now.getDate();
  return restriction.dateRanges.some(({ startDate, endDate }) => {
    const start = dateValue(startDate);
    const end = dateValue(endDate);
    return (
      Number.isFinite(start) &&
      Number.isFinite(end) &&
      (start <= end
        ? current >= start && current <= end
        : current >= start || current <= end)
    );
  });
};

export class ProductionPlexServices {
  private discoveryRunning = false;
  private synchronizationRunning = false;

  public constructor(private readonly options: ProductionPlexServicesOptions) {}

  public state(): Promise<PlexDiscoveryStoreState> {
    return this.options.repository.get();
  }

  public async discover(signal?: AbortSignal): Promise<PlexDiscoveryResult> {
    if (this.discoveryRunning) {
      throw new Error('Plex discovery is already running.');
    }
    this.discoveryRunning = true;
    try {
      const configuration = await configuredServer(this.options.configuration);
      const coordinator = new PlexDiscoveryCoordinator({
        scanner: new PlexDiscoveryScanner(this.transport(configuration)),
        repository: this.options.repository,
        libraries: async () => configuration.libraries,
        managedCollectionKeys: this.options.managedCollectionKeys,
        now: () => this.now().toISOString(),
      });
      return await coordinator.scan(signal);
    } finally {
      this.discoveryRunning = false;
    }
  }

  public async synchronize(
    signal?: AbortSignal
  ): Promise<PlexSynchronizationResult> {
    if (this.synchronizationRunning) {
      throw new Error('Plex synchronization is already running.');
    }
    this.synchronizationRunning = true;
    try {
      const configuration = await configuredServer(this.options.configuration);
      if (
        this.options.allowedMutationServerNames &&
        !this.options.allowedMutationServerNames.has(configuration.name)
      ) {
        throw new Error(
          `Plex synchronization is blocked for server "${configuration.name}". Allowed mutation targets: ${
            [...this.options.allowedMutationServerNames].join(', ') || 'none'
          }.`
        );
      }
      const state = await this.options.repository.get();
      const now = this.now();
      const synchronizer = new PlexDiscoveredItemSynchronizer(
        new PlexManagementClient(this.transport(configuration)),
        this.options.assets
      );
      const items = state.items.filter((item) => !item.missing);
      const previous = await this.options.checkpoints?.get();
      const nextFingerprints: Record<string, string> = {};
      const itemReports: PlexDiscoveredSyncReport[] = [];
      for (const item of items) {
        if (signal?.aborted) {
          throw new DOMException('The Plex synchronization was cancelled.', 'AbortError');
        }
        const active = plexItemIsActive(item.timeRestriction, now);
        let posterDependencyFingerprint: string | undefined;
        if (item.posterSettings) {
          try {
            posterDependencyFingerprint =
              await this.options.assets.posterFingerprint?.(
                item,
                item.posterSettings,
                signal
              );
          } catch (error) {
            if (signal?.aborted) throw error;
            // A dependency probe must not stop unrelated Plex items. The
            // render/upload pass below records an actionable poster failure.
          }
        }
        const currentFingerprint = plexSynchronizationFingerprint(
          item,
          active,
          posterDependencyFingerprint
        );
        if (previous?.itemFingerprints[item.id] === currentFingerprint) {
          itemReports.push({
            itemId: item.id,
            applied: [],
            skipped: allItemOperations(item),
            failures: [],
          });
          nextFingerprints[item.id] = currentFingerprint;
          continue;
        }
        const report = await synchronizer.synchronizeItem(item, active, signal);
        itemReports.push(report);
        if (!report.failures.length) nextFingerprints[item.id] = currentFingerprint;
      }
      const orderFingerprint = fingerprint(
        items.map(({ id, kind, libraryId, plexKey, homeOrder }) => ({
          id,
          kind,
          libraryId,
          plexKey,
          homeOrder,
        }))
      );
      if (signal?.aborted) {
        throw new DOMException('The Plex synchronization was cancelled.', 'AbortError');
      }
      const orderReports =
        previous?.orderFingerprint === orderFingerprint
          ? []
          : await synchronizer.synchronizeHomeOrder(items, signal);
      const orderSucceeded = orderReports.every(
        (report) => !report.failures.length
      );
      await this.options.checkpoints?.save({
        itemFingerprints: nextFingerprints,
        ...(orderSucceeded ? { orderFingerprint } : {}),
      });
      return {
        completedAt: now.toISOString(),
        itemReports,
        orderReports,
      };
    } finally {
      this.synchronizationRunning = false;
    }
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private transport(
    configuration: PlexServerConfiguration
  ): PlexHttpTransport {
    return new PlexHttpTransport({
      connection: configuration,
      token: this.options.token,
      clientIdentifier: this.options.clientIdentifier,
      ...this.options.transport,
    });
  }
}
