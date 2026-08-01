import type {
  CollectionBehaviorSettings,
  CollectionMetadataSettings,
  CollectionPosterSettings,
  PlexDiscoveredItem,
  PlexDiscoveryResult,
} from '@vynode/contracts';

import type { PlexLibrary } from './index.js';

export interface PlexJsonTransport {
  query(path: string, signal?: AbortSignal): Promise<unknown>;
}

export interface PlexDiscoveryScanInput {
  libraries: readonly PlexLibrary[];
  existing: readonly PlexDiscoveredItem[];
  managedCollectionKeys: ReadonlySet<string>;
  signal?: AbortSignal;
  now: string;
}

export interface PlexDiscoveryScanOutput {
  observed: readonly PlexDiscoveredItem[];
  warnings: readonly string[];
  collectionLibraryIds: ReadonlySet<string>;
  hubLibraryIds: ReadonlySet<string>;
}

type JsonRecord = Record<string, unknown>;

const record = (value: unknown): JsonRecord | undefined =>
  typeof value === 'object' && value !== null
    ? (value as JsonRecord)
    : undefined;

const list = (value: unknown): readonly JsonRecord[] =>
  Array.isArray(value)
    ? value.map(record).filter((item): item is JsonRecord => Boolean(item))
    : record(value)
      ? [record(value)!]
      : [];

const container = (value: unknown): JsonRecord =>
  record(record(value)?.MediaContainer) ?? {};

const text = (value: unknown): string =>
  typeof value === 'string' || typeof value === 'number' ? String(value) : '';

const plexBoolean = (value: unknown): boolean =>
  value === true || value === 1 || value === '1' || value === 'true';

const defaultSchedule = (): CollectionBehaviorSettings['timeRestriction'] => ({
  alwaysActive: true,
  removeFromPlexWhenInactive: false,
  inactiveVisibility: {
    usersHome: false,
    serverOwnerHome: false,
    libraryRecommended: false,
  },
  dateRanges: [],
  weeklySchedule: {
    monday: true,
    tuesday: true,
    wednesday: true,
    thursday: true,
    friday: true,
    saturday: true,
    sunday: true,
  },
});

const defaultPoster = (): CollectionPosterSettings => ({
  autoGenerate: false,
  applyOverlaysDuringSync: false,
  useTmdbFranchisePoster: false,
  hideIndividualItems: false,
});

const defaultMetadata = (): CollectionMetadataSettings => ({
  enableCustomSummary: false,
  customSummary: '',
  enableCustomWallpaper: false,
  enableCustomTheme: false,
});

const builtInHubNames: Readonly<Record<string, string>> = {
  'movie.recentlyadded': 'Recently Added Movies',
  'movie.recentlyreleased': 'Recently Released Movies',
  'movie.curated': 'Seasonal Movies',
  'movie.topunwatched': 'Top Unwatched Movies',
  'movie.recentlyviewed': 'Recently Watched Movies',
  'tv.recentlyadded': 'Recently Added TV',
  'tv.recentlyaired': 'Recently Released Episodes',
  'tv.startwatching': 'Start Watching',
  'tv.rediscover': 'Rediscover',
  'tv.toprated': 'Top Rated TV',
  'tv.recentlyviewed': 'Recently Watched Episodes',
  'recent.library.playlists': 'Library Playlists',
};

const collectionKeyFromHub = (identifier: string): string | undefined => {
  if (identifier.startsWith('custom.collection.')) {
    const parts = identifier.split('.');
    return parts.length >= 4 ? parts[3] : undefined;
  }
  return /^\d+$/.test(identifier) ? identifier : undefined;
};

const visibility = (hub?: JsonRecord) => ({
  usersHome: plexBoolean(hub?.promotedToSharedHome),
  serverOwnerHome: plexBoolean(hub?.promotedToOwnHome),
  libraryRecommended: plexBoolean(hub?.promotedToRecommended),
});

