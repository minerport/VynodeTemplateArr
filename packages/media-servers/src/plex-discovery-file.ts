import { randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  type FileHandle,
} from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  PlexDiscoveryRepository,
  PlexDiscoveryStoreState,
} from './plex-discovery.js';

const emptyState = (): PlexDiscoveryStoreState => ({
  revision: 0,
  items: [],
  warnings: [],
});

const parseState = (value: string): PlexDiscoveryStoreState => {
  const parsed = JSON.parse(value) as Partial<PlexDiscoveryStoreState>;
  if (
    !Number.isInteger(parsed.revision) ||
    (parsed.revision ?? -1) < 0 ||
    !Array.isArray(parsed.items) ||
    !Array.isArray(parsed.warnings) ||
    parsed.warnings.some((warning) => typeof warning !== 'string') ||
    parsed.items.some(
      (item) =>
        !item ||
        typeof item.id !== 'string' ||
        !['default-hub', 'pre-existing-collection'].includes(item.kind) ||
        typeof item.libraryId !== 'string' ||
        typeof item.plexKey !== 'string'
    )
  ) {
    throw new Error('The Plex discovery repository contains invalid data.');
  }
  return parsed as PlexDiscoveryStoreState;
};

export interface FilePlexDiscoveryRepositoryOptions {
  path: string;
  lockRetryMs?: number;
  lockTimeoutMs?: number;
  staleLockMs?: number;
}

export class FilePlexDiscoveryRepository implements PlexDiscoveryRepository {
  private readonly lockPath: string;
  private readonly lockRetryMs: number;
  private readonly lockTimeoutMs: number;
  private readonly staleLockMs: number;

  public constructor(
    private readonly options: FilePlexDiscoveryRepositoryOptions
  ) {
    this.lockPath = `${options.path}.lock`;
    this.lockRetryMs = options.lockRetryMs ?? 25;
    this.lockTimeoutMs = options.lockTimeoutMs ?? 5_000;
    this.staleLockMs = options.staleLockMs ?? 30_000;
  }

  public async get(): Promise<PlexDiscoveryStoreState> {
    try {
      return parseState(await readFile(this.options.path, 'utf8'));
    } catch (error) {
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return emptyState();
      }
      throw error;
    }
  }

  public async compareAndSet(
    expectedRevision: number,
    next: PlexDiscoveryStoreState
  ): Promise<boolean> {
    return this.withLock(async () => {
      const current = await this.get();
      if (current.revision !== expectedRevision) return false;
      if (next.revision !== expectedRevision + 1) {
        throw new Error(
          'The next Plex discovery revision must increment exactly once.'
        );
      }
      const directory = dirname(this.options.path);
      await mkdir(directory, { recursive: true });
      const temporaryPath = `${this.options.path}.${randomUUID()}.tmp`;
      try {
        const handle = await open(temporaryPath, 'wx', 0o600);
        try {
          await handle.writeFile(`${JSON.stringify(next, null, 2)}\n`, 'utf8');
          await handle.sync();
        } finally {
          await handle.close();
        }
        await rename(temporaryPath, this.options.path);
      } finally {
        await rm(temporaryPath, { force: true });
      }
      return true;
    });
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    await mkdir(dirname(this.options.path), { recursive: true });
    const startedAt = Date.now();
    let lock: FileHandle | undefined;
    while (!lock) {
      try {
        lock = await open(this.lockPath, 'wx', 0o600);
      } catch (error) {
        if (
          !error ||
          typeof error !== 'object' ||
          !('code' in error) ||
          error.code !== 'EEXIST'
        ) {
          throw error;
        }
        try {
          const lockState = await stat(this.lockPath);
          if (Date.now() - lockState.mtimeMs > this.staleLockMs) {
            await rm(this.lockPath, { force: true });
            continue;
          }
        } catch (lockError) {
          if (
            !lockError ||
            typeof lockError !== 'object' ||
            !('code' in lockError) ||
            lockError.code !== 'ENOENT'
          ) {
            throw lockError;
          }
          continue;
        }
        if (Date.now() - startedAt >= this.lockTimeoutMs) {
          throw new Error(
            'Timed out waiting for the Plex discovery repository lock.'
          );
        }
        await new Promise((resolve) => setTimeout(resolve, this.lockRetryMs));
      }
    }
    try {
      return await operation();
    } finally {
      await lock.close();
      await rm(this.lockPath, { force: true });
    }
  }
}
