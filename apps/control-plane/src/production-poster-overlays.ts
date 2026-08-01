import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type {
  OverlayLibraryConfiguration,
  OverlayTemplateSummary,
  PosterOverlayWorkspace,
  PosterSource,
  PosterSourceSettings,
  PosterOverlayTestResult,
  PosterTestSearchItem,
} from '@vynode/contracts';
import type { PlexServerConfiguration } from '@vynode/media-servers';
import type { LocalPosterWorkspaceResult } from '@vynode/poster-overlays';
import { SqliteJsonRepository, type VynodeSqliteStorage } from '@vynode/storage';

interface StoredOverlayLibrary {
  id: string;
  enabledTemplateIds: string[];
  tmdbLanguage: string;
  enableEpisodeScanning: boolean;
  maintainerrSeasonOverlays: boolean;
  itemCount?: number;
  status?: OverlayLibraryConfiguration['status'];
  processedItems?: number;
  failedItems?: number;
  lastAppliedItems?: number;
  lastRestoredItems?: number;
  lastSkippedItems?: number;
  lastUnchangedItems?: number;
  lastNoMatchItems?: number;
  lastAppliedAt?: string;
  indexedItems?: number;
  lastSyncedAt?: string;
}

export interface ProductionPosterOverlayOperations {
  startLibraryJob(id: string): Promise<PosterOverlayWorkspace | undefined>;
  startAllLibraryJobs(): Promise<PosterOverlayWorkspace | undefined>;
  cancelLibraryJob(id: string): Promise<PosterOverlayWorkspace | undefined>;
  resetLibrary(id: string): Promise<PosterOverlayWorkspace | undefined>;
  generateLocalFolders(): Promise<LocalPosterWorkspaceResult>;
  populateLocalPosters(): Promise<LocalPosterWorkspaceResult>;
  searchItems(query: string, libraryId?: string): Promise<readonly PosterTestSearchItem[]>;
  posterForItem(ratingKey: string): Promise<Uint8Array | undefined>;
  testItem(ratingKey: string): Promise<PosterOverlayTestResult | undefined>;
  applyItem(ratingKey: string): Promise<PosterOverlayWorkspace | undefined>;
  resetItem(ratingKey: string): Promise<PosterOverlayWorkspace | undefined>;
  plexLabels(): Promise<readonly string[]>;
  startCleanBaseDownload(): Promise<PosterOverlayWorkspace | undefined>;
}

interface StoredOverlayWorkspace {
  source: PosterSourceSettings;
  templates: OverlayTemplateSummary[];
  libraries: StoredOverlayLibrary[];
}

type OverlayTemplateInput = Omit<
  OverlayTemplateSummary,
  'id' | 'displayOrder' | 'elementCount'
>;

const storedLibrary = (id: string): StoredOverlayLibrary => ({
  id,
  enabledTemplateIds: [],
  tmdbLanguage: 'en',
  enableEpisodeScanning: false,
  maintainerrSeasonOverlays: false,
});

export class ProductionPosterOverlayStore {
  readonly #values: SqliteJsonRepository<StoredOverlayWorkspace>;
  #operations?: ProductionPosterOverlayOperations;

