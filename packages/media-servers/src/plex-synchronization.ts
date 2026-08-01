import type {
  CollectionAssetReference,
  CollectionPosterSettings,
  PlexDiscoveredItem,
} from '@vynode/contracts';

import { PlexManagementClient } from './plex-http.js';

export type PlexDiscoveredSyncOperation =
  | 'visibility'
  | 'sort-title'
  | 'summary'
  | 'collection-mode'
  | 'poster'
  | 'wallpaper'
  | 'theme'
  | 'home-order';

export interface PlexDiscoveredSyncFailure {
  operation: PlexDiscoveredSyncOperation;
  message: string;
}

export interface PlexDiscoveredSyncReport {
  itemId: string;
  applied: readonly PlexDiscoveredSyncOperation[];
  skipped: readonly PlexDiscoveredSyncOperation[];
  failures: readonly PlexDiscoveredSyncFailure[];
}

export interface PlexDiscoveredAssetResolver {
  resolveAsset(reference: CollectionAssetReference): Promise<Uint8Array>;
  renderPoster(
    item: PlexDiscoveredItem,
    settings: CollectionPosterSettings,
    signal?: AbortSignal
  ): Promise<Uint8Array | undefined>;
  posterFingerprint?(
    item: PlexDiscoveredItem,
    settings: CollectionPosterSettings,
    signal?: AbortSignal
  ): Promise<string>;
}

const message = (error: unknown): string =>
  error instanceof Error
    ? error.message
    : 'Unknown Plex synchronization error.';

const hubIdentifier = (item: PlexDiscoveredItem): string =>
  item.kind === 'default-hub'
    ? item.plexKey
    : `custom.collection.${item.libraryId}.${item.plexKey}`;

export class PlexDiscoveredItemSynchronizer {
  public constructor(
    private readonly client: PlexManagementClient,
    private readonly assets: PlexDiscoveredAssetResolver
  ) {}

  public async synchronizeItem(
    item: PlexDiscoveredItem,
    active: boolean,
    signal?: AbortSignal
  ): Promise<PlexDiscoveredSyncReport> {
    const applied: PlexDiscoveredSyncOperation[] = [];
    const skipped: PlexDiscoveredSyncOperation[] = [];
    const failures: PlexDiscoveredSyncFailure[] = [];
    const run = async (
      operation: PlexDiscoveredSyncOperation,
      work: () => Promise<void>
    ) => {
      try {
        await work();
        applied.push(operation);
      } catch (error) {
        if (signal?.aborted) throw error;
        failures.push({ operation, message: message(error) });
      }
    };
    const effectiveVisibility = active
      ? item.visibility
      : item.timeRestriction.inactiveVisibility;
    await run('visibility', () =>
      this.client.updateDiscoveredVisibility(item, effectiveVisibility, signal)
    );

    if (item.kind === 'default-hub') {
      skipped.push(
        'sort-title',
        'summary',
        'collection-mode',
        'poster',
        'wallpaper',
        'theme'
      );
      return { itemId: item.id, applied, skipped, failures };
    }

    if (item.titleSort?.trim()) {
      await run('sort-title', () =>
        this.client.updateCollectionSortTitle(
          item.plexKey,
          item.titleSort!.trim(),
          signal
        )
      );
    } else {
      skipped.push('sort-title');
    }

    if (
      item.metadataSettings?.enableCustomSummary &&
      item.metadataSettings.customSummary.trim()
    ) {
      await run('summary', () =>
        this.client.updateCollectionSummary(
          item.plexKey,
          item.metadataSettings!.customSummary.trim(),
          signal
        )
      );
    } else {
      skipped.push('summary');
    }

    if (item.posterSettings) {
      await run('collection-mode', () =>
        this.client.updateCollectionMode(
          item.plexKey,
          item.posterSettings!.hideIndividualItems ? 1 : 2,
          signal
        )
      );
      try {
        const poster = await this.assets.renderPoster(
          item,
          item.posterSettings,
          signal
        );
        if (poster) {
          await run('poster', () =>
            this.client.uploadCollectionAsset(
              item.plexKey,
              'poster',
              poster,
              signal
            )
          );
        } else {
          skipped.push('poster');
        }
      } catch (error) {
        if (signal?.aborted) throw error;
        failures.push({ operation: 'poster', message: message(error) });
      }
    } else {
      skipped.push('collection-mode', 'poster');
    }

    const metadata = item.metadataSettings;
    if (metadata?.enableCustomWallpaper && metadata.wallpaper) {
      await run('wallpaper', async () =>
        this.client.uploadCollectionAsset(
          item.plexKey,
          'wallpaper',
          await this.assets.resolveAsset(metadata.wallpaper!),
          signal
        )
      );
    } else {
      skipped.push('wallpaper');
    }
    if (metadata?.enableCustomTheme && metadata.theme) {
      await run('theme', async () =>
        this.client.uploadCollectionAsset(
          item.plexKey,
          'theme',
          await this.assets.resolveAsset(metadata.theme!),
          signal
        )
      );
    } else {
      skipped.push('theme');
    }

    return { itemId: item.id, applied, skipped, failures };
  }

  public async synchronizeHomeOrder(
    items: readonly PlexDiscoveredItem[],
    signal?: AbortSignal
  ): Promise<readonly PlexDiscoveredSyncReport[]> {
    const reports: PlexDiscoveredSyncReport[] = [];
    const libraries = new Map<string, PlexDiscoveredItem[]>();
    for (const item of items) {
      if (item.missing || item.homeOrder <= 0) continue;
      const library = libraries.get(item.libraryId) ?? [];
      library.push(item);
      libraries.set(item.libraryId, library);
    }
    for (const libraryItems of libraries.values()) {
      libraryItems.sort(
        (left, right) =>
          left.homeOrder - right.homeOrder || left.id.localeCompare(right.id)
      );
      let predecessor: string | undefined;
      for (const item of libraryItems) {
        const applied: PlexDiscoveredSyncOperation[] = [];
        const failures: PlexDiscoveredSyncFailure[] = [];
        try {
          await this.client.moveHub(
            item.libraryId,
            hubIdentifier(item),
            predecessor,
            signal
          );
          applied.push('home-order');
          predecessor = hubIdentifier(item);
        } catch (error) {
          if (signal?.aborted) throw error;
          failures.push({ operation: 'home-order', message: message(error) });
        }
        reports.push({
          itemId: item.id,
          applied,
          skipped: [],
          failures,
        });
      }
    }
    return reports;
  }
}
