import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';

export type PlaceholderMediaType = 'movie' | 'show';

export interface PlaceholderCandidate {
  key: string;
  mediaType: PlaceholderMediaType;
  title: string;
  year?: number;
  releaseDate?: string;
  tmdbId?: number;
  tvdbId?: number;
}

export interface PlaceholderInventoryRecord extends PlaceholderCandidate {
  id: string;
  libraryId: string;
  mediaPath: string;
  sidecarPath: string;
  createdAt: string;
  lastSeenAt: string;
  state: 'created' | 'indexed' | 'cleanup-pending' | 'error';
  plexRatingKey?: string;
  errorMessage?: string;
}

export interface PlaceholderInventory {
  revision: number;
  records: readonly PlaceholderInventoryRecord[];
}

export interface PlaceholderInventoryRepository {
  get(): Promise<PlaceholderInventory>;
  compareAndSet(
    expectedRevision: number,
    next: PlaceholderInventory
  ): Promise<boolean>;
}

export interface PlaceholderMediaWriter {
  create(
    root: string,
    candidate: PlaceholderCandidate,
    signal?: AbortSignal
  ): Promise<{ mediaPath: string; sidecarPath: string }>;
  remove(
    root: string,
    record: PlaceholderInventoryRecord,
    signal?: AbortSignal
  ): Promise<void>;
}

export interface PlaceholderPlexIndexer {
  refreshLibrary(libraryId: string, signal?: AbortSignal): Promise<void>;
  findByMediaPath(
    libraryId: string,
    mediaPath: string,
    signal?: AbortSignal
  ): Promise<{ ratingKey: string } | undefined>;
  addLabels(
    ratingKey: string,
    labels: readonly string[],
    signal?: AbortSignal
  ): Promise<void>;
}

export interface PlaceholderLifecycleInput {
  libraryId: string;
  libraryRoot: string;
  candidates: readonly PlaceholderCandidate[];
  availableKeys: ReadonlySet<string>;
  daysAhead: number;
  includeAllReleasedItems: boolean;
  releasedRetentionDays: number;
}

export interface PlaceholderLifecycleReport {
  created: number;
  indexed: number;
  removed: number;
  retained: number;
  skipped: number;
  failed: number;
  failures: readonly string[];
  indexedItems: readonly {
    key: string;
    mediaType: PlaceholderMediaType;
    ratingKey: string;
  }[];
}

const abortIfRequested = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
};

const safeSegment = (value: string): string => {
  const normalized = value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  return normalized.slice(0, 120) || 'Untitled';
};

const providerSuffix = (candidate: PlaceholderCandidate): string =>
  candidate.tmdbId
    ? ` {tmdb-${candidate.tmdbId}}`
    : candidate.tvdbId
      ? ` {tvdb-${candidate.tvdbId}}`
      : '';

const identityFor = (candidate: PlaceholderCandidate): string =>
  candidate.tmdbId
    ? `movie:tmdb:${candidate.tmdbId}`
    : candidate.tvdbId
      ? `show:tvdb:${candidate.tvdbId}`
      : candidate.key;

const parseReleaseDate = (value?: string): Date | undefined => {
  if (!value) return undefined;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? undefined : parsed;
};

