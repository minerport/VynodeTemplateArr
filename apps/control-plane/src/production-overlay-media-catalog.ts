import type { OverlayApplicationItem } from '@vynode/poster-overlays';
import { SqliteJsonRepository, type VynodeSqliteStorage } from '@vynode/storage';

interface CatalogLibrary {
  libraryId: string;
  refreshedAt: string;
  items: OverlayApplicationItem[];
}

interface CatalogState {
  libraries: Record<string, CatalogLibrary>;
  enrichments: Record<string, CatalogEnrichment>;
}

type CatalogValue = string | number | boolean | readonly string[] | undefined;

interface CatalogEnrichment {
  refreshedAt: string;
  values: Record<string, CatalogValue>;
}

export class ProductionOverlayMediaCatalog {
  readonly #values: SqliteJsonRepository<CatalogState>;

  public constructor(
    storage: VynodeSqliteStorage,
    private readonly now: () => Date = () => new Date(),
    private readonly maxAgeMs = 5 * 60_000
  ) {
    this.#values = new SqliteJsonRepository(storage, 'overlay-media-catalog');
    if (!this.#values.get('state'))
      this.#values.put('state', { libraries: {}, enrichments: {} });
  }

  public get(libraryId: string): readonly OverlayApplicationItem[] | undefined {
    const entry = this.#values.get('state')?.value.libraries[libraryId];
    if (!entry) return undefined;
    const refreshed = new Date(entry.refreshedAt).valueOf();
    if (!Number.isFinite(refreshed) || this.now().valueOf() - refreshed > this.maxAgeMs)
      return undefined;
    return structuredClone(entry.items);
  }

  public async put(
    libraryId: string,
    items: readonly OverlayApplicationItem[]
  ): Promise<void> {
    this.#update((current) => ({
      ...current,
      libraries: {
        ...current.libraries,
        [libraryId]: {
          libraryId,
          refreshedAt: this.now().toISOString(),
          items: structuredClone(items) as OverlayApplicationItem[],
        },
      },
    }));
  }

  public async invalidate(libraryId?: string): Promise<void> {
    this.#update((current) => {
      if (!libraryId) return { ...current, libraries: {} };
      const libraries = { ...current.libraries };
      delete libraries[libraryId];
      return { ...current, libraries };
    });
  }

  public getEnrichment(
    ratingKey: string,
    provider: string,
    maxAgeMs = this.maxAgeMs
  ): Readonly<Record<string, CatalogValue>> | undefined {
    const entry = this.#state().enrichments[`${ratingKey}:${provider}`];
    if (!entry) return undefined;
    const refreshed = new Date(entry.refreshedAt).valueOf();
    if (!Number.isFinite(refreshed) || this.now().valueOf() - refreshed > maxAgeMs)
      return undefined;
    return structuredClone(entry.values);
  }

  public async putEnrichment(
    ratingKey: string,
    provider: string,
    values: Readonly<Record<string, CatalogValue>>
  ): Promise<void> {
    this.#update((current) => ({
      ...current,
      enrichments: {
        ...current.enrichments,
        [`${ratingKey}:${provider}`]: {
          refreshedAt: this.now().toISOString(),
          values: structuredClone(values) as Record<string, CatalogValue>,
        },
      },
    }));
  }

  #state(): CatalogState {
    const state = this.#values.get('state')?.value;
    return {
      libraries: state?.libraries ?? {},
      enrichments: state?.enrichments ?? {},
    };
  }

  #update(change: (current: CatalogState) => CatalogState): void {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const stored = this.#values.get('state');
      try {
        this.#values.put('state', change(this.#state()), stored?.revision ?? 0, this.now());
        return;
      } catch (error) {
        if (attempt === 2) throw error;
      }
    }
  }
}