const preserveManagedState = (
  observed: PlexDiscoveredItem,
  previous?: PlexDiscoveredItem
): PlexDiscoveredItem => {
  if (!previous) return observed;
  return {
    ...observed,
    homeOrder: previous.homeOrder,
    libraryOrder: previous.libraryOrder,
    visibility: previous.visibility,
    timeRestriction: previous.timeRestriction,
    isLinked: previous.isLinked,
    isUnlinked: previous.isUnlinked,
    ...(previous.titleSort ? { titleSort: previous.titleSort } : {}),
    ...(previous.posterSettings
      ? { posterSettings: previous.posterSettings }
      : {}),
    ...(previous.metadataSettings
      ? { metadataSettings: previous.metadataSettings }
      : {}),
    ...(previous.linkGroupId ? { linkGroupId: previous.linkGroupId } : {}),
  };
};

export class PlexDiscoveryScanner {
  public constructor(private readonly transport: PlexJsonTransport) {}

  public async scan(
    input: PlexDiscoveryScanInput
  ): Promise<PlexDiscoveryScanOutput> {
    const warnings: string[] = [];
    const observed: PlexDiscoveredItem[] = [];
    const collectionLibraryIds = new Set<string>();
    const hubLibraryIds = new Set<string>();
    const previousById = new Map(input.existing.map((item) => [item.id, item]));
    const libraries = input.libraries.filter(
      (library) =>
        library.available &&
        (library.type === 'movie' || library.type === 'show')
    );

    for (const library of libraries) {
      const encodedKey = encodeURIComponent(library.key);
      const mediaType = library.type === 'show' ? 'show' : 'movie';
      const [collectionsResult, hubsResult] = await Promise.allSettled([
        this.transport.query(
          `/library/sections/${encodedKey}/collections`,
          input.signal
        ),
        this.transport.query(
          `/hubs/sections/${encodedKey}/manage`,
          input.signal
        ),
      ]);
      if (collectionsResult.status === 'rejected') {
        warnings.push(
          `${library.title}: Plex collections could not be read (${collectionsResult.reason instanceof Error ? collectionsResult.reason.message : 'unknown error'}).`
        );
      }
      if (collectionsResult.status === 'fulfilled') {
        collectionLibraryIds.add(library.key);
      }
      if (hubsResult.status === 'rejected') {
        warnings.push(
          `${library.title}: Plex hub management could not be read (${hubsResult.reason instanceof Error ? hubsResult.reason.message : 'unknown error'}).`
        );
      }
      if (hubsResult.status === 'fulfilled') {
        hubLibraryIds.add(library.key);
      }

      const collections =
        collectionsResult.status === 'fulfilled'
          ? list(container(collectionsResult.value).Metadata)
          : [];
      const hubs =
        hubsResult.status === 'fulfilled'
          ? list(container(hubsResult.value).Hub)
          : [];
      const collectionHubs = new Map<string, JsonRecord>();

      hubs.forEach((hub, index) => {
        const identifier = text(hub.identifier);
        if (!identifier) return;
        const ratingKey = collectionKeyFromHub(identifier);
        if (ratingKey) {
          collectionHubs.set(ratingKey, hub);
          return;
        }
        const id = `plex-hub:${library.key}:${identifier}`;
        const item: PlexDiscoveredItem = {
          id,
          kind: 'default-hub',
          plexKey: identifier,
          name: text(hub.title) || builtInHubNames[identifier] || identifier,
          libraryId: library.key,
          libraryName: library.title,
          mediaType,
          homeOrder: index + 1,
          libraryOrder: 0,
          visibility: visibility(hub),
          missing: false,
          isLinked: false,
          isUnlinked: false,
          lastValidatedAt: input.now,
          timeRestriction: defaultSchedule(),
        };
        observed.push(preserveManagedState(item, previousById.get(id)));
      });

      collections.forEach((collection) => {
        const ratingKey = text(collection.ratingKey);
        if (
          !ratingKey ||
          input.managedCollectionKeys.has(`${library.key}:${ratingKey}`)
        ) {
          return;
        }
        const hub = collectionHubs.get(ratingKey);
        const id = `plex-collection:${library.key}:${ratingKey}`;
        const title = text(collection.title) || `Plex collection ${ratingKey}`;
        const titleSort = text(collection.titleSort);
        const item: PlexDiscoveredItem = {
          id,
          kind: 'pre-existing-collection',
          plexKey: ratingKey,
          name: title,
          libraryId: library.key,
          libraryName: library.title,
          mediaType,
          ...(titleSort ? { titleSort } : {}),
          homeOrder: hub ? hubs.indexOf(hub) + 1 : 0,
          libraryOrder: 0,
          visibility: visibility(hub),
          missing: false,
          isLinked: false,
          isUnlinked: false,
          lastValidatedAt: input.now,
          timeRestriction: defaultSchedule(),
          posterSettings: defaultPoster(),
          metadataSettings: defaultMetadata(),
        };
        observed.push(preserveManagedState(item, previousById.get(id)));
      });
    }

    return {
      observed,
      warnings,
      collectionLibraryIds,
      hubLibraryIds,
    };
  }
}

