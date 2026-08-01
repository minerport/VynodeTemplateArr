import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

export interface MissingCollectionMember {
  id: string;
  collectionId: string;
  collectionRatingKey: string;
  libraryId: string;
  mediaType: 'movie' | 'show';
  tmdbId?: number;
  tvdbId?: number;
  title: string;
  year?: number;
  originalPosition: number;
  source: string;
  fullSyncAt: string;
}

export interface AvailablePlexMember {
  ratingKey: string;
  tmdbId?: number;
  tvdbId?: number;
}

export interface MissingCollectionMemberRepository {
  replaceForCollection(
    collectionId: string,
    records: readonly MissingCollectionMember[]
  ): Promise<void>;
  list(): Promise<readonly MissingCollectionMember[]>;
  delete(ids: readonly string[]): Promise<void>;
  prune(activeCollectionIds: ReadonlySet<string>, cutoff: Date): Promise<number>;
}

interface State {
  version: 1;
  records: MissingCollectionMember[];
}

const isPositiveInteger = (value: unknown): value is number =>
  Number.isInteger(value) && Number(value) > 0;

const valid = (value: unknown): value is MissingCollectionMember => {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<MissingCollectionMember>;
  return (
    typeof item.id === 'string' &&
    typeof item.collectionId === 'string' &&
    typeof item.collectionRatingKey === 'string' &&
    typeof item.libraryId === 'string' &&
    ['movie', 'show'].includes(item.mediaType ?? '') &&
    (item.tmdbId === undefined || isPositiveInteger(item.tmdbId)) &&
    (item.tvdbId === undefined || isPositiveInteger(item.tvdbId)) &&
    (isPositiveInteger(item.tmdbId) || isPositiveInteger(item.tvdbId)) &&
    typeof item.title === 'string' &&
    Number.isInteger(item.originalPosition) &&
    Number(item.originalPosition) >= 0 &&
    typeof item.source === 'string' &&
    typeof item.fullSyncAt === 'string' &&
    Number.isFinite(Date.parse(item.fullSyncAt))
  );
};

const parse = (value: string): State => {
  const parsed = JSON.parse(value) as Partial<State>;
  if (
    parsed.version !== 1 ||
    !Array.isArray(parsed.records) ||
    !parsed.records.every(valid)
  ) {
    throw new Error('The missing collection member file is corrupt.');
  }
  return { version: 1, records: parsed.records };
};

export class FileMissingCollectionMemberRepository
  implements MissingCollectionMemberRepository
{
  private writeChain: Promise<void> = Promise.resolve();

  public constructor(
    private readonly path: string,
    private readonly maxRecords = 10_000
  ) {}

  private async read(): Promise<State> {
    try {
      return parse(await readFile(this.path, 'utf8'));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') {
        return { version: 1, records: [] };
      }
      throw error;
    }
  }

  private async write(state: State): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(`${JSON.stringify(state, null, 2)}\n`);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, this.path);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  private mutate(operation: (state: State) => void): Promise<void> {
    const next = this.writeChain.then(async () => {
      const state = await this.read();
      operation(state);
      state.records = state.records
        .sort((left, right) => right.fullSyncAt.localeCompare(left.fullSyncAt))
        .slice(0, this.maxRecords);
      await this.write(state);
    });
    this.writeChain = next.catch(() => undefined);
    return next;
  }

  public replaceForCollection(
    collectionId: string,
    records: readonly MissingCollectionMember[]
  ): Promise<void> {
    if (
      !collectionId.trim() ||
      records.some(
        (record) => record.collectionId !== collectionId || !valid(record)
      )
    ) {
      throw new Error(
        'Missing-member replacement contains invalid or cross-collection records.'
      );
    }
    return this.mutate((state) => {
      state.records = [
        ...state.records.filter((record) => record.collectionId !== collectionId),
        ...records,
      ];
    });
  }

  public async list(): Promise<readonly MissingCollectionMember[]> {
    await this.writeChain;
    return (await this.read()).records;
  }

  public delete(ids: readonly string[]): Promise<void> {
    const unique = new Set(ids);
    return this.mutate((state) => {
      state.records = state.records.filter((record) => !unique.has(record.id));
    });
  }

  public async prune(
    activeCollectionIds: ReadonlySet<string>,
    cutoff: Date
  ): Promise<number> {
    let removed = 0;
    await this.mutate((state) => {
      const before = state.records.length;
      state.records = state.records.filter(
        (record) =>
          activeCollectionIds.has(record.collectionId) &&
          Date.parse(record.fullSyncAt) >= cutoff.getTime()
      );
      removed = before - state.records.length;
    });
    return removed;
  }
}

export interface CollectionAvailabilityTarget {
  id: string;
  collectionRatingKey?: string;
  libraryId: string;
  mediaType: 'movie' | 'show';
}

