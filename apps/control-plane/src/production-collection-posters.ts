import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';

import type {
  CollectionPosterDesign,
  CollectionPosterWorkspace,
  PosterEditorAsset,
  SourceColorScheme,
} from '@vynode/contracts';
import { FilePosterEditorAssetStore } from '@vynode/poster-overlays';
import { SqliteJsonRepository, type VynodeSqliteStorage } from '@vynode/storage';

type PosterInput = { name: string; description: string; design: CollectionPosterDesign };
type StoredWorkspace = Omit<CollectionPosterWorkspace, 'assets'>;

export class ProductionCollectionPosterStore {
  readonly #values: SqliteJsonRepository<StoredWorkspace>;
  readonly #assets: FilePosterEditorAssetStore;

  public constructor(
    private readonly storage: VynodeSqliteStorage,
    dataDirectory: string,
    private readonly now: () => Date = () => new Date()
  ) {
    this.#values = new SqliteJsonRepository(storage, 'collection-posters');
    this.#assets = new FilePosterEditorAssetStore({
      directory: resolve(dataDirectory, 'poster-editor-assets'),
    });
    if (!this.#values.get('workspace')) {
      this.#values.put('workspace', { templates: [], savedPosters: [], sourceColors: {} });
    }
  }

  async #mutate(operation: (state: StoredWorkspace) => void): Promise<CollectionPosterWorkspace> {
    await this.storage.transaction(async () => {
      const current = this.#values.get('workspace')!;
      const state = structuredClone(current.value);
      operation(state);
      this.#values.put('workspace', state, current.revision);
    });
    return this.get();
  }

  public async get(): Promise<CollectionPosterWorkspace> {
    const state = this.#values.get('workspace')!.value;
    return { ...structuredClone(state), assets: await this.#assets.list() };
  }

  public saveTemplate(id: string | undefined, input: PosterInput) {
    return this.#mutate((state) => {
      const timestamp = this.now().toISOString();
      if (id) state.templates = state.templates.map((item) => item.id === id ? { ...item, ...input, updatedAt: timestamp } : item);
      else state.templates = [...state.templates, { id: `template-${randomUUID().slice(0, 8)}`, ...input, isDefault: false, createdAt: timestamp, updatedAt: timestamp }];
    });
  }

  public async duplicateTemplate(id: string) {
    if (!this.#values.get('workspace')!.value.templates.some((item) => item.id === id)) return undefined;
    return this.#mutate((state) => {
      const source = state.templates.find((item) => item.id === id)!;
      const timestamp = this.now().toISOString();
      state.templates = [...state.templates, { ...source, id: `template-${randomUUID().slice(0, 8)}`, name: `${source.name} Copy`, isDefault: false, createdAt: timestamp, updatedAt: timestamp }];
    });
  }

  public async setDefault(id: string) {
    if (!this.#values.get('workspace')!.value.templates.some((item) => item.id === id)) return undefined;
    return this.#mutate((state) => { state.templates = state.templates.map((item) => ({ ...item, isDefault: item.id === id })); });
  }

  public async deleteTemplate(id: string) {
    const template = this.#values.get('workspace')!.value.templates.find((item) => item.id === id);
    if (!template || template.isDefault) return undefined;
    return this.#mutate((state) => { state.templates = state.templates.filter((item) => item.id !== id); });
  }

  public savePoster(id: string | undefined, input: PosterInput) {
    return this.#mutate((state) => {
      const timestamp = this.now().toISOString();
      if (id) state.savedPosters = state.savedPosters.map((item) => item.id === id ? { ...item, ...input, updatedAt: timestamp } : item);
      else state.savedPosters = [...state.savedPosters, { id: `poster-${randomUUID().slice(0, 8)}`, ...input, isEditable: true, usedBy: [], createdAt: timestamp, updatedAt: timestamp }];
    });
  }

  public async duplicatePoster(id: string) {
    if (!this.#values.get('workspace')!.value.savedPosters.some((item) => item.id === id)) return undefined;
    return this.#mutate((state) => {
      const source = state.savedPosters.find((item) => item.id === id)!;
      const timestamp = this.now().toISOString();
      state.savedPosters = [...state.savedPosters, { ...source, id: `poster-${randomUUID().slice(0, 8)}`, name: `${source.name} Copy`, usedBy: [], isEditable: true, createdAt: timestamp, updatedAt: timestamp }];
    });
  }

  public async deletePosters(ids: readonly string[], force: boolean) {
    const current = this.#values.get('workspace')!.value;
    const blocked = current.savedPosters.filter((item) => ids.includes(item.id) && item.usedBy.length > 0);
    const deletable = force || blocked.length === 0 ? ids : [];
    const workspace = await this.#mutate((state) => { state.savedPosters = state.savedPosters.filter((item) => !deletable.includes(item.id)); });
    return { workspace, blocked };
  }

  public importSourceColors(colors: Readonly<Record<string, SourceColorScheme>>) {
    return this.#mutate((state) => { state.sourceColors = { ...state.sourceColors, ...colors }; });
  }

  public async saveAsset(input: { name: string; mimeType: string; bytes: Uint8Array }): Promise<PosterEditorAsset> { return this.#assets.save(input); }
  public readAsset(id: string) { return this.#assets.read(id); }
  public deleteAsset(id: string) { return this.#assets.delete(id); }
}