  public constructor(
    private readonly storage: VynodeSqliteStorage,
    private readonly plexConfiguration: () => Promise<PlexServerConfiguration | undefined>,
    dataDirectory: string,
    private readonly maintainerrConfigured: () => Promise<boolean> = async () => false,
    private readonly now: () => Date = () => new Date()
  ) {
    this.#values = new SqliteJsonRepository(storage, 'poster-overlays');
    if (!this.#values.get('workspace')) {
      this.#values.put('workspace', {
        source: {
          revision: 0,
          source: 'plex',
          localRoot: resolve(dataDirectory, 'posters', 'local'),
          updatedAt: this.now().toISOString(),
        },
        templates: [],
        libraries: [],
      });
    }
  }

  public connectOperations(operations: ProductionPosterOverlayOperations): void {
    this.#operations = operations;
  }

  async #mutate<T>(operation: (state: StoredOverlayWorkspace) => T): Promise<T> {
    return this.storage.transaction(async () => {
      const current = this.#values.get('workspace')!;
      const state = structuredClone(current.value);
      const result = operation(state);
      this.#values.put('workspace', state, current.revision);
      return result;
    });
  }

  public async get(): Promise<PosterOverlayWorkspace> {
    const state = this.#values.get('workspace')!.value;
    const configuration = await this.plexConfiguration();
    const maintainerrConfigured = await this.maintainerrConfigured();
    const libraries: OverlayLibraryConfiguration[] = (configuration?.libraries ?? [])
      .filter((library) => library.available && (library.type === 'movie' || library.type === 'show'))
      .map((library) => {
        const saved = state.libraries.find((item) => item.id === library.key) ?? storedLibrary(library.key);
        return {
          ...saved,
          name: library.title,
          type: library.type as 'movie' | 'show',
          maintainerrConfigured,
          itemCount: saved.itemCount ?? 0,
          status: saved.status ?? 'idle',
          processedItems: saved.processedItems ?? 0,
          failedItems: saved.failedItems ?? 0,
        };
      });
    return {
      source: structuredClone(state.source),
      templates: structuredClone(state.templates),
      libraries,
    };
  }

  public async updateLibraryRun(id: string, input: Partial<Omit<StoredOverlayLibrary, 'id' | 'enabledTemplateIds' | 'tmdbLanguage' | 'enableEpisodeScanning' | 'maintainerrSeasonOverlays'>>) {
    await this.#mutate((state) => {
      const index = state.libraries.findIndex((library) => library.id === id);
      const current = index >= 0 ? state.libraries[index]! : storedLibrary(id);
      const next = { ...current, ...input };
      if (index >= 0) state.libraries[index] = next;
      else state.libraries.push(next);
    });
    return this.get();
  }

  public startLibraryJob(id: string) { return this.#operations?.startLibraryJob(id) ?? Promise.resolve(undefined); }
  public startAllLibraryJobs() { return this.#operations?.startAllLibraryJobs() ?? Promise.resolve(undefined); }
  public cancelLibraryJob(id: string) { return this.#operations?.cancelLibraryJob(id) ?? Promise.resolve(undefined); }
  public resetLibrary(id: string) { return this.#operations?.resetLibrary(id) ?? Promise.resolve(undefined); }
  public generateLocalFolders() { if (!this.#operations) throw new Error('Overlay operations are unavailable.'); return this.#operations.generateLocalFolders(); }
  public populateLocalPosters() { if (!this.#operations) throw new Error('Overlay operations are unavailable.'); return this.#operations.populateLocalPosters(); }
  public searchItems(query: string, libraryId?: string) { return this.#operations?.searchItems(query, libraryId) ?? Promise.resolve([]); }
  public posterForItem(ratingKey: string) { return this.#operations?.posterForItem(ratingKey) ?? Promise.resolve(undefined); }
  public testItem(ratingKey: string) { return this.#operations?.testItem(ratingKey) ?? Promise.resolve(undefined); }
  public applyItem(ratingKey: string) { return this.#operations?.applyItem(ratingKey) ?? Promise.resolve(undefined); }
  public resetItem(ratingKey: string) { return this.#operations?.resetItem(ratingKey) ?? Promise.resolve(undefined); }
  public plexLabels() { return this.#operations?.plexLabels() ?? Promise.resolve([]); }
  public startCleanBaseDownload() { return this.#operations?.startCleanBaseDownload() ?? Promise.resolve(undefined); }

  public async saveSource(expectedRevision: number, source: PosterSource) {
    const current = this.#values.get('workspace')!.value.source;
    if (current.revision !== expectedRevision) return undefined;
    await this.#mutate((state) => {
      state.source = {
        ...state.source,
        source,
        revision: expectedRevision + 1,
        updatedAt: this.now().toISOString(),
      };
    });
    return this.get();
  }

  public async updateLibrary(
    id: string,
    input: {
      enabledTemplateIds?: readonly string[];
      tmdbLanguage?: string;
      enableEpisodeScanning?: boolean;
      maintainerrSeasonOverlays?: boolean;
    }
  ) {
    const workspace = await this.get();
    if (!workspace.libraries.some((library) => library.id === id)) return undefined;
    await this.#mutate((state) => {
      const index = state.libraries.findIndex((library) => library.id === id);
      const current = index >= 0 ? state.libraries[index]! : storedLibrary(id);
      const next: StoredOverlayLibrary = {
        ...current,
        ...(input.enabledTemplateIds ? { enabledTemplateIds: [...input.enabledTemplateIds] } : {}),
        ...(input.tmdbLanguage !== undefined ? { tmdbLanguage: input.tmdbLanguage } : {}),
        ...(input.enableEpisodeScanning !== undefined ? { enableEpisodeScanning: input.enableEpisodeScanning } : {}),
        ...(input.maintainerrSeasonOverlays !== undefined ? { maintainerrSeasonOverlays: input.maintainerrSeasonOverlays } : {}),
      };
      if (index >= 0) state.libraries[index] = next;
      else state.libraries.push(next);
    });
    return this.get();
  }

  public async saveTemplate(id: string | undefined, input: OverlayTemplateInput) {
    await this.#mutate((state) => {
      if (id) {
        const index = state.templates.findIndex((template) => template.id === id);
        if (index >= 0) {
          state.templates[index] = {
            ...state.templates[index]!,
            ...structuredClone(input),
            elementCount: input.design.elements.length,
          };
        }
        return;
      }
      state.templates.push({
        ...structuredClone(input),
        id: `overlay-${randomUUID().slice(0, 8)}`,
        displayOrder: state.templates.length,
        elementCount: input.design.elements.length,
      });
    });
    return this.get();
  }

  public async duplicateTemplate(id: string) {
    let found = false;
    await this.#mutate((state) => {
      const source = state.templates.find((template) => template.id === id);
      if (!source) return;
      found = true;
      state.templates.push({
        ...structuredClone(source),
        id: `overlay-${randomUUID().slice(0, 8)}`,
        name: `${source.name} Copy`,
        displayOrder: state.templates.length,
      });
    });
    return found ? this.get() : undefined;
  }

  public async deleteTemplate(id: string) {
    let found = false;
    await this.#mutate((state) => {
      found = state.templates.some((template) => template.id === id);
      if (!found) return;
      state.templates = state.templates.filter((template) => template.id !== id);
      state.libraries = state.libraries.map((library) => ({
        ...library,
        enabledTemplateIds: library.enabledTemplateIds.filter((templateId) => templateId !== id),
      }));
    });
    return found ? this.get() : undefined;
  }

  public async copyElements(sourceId: string, targetIds: readonly string[], elementIds: readonly string[]) {
    let copiedTargets = 0;
    let copiedElements = 0;
    await this.#mutate((state) => {
      const source = state.templates.find((template) => template.id === sourceId);
      if (!source) return;
      const selected = source.design.elements.filter((element) => elementIds.includes(element.id));
      copiedElements = selected.length;
      if (!selected.length) return;
      state.templates = state.templates.map((target) => {
        if (target.id === sourceId || !targetIds.includes(target.id)) return target;
        const maximumOrder = Math.max(-1, ...target.design.elements.map((element) => element.layerOrder));
        const copied = selected.map((element, index) => ({
          ...structuredClone(element),
          id: `${element.id}-copy-${randomUUID().slice(0, 7)}`,
          layerOrder: maximumOrder + index + 1,
        }));
        copiedTargets += 1;
        return {
          ...target,
          design: { ...target.design, elements: [...target.design.elements, ...copied] },
          elementCount: target.elementCount + copied.length,
        };
      });
    });
    if (!copiedTargets || !copiedElements) return undefined;
    return { workspace: await this.get(), copiedTargets, copiedElements };
  }
}