export interface MissingMemberQuickSyncDependencies {
  repository: MissingCollectionMemberRepository;
  collections(): Promise<readonly CollectionAvailabilityTarget[]>;
  scanLibrary(
    libraryId: string,
    mediaType: 'movie' | 'show',
    signal?: AbortSignal
  ): Promise<readonly AvailablePlexMember[]>;
  addMembers(
    collectionRatingKey: string,
    memberKeys: readonly string[],
    signal?: AbortSignal
  ): Promise<{ added: readonly string[]; failures: readonly string[] }>;
  now(): Date;
}

export interface MissingMemberQuickSyncReport {
  scannedLibraries: number;
  matchedItems: number;
  collectionsUpdated: number;
  itemsAdded: number;
  alreadyPresent: number;
  failed: number;
  staleRecordsRemoved: number;
}

export class MissingMemberQuickSync {
  public constructor(private readonly dependencies: MissingMemberQuickSyncDependencies) {}

  public async run(signal?: AbortSignal): Promise<MissingMemberQuickSyncReport> {
    signal?.throwIfAborted();
    const collections = await this.dependencies.collections();
    const activeIds = new Set(collections.map((collection) => collection.id));
    const staleRecordsRemoved = await this.dependencies.repository.prune(
      activeIds,
      new Date(this.dependencies.now().getTime() - 30 * 86_400_000)
    );
    const records = await this.dependencies.repository.list();
    const targets = new Map(collections.map((target) => [target.id, target]));
    const libraryGroups = new Map<
      string,
      { libraryId: string; mediaType: 'movie' | 'show' }
    >();
    for (const record of records) {
      libraryGroups.set(`${record.libraryId}:${record.mediaType}`, {
        libraryId: record.libraryId,
        mediaType: record.mediaType,
      });
    }

    const matches = new Map<
      string,
      { record: MissingCollectionMember; plex: AvailablePlexMember }[]
    >();
    for (const group of libraryGroups.values()) {
      signal?.throwIfAborted();
      const available = await this.dependencies.scanLibrary(
        group.libraryId,
        group.mediaType,
        signal
      );
      const byTmdb = new Map<number, AvailablePlexMember>();
      const byTvdb = new Map<number, AvailablePlexMember>();
      for (const item of available) {
        if (item.tmdbId && !byTmdb.has(item.tmdbId)) {
          byTmdb.set(item.tmdbId, item);
        }
        if (item.tvdbId && !byTvdb.has(item.tvdbId)) {
          byTvdb.set(item.tvdbId, item);
        }
      }
      for (const record of records.filter(
        (item) =>
          item.libraryId === group.libraryId &&
          item.mediaType === group.mediaType
      )) {
        const target = targets.get(record.collectionId);
        if (
          !target?.collectionRatingKey ||
          target.collectionRatingKey !== record.collectionRatingKey ||
          target.libraryId !== record.libraryId ||
          target.mediaType !== record.mediaType
        ) {
          continue;
        }
        const plex =
          (record.tmdbId ? byTmdb.get(record.tmdbId) : undefined) ??
          (record.tvdbId ? byTvdb.get(record.tvdbId) : undefined);
        if (!plex) continue;
        const groupMatches = matches.get(record.collectionRatingKey) ?? [];
        groupMatches.push({ record, plex });
        matches.set(record.collectionRatingKey, groupMatches);
      }
    }

    let itemsAdded = 0;
    let alreadyPresent = 0;
    let failed = 0;
    let collectionsUpdated = 0;
    const completedIds: string[] = [];
    for (const [ratingKey, group] of matches) {
      signal?.throwIfAborted();
      const ordered = [...group].sort(
        (left, right) =>
          left.record.originalPosition - right.record.originalPosition
      );
      const result = await this.dependencies.addMembers(
        ratingKey,
        ordered.map((item) => item.plex.ratingKey),
        signal
      );
      const failures = new Set(result.failures);
      const added = new Set(result.added);
      for (const match of ordered) {
        if (failures.has(match.plex.ratingKey)) failed += 1;
        else {
          completedIds.push(match.record.id);
          if (added.has(match.plex.ratingKey)) itemsAdded += 1;
          else alreadyPresent += 1;
        }
      }
      if (result.added.length > 0) collectionsUpdated += 1;
    }
    if (completedIds.length) {
      await this.dependencies.repository.delete(completedIds);
    }
    return {
      scannedLibraries: libraryGroups.size,
      matchedItems: [...matches.values()].reduce(
        (total, group) => total + group.length,
        0
      ),
      collectionsUpdated,
      itemsAdded,
      alreadyPresent,
      failed,
      staleRecordsRemoved,
    };
  }
}