const isEligible = (
  candidate: PlaceholderCandidate,
  now: Date,
  daysAhead: number,
  includeAllReleasedItems: boolean
): boolean => {
  const release = parseReleaseDate(candidate.releaseDate);
  if (!release) return true;
  const differenceDays =
    (release.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  if (differenceDays < 0) return includeAllReleasedItems;
  return differenceDays <= daysAhead;
};

const within = (root: string, candidate: string): boolean => {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return (
    relative === '' ||
    (!relative.startsWith('..') && !path.isAbsolute(relative))
  );
};

export class GenericPlaceholderMediaWriter implements PlaceholderMediaWriter {
  public constructor(
    private readonly genericMedia: Uint8Array,
    private readonly source?: {
      media(
        candidate: PlaceholderCandidate,
        signal?: AbortSignal
      ): Promise<Uint8Array>;
    }
  ) {
    if (genericMedia.byteLength === 0)
      throw new Error('Generic placeholder media cannot be empty.');
  }

  public async create(
    root: string,
    candidate: PlaceholderCandidate,
    signal?: AbortSignal
  ): Promise<{ mediaPath: string; sidecarPath: string }> {
    abortIfRequested(signal);
    const title = safeSegment(candidate.title);
    const year = candidate.year ? ` (${candidate.year})` : '';
    const directory =
      candidate.mediaType === 'movie'
        ? path.join(root, 'Vynode Placeholders', `${title}${year}`)
        : path.join(
            root,
            'Vynode Placeholders',
            `${title}${year}${candidate.tvdbId ? ` {tvdb-${candidate.tvdbId}}` : ''}`,
            'Season 01'
          );
    const base =
      candidate.mediaType === 'movie'
        ? `${title}${year}${providerSuffix(candidate)} - Trailer (Placeholder)`
        : `${title} - S01E01 - Placeholder`;
    const mediaPath = path.join(directory, `${base}.mp4`);
    const sidecarPath = path.join(directory, `${base}.vynode-placeholder.json`);
    if (!within(root, mediaPath) || !within(root, sidecarPath))
      throw new Error('Placeholder path escaped the configured library root.');
    await mkdir(directory, { recursive: true });
    abortIfRequested(signal);
    const media = this.source
      ? await this.source.media(candidate, signal)
      : this.genericMedia;
    await writeFile(mediaPath, media, { flag: 'wx' }).catch(
      async (error: NodeJS.ErrnoException) => {
        if (error.code !== 'EEXIST') throw error;
        const existing = await stat(mediaPath);
        if (existing.size !== media.byteLength)
          throw new Error(
            'An unrelated file already occupies the placeholder media path.'
          );
      }
    );
    await writeFile(
      sidecarPath,
      `${JSON.stringify(
        {
          marker: 'vynode-placeholder',
          key: candidate.key,
          mediaType: candidate.mediaType,
          title: candidate.title,
          year: candidate.year,
          releaseDate: candidate.releaseDate,
          tmdbId: candidate.tmdbId,
          tvdbId: candidate.tvdbId,
        },
        null,
        2
      )}\n`,
      { encoding: 'utf8', mode: 0o600 }
    );
    return { mediaPath, sidecarPath };
  }

  public async remove(
    root: string,
    record: PlaceholderInventoryRecord,
    signal?: AbortSignal
  ): Promise<void> {
    abortIfRequested(signal);
    if (
      !within(root, record.mediaPath) ||
      !within(root, record.sidecarPath) ||
      !record.mediaPath.includes(`${path.sep}Vynode Placeholders${path.sep}`)
    )
      throw new Error('Refusing to remove an unmanaged placeholder path.');
    await rm(record.mediaPath, { force: true });
    await rm(record.sidecarPath, { force: true });
    const seasonDirectory = path.dirname(record.mediaPath);
    await rm(seasonDirectory, { recursive: false }).catch(() => undefined);
    if (record.mediaType === 'show') {
      await rm(path.dirname(seasonDirectory), { recursive: false }).catch(
        () => undefined
      );
    }
  }
}

export class FilePlaceholderInventoryRepository
  implements PlaceholderInventoryRepository
{
  public constructor(private readonly filePath: string) {}

  public async get(): Promise<PlaceholderInventory> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, 'utf8')) as
        | PlaceholderInventory
        | undefined;
      if (
        !parsed ||
        !Number.isSafeInteger(parsed.revision) ||
        !Array.isArray(parsed.records)
      )
        throw new Error('Placeholder inventory is malformed.');
      return parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        return { revision: 0, records: [] };
      throw error;
    }
  }

  public async compareAndSet(
    expectedRevision: number,
    next: PlaceholderInventory
  ): Promise<boolean> {
    const current = await this.get();
    if (current.revision !== expectedRevision) return false;
    await mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });
    await rename(temporary, this.filePath);
    return true;
  }
}

export class PlaceholderLifecycleCoordinator {
  public constructor(
    private readonly repository: PlaceholderInventoryRepository,
    private readonly media: PlaceholderMediaWriter,
    private readonly plex: PlaceholderPlexIndexer,
    private readonly now: () => Date = () => new Date()
  ) {}