export interface PlexDiscoveryStoreState {
  revision: number;
  items: readonly PlexDiscoveredItem[];
  warnings: readonly string[];
  lastCompletedAt?: string;
}

export interface PlexDiscoveryRepository {
  get(): Promise<PlexDiscoveryStoreState>;
  compareAndSet(
    expectedRevision: number,
    next: PlexDiscoveryStoreState
  ): Promise<boolean>;
}

export interface PlexDiscoveryCoordinatorOptions {
  scanner: PlexDiscoveryScanner;
  repository: PlexDiscoveryRepository;
  libraries: () => Promise<readonly PlexLibrary[]>;
  managedCollectionKeys: () => Promise<ReadonlySet<string>>;
  now: () => string;
}

export class PlexDiscoveryConflictError extends Error {}

export class PlexDiscoveryCoordinator {
  private running = false;

  public constructor(
    private readonly options: PlexDiscoveryCoordinatorOptions
  ) {}

  public async scan(signal?: AbortSignal): Promise<PlexDiscoveryResult> {
    if (this.running) {
      throw new PlexDiscoveryConflictError(
        'Plex discovery is already running.'
      );
    }
    this.running = true;
    try {
      const current = await this.options.repository.get();
      const now = this.options.now();
      const scan = await this.options.scanner.scan({
        libraries: await this.options.libraries(),
        existing: current.items,
        managedCollectionKeys: await this.options.managedCollectionKeys(),
        now,
        ...(signal ? { signal } : {}),
      });
      const observedIds = new Set(scan.observed.map((item) => item.id));
      const existingIds = new Set(current.items.map((item) => item.id));
      const imported = scan.observed.filter(
        (item) => !existingIds.has(item.id)
      );
      const retained = current.items
        .filter((item) => !observedIds.has(item.id))
        .map((item) => {
          const validated = (
            item.kind === 'default-hub'
              ? scan.hubLibraryIds
              : scan.collectionLibraryIds
          ).has(item.libraryId);
          return validated
            ? { ...item, missing: true, lastValidatedAt: now }
            : item;
        });
      const nextItems = [...scan.observed, ...retained];
      const validatedMissing = retained.filter((item) => {
        const source =
          item.kind === 'default-hub'
            ? scan.hubLibraryIds
            : scan.collectionLibraryIds;
        return source.has(item.libraryId);
      });
      const next: PlexDiscoveryStoreState = {
        revision: current.revision + 1,
        items: nextItems,
        warnings: scan.warnings,
        lastCompletedAt: now,
      };
      if (
        !(await this.options.repository.compareAndSet(current.revision, next))
      ) {
        throw new PlexDiscoveryConflictError(
          'Discovered Plex settings changed during the scan; reload and retry.'
        );
      }
      return {
        imported,
        totalHubs: scan.observed.filter((item) => item.kind === 'default-hub')
          .length,
        totalPreExistingCollections: scan.observed.filter(
          (item) => item.kind === 'pre-existing-collection'
        ).length,
        validated: scan.observed.length + validatedMissing.length,
        missingIds: validatedMissing.map((item) => item.id),
        completedAt: now,
        ...(scan.warnings.length ? { warnings: scan.warnings } : {}),
      };
    } finally {
      this.running = false;
    }
  }
}
