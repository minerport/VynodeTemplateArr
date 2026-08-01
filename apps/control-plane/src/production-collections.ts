import type {
  CollectionDraft,
  CollectionLinkResult,
  CollectionPreviewResult,
  CollectionSurface,
  ManagedCollection,
  PlexDiscoveredItem,
  PlexDiscoveredItemDraft,
  PlexDiscoveredLinkResult,
  PlexDiscoveryResult,
  PlexGeneratedCollectionReference,
  PlexLibraryGeneratorSubtype,
  PlexLibraryGeneratorValue,
  PlexMissingCleanupResult,
  PosterTestSearchItem,
} from '@vynode/contracts';
import {
  plexItemIsActive,
  type PlexDiscoveryRepository,
  type PlexServerConfiguration,
} from '@vynode/media-servers';
import {
  SqliteJsonRepository,
  type VynodeSqliteStorage,
} from '@vynode/storage';
import { randomUUID } from 'node:crypto';

interface StoredCollections {
  collections: ManagedCollection[];
}

const copyLinkedConfiguration = (
  member: ManagedCollection,
  master: ManagedCollection
): ManagedCollection => ({
  ...member,
  description: master.description,
  sourceType: master.sourceType,
  ...(master.sourceSettings
    ? { sourceSettings: structuredClone(master.sourceSettings) }
    : {}),
  ...(master.posterSettings
    ? { posterSettings: structuredClone(master.posterSettings) }
    : {}),
  ...(master.behaviorSettings
    ? { behaviorSettings: structuredClone(master.behaviorSettings) }
    : {}),
  ...(master.missingMediaSettings
    ? { missingMediaSettings: structuredClone(master.missingMediaSettings) }
    : {}),
  ...(master.multiSourceSettings
    ? { multiSourceSettings: structuredClone(master.multiSourceSettings) }
    : {}),
  ...(master.metadataSettings
    ? { metadataSettings: structuredClone(master.metadataSettings) }
    : {}),
  ...(master.tmdbDiscoverSettings
    ? { tmdbDiscoverSettings: structuredClone(master.tmdbDiscoverSettings) }
    : {}),
  homeVisible: master.homeVisible,
  recommendedVisible: master.recommendedVisible,
  libraryVisible: master.libraryVisible,
  status: 'needs-sync',
});
export interface ProductionCollectionSyncResult {
  plexRatingKey: string;
  itemCount: number;
  created: boolean;
  failures: readonly string[];
  active?: boolean;
}
export class ProductionCollectionSurface {
  readonly #values: SqliteJsonRepository<StoredCollections>;
  public constructor(
    private readonly storage: VynodeSqliteStorage,
    private readonly plexConfiguration: () => Promise<
      PlexServerConfiguration | undefined
    >,
    private readonly previewProvider?: (
      collection: ManagedCollection,
      signal?: AbortSignal
    ) => Promise<CollectionPreviewResult>,
    private readonly syncProvider?: (
      collection: ManagedCollection,
      signal?: AbortSignal,
      onPlexIdentity?: (plexRatingKey: string) => Promise<void>
    ) => Promise<ProductionCollectionSyncResult>,
    private readonly now: () => Date = () => new Date(),
    private discoveryRepository?: PlexDiscoveryRepository,
    private discoverProvider?: () => Promise<PlexDiscoveryResult>
  ) {
    this.#values = new SqliteJsonRepository(storage, 'collections');
    if (!this.#values.get('surface'))
      this.#values.put('surface', { collections: [] });
  }
  public connectDiscovery(
    repository: PlexDiscoveryRepository,
    provider: () => Promise<PlexDiscoveryResult>
  ) {
    this.discoveryRepository = repository;
    this.discoverProvider = provider;
  }
  private generatorValuesProvider?: (
    libraryId: string,
    mediaType: 'movie' | 'show',
    subtype: PlexLibraryGeneratorSubtype,
    signal?: AbortSignal
  ) => Promise<readonly PlexLibraryGeneratorValue[]>;
  private generatorSyncProvider?: (
    collection: ManagedCollection,
    values: readonly PlexLibraryGeneratorValue[],
    signal?: AbortSignal,
    onReference?: (reference: PlexGeneratedCollectionReference) => Promise<void>
  ) => Promise<{
    references: readonly PlexGeneratedCollectionReference[];
    failures: readonly string[];
  }>;
  private personSyncProvider?: (
    collection: ManagedCollection,
    signal?: AbortSignal,
    onReference?: (reference: PlexGeneratedCollectionReference) => Promise<void>
  ) => Promise<{
    references: readonly PlexGeneratedCollectionReference[];
    failures: readonly string[];
  }>;
  private previewFilterProvider?: (
    collection: ManagedCollection,
    result: CollectionPreviewResult,
    signal?: AbortSignal
  ) => Promise<CollectionPreviewResult>;
  private plexItemSearchProvider?: (
    libraryId: string,
    query: string,
    itemType?: 'movie' | 'show' | 'season' | 'episode'
  ) => Promise<readonly PosterTestSearchItem[]>;
  public connectLibraryGenerator(
    values: NonNullable<ProductionCollectionSurface['generatorValuesProvider']>,
    sync: NonNullable<ProductionCollectionSurface['generatorSyncProvider']>
  ) {
    this.generatorValuesProvider = values;
    this.generatorSyncProvider = sync;
  }
  public connectPersonGenerator(
    sync: NonNullable<ProductionCollectionSurface['personSyncProvider']>
  ) {
    this.personSyncProvider = sync;
  }
  public connectPreviewFilter(
    filter: NonNullable<ProductionCollectionSurface['previewFilterProvider']>
  ) {
    this.previewFilterProvider = filter;
  }
  public connectPlexItemSearch(
    search: NonNullable<ProductionCollectionSurface['plexItemSearchProvider']>
  ) {
    this.plexItemSearchProvider = search;
  }
  public async searchPlexItems(
    libraryId: string,
    query: string,
    itemType?: 'movie' | 'show' | 'season' | 'episode'
  ) {
    if (!this.plexItemSearchProvider)
      throw new Error('Plex item search is unavailable.');
    return this.plexItemSearchProvider(libraryId, query, itemType);
  }
  public async plexGeneratorValues(
    libraryId: string,
    subtype: PlexLibraryGeneratorSubtype
  ) {
    const plex = await this.plexConfiguration();
    const library = plex?.libraries.find(
      (item) =>
        item.key === libraryId &&
        item.available &&
        (item.type === 'movie' || item.type === 'show')
    );
    if (!library) throw new Error('The selected Plex library is unavailable.');
    if (!this.generatorValuesProvider)
      throw new Error('Plex library generators are unavailable.');
    return this.generatorValuesProvider(
      libraryId,
      library.type as 'movie' | 'show',
      subtype
    );
  }
  async #mutate<T>(operation: (state: StoredCollections) => T): Promise<T> {
    return this.storage.transaction(async () => {
      const current = this.#values.get('surface')!;
      const state = structuredClone(current.value);
      const result = operation(state);
      this.#values.put('surface', state, current.revision);
      return result;
    });
  }
  public async get(): Promise<CollectionSurface> {
    const collections = this.#values.get('surface')!.value.collections;
    const plex = await this.plexConfiguration();
    const libraries = (plex?.libraries ?? [])
      .filter(
        (library) =>
          library.available &&
          (library.type === 'movie' || library.type === 'show')
      )
      .map((library) => ({
        id: library.key,
        name: library.title,
        mediaType: library.type as 'movie' | 'show',
        collectionCount: collections.filter(
          (collection) => collection.libraryId === library.key
        ).length,
      }));
    const discovery = await this.discoveryRepository?.get();
    return {
      libraries,
      collections: structuredClone(collections),
      timestamp: this.now().toISOString(),
      discoveredPlexItems: structuredClone(discovery?.items ?? []),
      discoveryStatus: {
        enabled: Boolean(this.discoveryRepository && this.discoverProvider),
        plexConnected: Boolean(plex),
        running: false,
        libraryCount: libraries.length,
        capabilities: {
          hubReordering: true,
          visibilityControl: true,
          builtInHubManagement: true,
          collectionHubManagement: true,
        },
      },
    };
  }
  public async save(
    id: string | undefined,
    draft: CollectionDraft
  ): Promise<ManagedCollection | undefined> {
    const plex = await this.plexConfiguration();
    const library = plex?.libraries.find(
      (item) =>
        item.key === draft.libraryId &&
        item.available &&
        item.type === draft.mediaType
    );
    if (!library) throw new Error('Choose an available verified Plex library.');
    return this.#mutate((state) => {
      const index = id
        ? state.collections.findIndex((item) => item.id === id)
        : -1;
      if (id && index < 0) return undefined;
      const current = index >= 0 ? state.collections[index] : undefined;
      const next: ManagedCollection = {
        id: current?.id ?? randomUUID(),
        title: draft.title.trim(),
        description: draft.description.trim(),
        mediaType: draft.mediaType,
        ...(draft.itemType ? { itemType: draft.itemType } : {}),
        libraryId: draft.libraryId,
        libraryName: library.title,
        sourceType: draft.sourceType,
        sourceSettings: structuredClone(draft.sourceSettings),
        posterSettings: structuredClone(draft.posterSettings),
        behaviorSettings: structuredClone(draft.behaviorSettings),
        missingMediaSettings: structuredClone(draft.missingMediaSettings),
        multiSourceSettings: structuredClone(draft.multiSourceSettings),
        metadataSettings: structuredClone(draft.metadataSettings),
        tmdbDiscoverSettings: structuredClone(draft.tmdbDiscoverSettings),
        itemCount: current?.itemCount ?? 0,
        homeVisible: current?.homeVisible ?? true,
        recommendedVisible: current?.recommendedVisible ?? true,
        libraryVisible: current?.libraryVisible ?? true,
        sharedOrder: current?.sharedOrder ?? state.collections.length,
        libraryOrder:
          current?.libraryOrder ??
          state.collections.filter((item) => item.libraryId === draft.libraryId)
            .length,
        status: 'needs-sync',
        isActive: current?.isActive ?? true,
        ...(current?.lastSyncedAt
          ? { lastSyncedAt: current.lastSyncedAt }
          : {}),
        ...(current?.plexRatingKey
          ? { plexRatingKey: current.plexRatingKey }
          : {}),
        ...(current?.linkGroupId
          ? { linkGroupId: current.linkGroupId, isLinked: true }
          : {}),
        ...(current?.isUnlinked ? { isUnlinked: true } : {}),
      };
      if (index >= 0) state.collections[index] = next;
      else state.collections.push(next);
      if (next.linkGroupId) {
        state.collections = state.collections.map((item) =>
          item.id !== next.id && item.linkGroupId === next.linkGroupId
            ? copyLinkedConfiguration(item, next)
            : item
        );
      }
      return structuredClone(next);
    });
  }
  public async updatePlacement(
    id: string,
    input: Partial<
      Pick<
        ManagedCollection,
        | 'homeVisible'
        | 'recommendedVisible'
        | 'libraryVisible'
        | 'sharedOrder'
        | 'libraryOrder'
      >
    >
  ) {
    return this.#mutate((state) => {
      const index = state.collections.findIndex((item) => item.id === id);
      if (index < 0) return undefined;
      const next = { ...state.collections[index]!, ...input };
      state.collections[index] = next;
      if (next.linkGroupId) {
        const sharedVisibility = {
          ...('homeVisible' in input
            ? { homeVisible: next.homeVisible }
            : {}),
          ...('recommendedVisible' in input
            ? { recommendedVisible: next.recommendedVisible }
            : {}),
          ...('libraryVisible' in input
            ? { libraryVisible: next.libraryVisible }
            : {}),
        };
        state.collections = state.collections.map((item) =>
          item.id !== next.id && item.linkGroupId === next.linkGroupId
            ? { ...item, ...sharedVisibility, status: 'needs-sync' }
            : item
        );
      }
      return structuredClone(next);
    });
  }
  public async reorderPlacement(
    firstId: string,
    secondId: string,
    orderKey: 'sharedOrder' | 'libraryOrder'
  ) {
    return this.#mutate((state) => {
      const first = state.collections.find((item) => item.id === firstId),
        second = state.collections.find((item) => item.id === secondId);
      if (
        !first ||
        !second ||
        (orderKey === 'libraryOrder' && first.libraryId !== second.libraryId)
      )
        return false;
      const value = first[orderKey];
      first[orderKey] = second[orderKey];
      second[orderKey] = value;
      return true;
    });
  }
  public async copy(id: string) {
    const current = this.#values
      .get('surface')!
      .value.collections.find((item) => item.id === id);
    if (!current) return undefined;
    return this.#mutate((state) => {
      const copy = {
        ...structuredClone(current),
        id: randomUUID(),
        title: `${current.title} Copy`,
        plexRatingKey: undefined,
        lastSyncedAt: undefined,
        linkGroupId: undefined,
        isLinked: false,
        isUnlinked: true,
        status: 'needs-sync' as const,
        sharedOrder: state.collections.length,
        libraryOrder: state.collections.filter(
          (item) => item.libraryId === current.libraryId
        ).length,
      };
      const cleaned = JSON.parse(JSON.stringify(copy)) as ManagedCollection;
      state.collections.push(cleaned);
      return structuredClone(cleaned);
    });
  }
  public async delete(id: string) {
    return this.#mutate((state) => {
      const length = state.collections.length;
      state.collections = state.collections.filter((item) => item.id !== id);
      return state.collections.length !== length;
    });
  }
  public async link(
    masterId: string,
    memberIds: readonly string[]
  ): Promise<CollectionLinkResult | undefined> {
    if (
      memberIds.length === 0 ||
      memberIds.includes(masterId) ||
      new Set(memberIds).size !== memberIds.length
    )
      return undefined;
    return this.#mutate((state) => {
      const selected = [masterId, ...memberIds].map((id) =>
        state.collections.find((item) => item.id === id)
      );
      if (selected.some((item) => !item)) return undefined;
      const master = selected[0]!;
      if (
        selected.some(
          (item) =>
            item!.mediaType !== master.mediaType ||
            (item!.itemType ?? item!.mediaType) !==
              (master.itemType ?? master.mediaType)
        )
      )
        throw new Error('Linked collections must use the same item type.');
      if (
        new Set(selected.map((item) => item!.libraryId)).size !== selected.length
      )
        throw new Error('Linked collections must use different Plex libraries.');
      const groupId = randomUUID();
      const ids = new Set([masterId, ...memberIds]);
      state.collections = state.collections.map((item) =>
        ids.has(item.id)
          ? {
              ...(item.id === master.id
                ? item
                : copyLinkedConfiguration(item, master)),
              linkGroupId: groupId,
              isLinked: true,
              isUnlinked: false,
            }
          : item
      );
      return {
        groupId,
        collections: structuredClone(
          state.collections.filter((item) => ids.has(item.id))
        ),
      };
    });
  }
  public async unlink(id: string): Promise<CollectionLinkResult | undefined> {
    return this.#mutate((state) => {
      const item = state.collections.find((candidate) => candidate.id === id);
      if (!item) return undefined;
      const groupId = item.linkGroupId ?? randomUUID();
      state.collections = state.collections
        .map((candidate) =>
          candidate.id === id
            ? {
                ...candidate,
                linkGroupId: undefined,
                isLinked: false,
                isUnlinked: true,
              }
            : candidate
        )
        .map(
          (candidate) =>
            JSON.parse(JSON.stringify(candidate)) as ManagedCollection
        );
      return {
        groupId,
        collections: structuredClone(
          state.collections.filter((candidate) => candidate.id === id)
        ),
      };
    });
  }
  public async preview(
    id: string,
    signal?: AbortSignal
  ): Promise<CollectionPreviewResult | undefined> {
    const collection = this.#values
      .get('surface')!
      .value.collections.find((item) => item.id === id);
    if (!collection) return undefined;
    if (!this.previewProvider)
      throw new Error('Production collection preview is unavailable.');
    const result = await this.previewProvider(
      structuredClone(collection),
      signal
    );
    return this.previewFilterProvider
      ? this.previewFilterProvider(structuredClone(collection), result, signal)
      : result;
  }
  public async synchronize(
    id: string,
    signal?: AbortSignal
  ): Promise<ProductionCollectionSyncResult | undefined> {
    const collection = this.#values
      .get('surface')!
      .value.collections.find((item) => item.id === id);
    if (!collection) return undefined;
    await this.#mutate((state) => {
      const item = state.collections.find((candidate) => candidate.id === id);
      if (item) item.status = 'syncing';
    });
    try {
      const subtype = collection.sourceSettings?.subtype;
      const generatorSubtypes = [
        'genres',
        'decades',
        'resolutions',
        'content-ratings',
      ] as const;
      if (
        collection.sourceType === 'plex' &&
        generatorSubtypes.includes(
          subtype as (typeof generatorSubtypes)[number]
        )
      ) {
        if (!this.generatorValuesProvider || !this.generatorSyncProvider)
          throw new Error('Production Plex library generation is unavailable.');
        const values = await this.generatorValuesProvider(
          collection.libraryId,
          collection.mediaType,
          subtype as PlexLibraryGeneratorSubtype,
          signal
        );
        const generated = await this.generatorSyncProvider(
          collection,
          values,
          signal,
          async (reference) => {
            await this.#mutate((state) => {
              const item = state.collections.find((candidate) => candidate.id === id);
              const generator = item?.sourceSettings?.plexGenerator;
              if (!item || !generator) return;
              generator.generatedCollections = [
                ...(generator.generatedCollections ?? []).filter(
                  (existing) => existing.value !== reference.value
                ),
                reference,
              ];
            });
          }
        );
        if (generated.failures.length)
          throw new Error(
            `Plex generator verification failed: ${generated.failures.join(', ')}.`
          );
        await this.#mutate((state) => {
          const item = state.collections.find(
            (candidate) => candidate.id === id
          );
          if (item) {
            item.status = 'ready';
            item.itemCount = generated.references.length;
            item.lastSyncedAt = this.now().toISOString();
            item.sourceSettings = {
              ...item.sourceSettings!,
              plexGenerator: {
                ...item.sourceSettings!.plexGenerator!,
                selectedValues: item.sourceSettings!.plexGenerator!
                  .selectedValues.length
                  ? item.sourceSettings!.plexGenerator!.selectedValues
                  : values.map((value) => value.value),
                generatedCollections: generated.references,
              },
            };
          }
        });
        return {
          plexRatingKey: generated.references[0]?.ratingKey ?? '',
          itemCount: generated.references.length,
          created: generated.references.length > 0,
          failures: [],
        };
      }
      if (
        collection.sourceType === 'plex' &&
        (subtype === 'actors' || subtype === 'directors')
      ) {
        if (!this.personSyncProvider)
          throw new Error(
            'Production Plex person collection generation is unavailable.'
          );
        const generated = await this.personSyncProvider(
          collection,
          signal,
          async (reference) => {
            await this.#mutate((state) => {
              const item = state.collections.find((candidate) => candidate.id === id);
              if (!item?.sourceSettings) return;
              item.sourceSettings.generatedPersonCollections = [
                ...(item.sourceSettings.generatedPersonCollections ?? []).filter(
                  (existing) =>
                    existing.value.toLocaleLowerCase() !==
                    reference.value.toLocaleLowerCase()
                ),
                reference,
              ];
            });
          }
        );
        if (generated.failures.length)
          throw new Error(
            `Plex person generator verification failed: ${generated.failures.join(', ')}.`
          );
        await this.#mutate((state) => {
          const item = state.collections.find(
            (candidate) => candidate.id === id
          );
          if (item) {
            item.status = 'ready';
            item.itemCount = generated.references.length;
            item.lastSyncedAt = this.now().toISOString();
            item.sourceSettings = {
              ...item.sourceSettings!,
              generatedPersonCollections: generated.references,
            };
          }
        });
        return {
          plexRatingKey: generated.references[0]?.ratingKey ?? '',
          itemCount: generated.references.length,
          created: generated.references.length > 0,
          failures: [],
        };
      }
      if (!this.syncProvider)
        throw new Error(
          'Production collection synchronization is unavailable.'
        );
      const result = await this.syncProvider(
        structuredClone(collection),
        signal,
        async (plexRatingKey) => {
          await this.#mutate((state) => {
            const item = state.collections.find(
              (candidate) => candidate.id === id
            );
            if (item && !item.plexRatingKey) item.plexRatingKey = plexRatingKey;
          });
        }
      );
      if (result.failures.length)
        throw new Error(
          `Plex synchronization verification failed: ${result.failures.join(', ')}.`
        );
      await this.#mutate((state) => {
        const item = state.collections.find((candidate) => candidate.id === id);
        if (item) {
          item.status = 'ready';
          item.plexRatingKey = result.plexRatingKey;
          item.itemCount = result.itemCount;
          item.lastSyncedAt = this.now().toISOString();
          if (item.behaviorSettings?.timeRestriction)
            item.isActive = plexItemIsActive(
              item.behaviorSettings.timeRestriction,
              this.now()
            );
        }
      });
      return result;
    } catch (error) {
      await this.#mutate((state) => {
        const item = state.collections.find((candidate) => candidate.id === id);
        if (item) item.status = 'error';
      });
      throw error;
    }
  }
  async #mutateDiscovery<T>(
    operation: (items: PlexDiscoveredItem[]) => T
  ): Promise<T> {
    if (!this.discoveryRepository)
      throw new Error('Plex discovery storage is unavailable.');
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.discoveryRepository.get();
      const items = structuredClone(current.items) as PlexDiscoveredItem[];
      const result = operation(items);
      if (
        await this.discoveryRepository.compareAndSet(current.revision, {
          ...current,
          revision: current.revision + 1,
          items,
        })
      )
        return result;
    }
    throw new Error('Plex discovery settings changed; reload and retry.');
  }
  public async discoverPlex(): Promise<PlexDiscoveryResult> {
    if (!this.discoverProvider)
      throw new Error(
        'Plex discovery is not connected. Connect and verify Plex before running discovery.'
      );
    return this.discoverProvider();
  }
  public async updateDiscoveredPlexItem(
    id: string,
    draft: PlexDiscoveredItemDraft
  ) {
    return this.#mutateDiscovery((items) => {
      const index = items.findIndex((item) => item.id === id);
      const current = items[index];
      if (!current) return undefined;
      const updated: PlexDiscoveredItem = {
        ...current,
        homeOrder: draft.homeOrder,
        libraryOrder: draft.libraryOrder,
        visibility: draft.visibility,
        timeRestriction: {
          ...draft.timeRestriction,
          removeFromPlexWhenInactive: false,
        },
        ...(draft.titleSort?.trim()
          ? { titleSort: draft.titleSort.trim() }
          : {}),
        ...(current.kind === 'pre-existing-collection'
          ? {
              posterSettings: draft.posterSettings ?? current.posterSettings,
              metadataSettings:
                draft.metadataSettings ?? current.metadataSettings,
            }
          : {}),
        lastValidatedAt: this.now().toISOString(),
      };
      items[index] = updated;
      return structuredClone(updated);
    });
  }
  public async linkDiscoveredPlexItems(
    masterId: string,
    memberIds: readonly string[]
  ): Promise<PlexDiscoveredLinkResult | undefined> {
    return this.#mutateDiscovery((items) => {
      const ids = [...new Set([masterId, ...memberIds])];
      const selected = ids.map((id) => items.find((item) => item.id === id));
      const master = selected[0];
      if (!master || selected.some((item) => !item) || selected.length < 2)
        return undefined;
      if (
        selected.some(
          (item, index) =>
            index > 0 &&
            (item!.kind !== master.kind ||
              item!.mediaType !== master.mediaType ||
              item!.libraryId === master.libraryId)
        )
      )
        return undefined;
      const groupId = master.linkGroupId ?? randomUUID();
      for (const item of selected as PlexDiscoveredItem[]) {
        item.isLinked = true;
        item.isUnlinked = false;
        item.linkGroupId = groupId;
        item.visibility = master.visibility;
        item.timeRestriction = master.timeRestriction;
      }
      return {
        groupId,
        items: structuredClone(selected as PlexDiscoveredItem[]),
      };
    });
  }
  public async unlinkDiscoveredPlexItems(
    id: string
  ): Promise<PlexDiscoveredLinkResult | undefined> {
    return this.#mutateDiscovery((items) => {
      const selected = items.find((item) => item.id === id);
      if (!selected?.isLinked || !selected.linkGroupId) return undefined;
      const groupId = selected.linkGroupId;
      const members = items.filter((item) => item.linkGroupId === groupId);
      for (const item of members) {
        item.isLinked = false;
        item.isUnlinked = true;
      }
      return { groupId, items: structuredClone(members) };
    });
  }
  public async cleanupMissingPlexItems(): Promise<PlexMissingCleanupResult> {
    return this.#mutateDiscovery((items) => {
      const count = items.filter((item) => item.missing).length;
      items.splice(0, items.length, ...items.filter((item) => !item.missing));
      return { cleanupCount: count, plexHubDeleteCount: 0, warnings: [] };
    });
  }
}