  public async synchronize(
    input: PlaceholderLifecycleInput,
    signal?: AbortSignal
  ): Promise<PlaceholderLifecycleReport> {
    if (input.daysAhead < 1 || input.daysAhead > 730)
      throw new Error('Placeholder days ahead must be between 1 and 730.');
    if (input.releasedRetentionDays < 1 || input.releasedRetentionDays > 30)
      throw new Error('Placeholder retention must be between 1 and 30 days.');
    abortIfRequested(signal);
    const now = this.now();
    const timestamp = now.toISOString();
    const current = await this.repository.get();
    const records = [...current.records];
    const failures: string[] = [];
    let created = 0;
    let indexed = 0;
    let removed = 0;
    let skipped = 0;
    let needsScan = false;
    const candidates = new Map(
      input.candidates.map((candidate) => [identityFor(candidate), candidate])
    );

    for (const candidate of input.candidates) {
      abortIfRequested(signal);
      const identity = identityFor(candidate);
      if (
        input.availableKeys.has(identity) ||
        !isEligible(
          candidate,
          now,
          input.daysAhead,
          input.includeAllReleasedItems
        )
      ) {
        skipped += 1;
        continue;
      }
      const existing = records.find(
        (record) =>
          record.libraryId === input.libraryId &&
          identityFor(record) === identity
      );
      if (existing) {
        existing.lastSeenAt = timestamp;
        continue;
      }
      try {
        const paths = await this.media.create(
          input.libraryRoot,
          candidate,
          signal
        );
        records.push({
          ...candidate,
          ...paths,
          id: createHash('sha256')
            .update(`${input.libraryId}:${identity}`)
            .digest('hex')
            .slice(0, 24),
          libraryId: input.libraryId,
          createdAt: timestamp,
          lastSeenAt: timestamp,
          state: 'created',
        });
        created += 1;
        needsScan = true;
      } catch (error) {
        failures.push(
          `${candidate.title}: ${
            error instanceof Error ? error.message : 'creation failed'
          }`
        );
      }
    }

    const retentionMs =
      input.releasedRetentionDays * 24 * 60 * 60 * 1000;
    for (let index = records.length - 1; index >= 0; index -= 1) {
      abortIfRequested(signal);
      const record = records[index]!;
      if (record.libraryId !== input.libraryId) continue;
      const identity = identityFor(record);
      const sourceMissing = !candidates.has(identity);
      const sourceStale =
        sourceMissing &&
        now.getTime() - new Date(record.lastSeenAt).getTime() >= retentionMs;
      if (!input.availableKeys.has(identity) && !sourceStale) continue;
      try {
        await this.media.remove(input.libraryRoot, record, signal);
        records.splice(index, 1);
        removed += 1;
        needsScan = true;
      } catch (error) {
        record.state = 'cleanup-pending';
        record.errorMessage =
          error instanceof Error ? error.message : 'cleanup failed';
        failures.push(`${record.title}: ${record.errorMessage}`);
      }
    }

    if (needsScan) {
      try {
        await this.plex.refreshLibrary(input.libraryId, signal);
      } catch (error) {
        failures.push(
          `Plex library refresh failed: ${
            error instanceof Error ? error.message : 'unknown error'
          }`
        );
      }
    }

    for (const record of records) {
      if (
        record.libraryId !== input.libraryId ||
        record.state === 'indexed' ||
        record.state === 'cleanup-pending'
      )
        continue;
      try {
        const plexItem = await this.plex.findByMediaPath(
          input.libraryId,
          record.mediaPath,
          signal
        );
        if (!plexItem) continue;
        await this.plex.addLabels(
          plexItem.ratingKey,
          ['trailer-placeholder', 'vynode-placeholder'],
          signal
        );
        record.plexRatingKey = plexItem.ratingKey;
        record.state = 'indexed';
        delete record.errorMessage;
        indexed += 1;
      } catch (error) {
        record.state = 'error';
        record.errorMessage =
          error instanceof Error ? error.message : 'Plex labeling failed';
        failures.push(`${record.title}: ${record.errorMessage}`);
      }
    }

    const next = {
      revision: current.revision + 1,
      records,
    };
    if (!(await this.repository.compareAndSet(current.revision, next)))
      throw new Error(
        'Placeholder inventory changed concurrently; retry synchronization.'
      );
    return {
      created,
      indexed,
      removed,
      retained: records.filter(
        (record) => record.libraryId === input.libraryId
      ).length,
      skipped,
      failed: failures.length,
      failures,
      indexedItems: records
        .filter(
          (
            record
          ): record is PlaceholderInventoryRecord & {
            plexRatingKey: string;
          } =>
            record.libraryId === input.libraryId &&
            record.state === 'indexed' &&
            Boolean(record.plexRatingKey)
        )
        .map((record) => ({
          key: identityFor(record),
          mediaType: record.mediaType,
          ratingKey: record.plexRatingKey,
        })),
    };
  }
}
