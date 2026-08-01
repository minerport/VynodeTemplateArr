import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { join } from 'node:path';

export interface FilePosterCacheOptions {
  directory: string;
  ttlMs?: number;
  maxBytes?: number;
  now?(): number;
}

export interface PosterCacheCleanupResult {
  deleted: number;
  retained: number;
  errors: number;
}

const fileName = (key: string): string =>
  createHash('sha256').update(key).digest('hex');

export class FilePosterCache {
  private readonly ttlMs: number;
  private readonly maxBytes: number;

  public constructor(private readonly options: FilePosterCacheOptions) {
    this.ttlMs = options.ttlMs ?? 7 * 24 * 60 * 60 * 1000;
    this.maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
  }

  public async get(key: string): Promise<Uint8Array | undefined> {
    const path = this.path(key);
    try {
      const details = await stat(path);
      if (this.now() - details.mtimeMs > this.ttlMs) {
        await rm(path, { force: true });
        return undefined;
      }
      if (details.size <= 0 || details.size > this.maxBytes) {
        await rm(path, { force: true });
        throw new Error('The cached poster has an invalid size.');
      }
      return new Uint8Array(await readFile(path));
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return undefined;
      throw error;
    }
  }

  public async put(key: string, bytes: Uint8Array): Promise<void> {
    if (!bytes.byteLength || bytes.byteLength > this.maxBytes)
      throw new Error('The poster cannot be cached because its size is invalid.');
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    const destination = this.path(key);
    const temporary = join(
      this.options.directory,
      `.${fileName(key)}.${randomUUID()}.tmp`
    );
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, destination);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  public async cleanup(): Promise<PosterCacheCleanupResult> {
    const result: PosterCacheCleanupResult = {
      deleted: 0,
      retained: 0,
      errors: 0,
    };
    let entries: string[];
    try {
      entries = await readdir(this.options.directory);
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      )
        return result;
      throw error;
    }
    await Promise.all(
      entries.map(async (entry) => {
        if (!/^[a-f0-9]{64}$/.test(entry)) {
          result.retained++;
          return;
        }
        const path = join(this.options.directory, entry);
        try {
          const details = await stat(path);
          if (
            this.now() - details.mtimeMs > this.ttlMs ||
            details.size <= 0 ||
            details.size > this.maxBytes
          ) {
            await rm(path, { force: true });
            result.deleted++;
          } else {
            result.retained++;
          }
        } catch {
          result.errors++;
        }
      })
    );
    return result;
  }

  private path(key: string): string {
    return join(this.options.directory, fileName(key));
  }

  private now(): number {
    return this.options.now?.() ?? Date.now();
  }
}
