import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
} from 'node:fs/promises';
import { join } from 'node:path';

import {
  OverlayApplicationService,
  type OverlayApplicationServiceOptions,
  OverlayApplicationState,
  OverlayApplicationStateRepository,
  OverlayBasePosterStore,
} from './application.js';

export interface FileOverlayStoreOptions {
  directory: string;
  maxPosterBytes?: number;
  maxStateBytes?: number;
}

const fileName = (key: string): string =>
  createHash('sha256').update(key).digest('hex');

const missing = (error: unknown): boolean =>
  error instanceof Error && 'code' in error && error.code === 'ENOENT';

const atomicWrite = async (
  directory: string,
  destination: string,
  bytes: Uint8Array
): Promise<void> => {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = join(
    directory,
    `.${fileName(destination)}.${randomUUID()}.tmp`
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
};

export class FileOverlayBasePosterStore implements OverlayBasePosterStore {
  private readonly maxPosterBytes: number;

  public constructor(private readonly options: FileOverlayStoreOptions) {
    this.maxPosterBytes = options.maxPosterBytes ?? 25 * 1024 * 1024;
  }

  public async get(key: string): Promise<Uint8Array | undefined> {
    const path = this.path(key);
    try {
      const details = await stat(path);
      if (details.size <= 0 || details.size > this.maxPosterBytes)
        throw new Error('The preserved base poster has an invalid size.');
      return new Uint8Array(await readFile(path));
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }

  public async put(key: string, bytes: Uint8Array): Promise<void> {
    if (!bytes.byteLength || bytes.byteLength > this.maxPosterBytes)
      throw new Error('The base poster cannot be preserved because its size is invalid.');
    await atomicWrite(this.options.directory, this.path(key), bytes);
  }

  public delete(key: string): Promise<void> {
    return rm(this.path(key), { force: true });
  }

  private path(key: string): string {
    return join(this.options.directory, fileName(key));
  }
}

const validState = (
  value: unknown,
  expectedRatingKey: string
): value is OverlayApplicationState => {
  if (typeof value !== 'object' || value === null) return false;
  const state = value as Record<string, unknown>;
  return (
    state.ratingKey === expectedRatingKey &&
    typeof state.basePosterKey === 'string' &&
    state.basePosterKey.length > 0 &&
    state.basePosterKey.length <= 512 &&
    typeof state.basePosterHash === 'string' &&
    /^[a-f0-9]{64}$/.test(state.basePosterHash) &&
    (state.lastAppliedHash === undefined ||
      (typeof state.lastAppliedHash === 'string' &&
        /^[a-f0-9]{64}$/.test(state.lastAppliedHash))) &&
    Array.isArray(state.appliedTemplateIds) &&
    state.appliedTemplateIds.length <= 500 &&
    state.appliedTemplateIds.every(
      (id) => typeof id === 'string' && id.length > 0 && id.length <= 256
    ) &&
    typeof state.updatedAt === 'string' &&
    !Number.isNaN(new Date(state.updatedAt).valueOf())
  );
};

export class FileOverlayApplicationStateRepository
  implements OverlayApplicationStateRepository
{
  private readonly maxStateBytes: number;

  public constructor(private readonly options: FileOverlayStoreOptions) {
    this.maxStateBytes = options.maxStateBytes ?? 256 * 1024;
  }

  public async get(
    ratingKey: string
  ): Promise<OverlayApplicationState | undefined> {
    const path = this.path(ratingKey);
    try {
      const details = await stat(path);
      if (details.size <= 0 || details.size > this.maxStateBytes)
        throw new Error('The poster application state has an invalid size.');
      let parsed: unknown;
      try {
        parsed = JSON.parse(await readFile(path, 'utf8')) as unknown;
      } catch {
        throw new Error('The poster application state is corrupt.');
      }
      if (!validState(parsed, ratingKey))
        throw new Error('The poster application state is invalid.');
      return parsed;
    } catch (error) {
      if (missing(error)) return undefined;
      throw error;
    }
  }

  public async put(state: OverlayApplicationState): Promise<void> {
    if (!validState(state, state.ratingKey))
      throw new Error('The poster application state is invalid.');
    const bytes = new TextEncoder().encode(`${JSON.stringify(state, null, 2)}\n`);
    if (bytes.byteLength > this.maxStateBytes)
      throw new Error('The poster application state exceeds the size limit.');
    await atomicWrite(this.options.directory, this.path(state.ratingKey), bytes);
  }

  public delete(ratingKey: string): Promise<void> {
    return rm(this.path(ratingKey), { force: true });
  }

  private path(ratingKey: string): string {
    return join(this.options.directory, `${fileName(ratingKey)}.json`);
  }
}

export const createFileBackedOverlayApplication = (
  dataDirectory: string,
  options: Omit<OverlayApplicationServiceOptions, 'bases' | 'states'>
): OverlayApplicationService =>
  new OverlayApplicationService({
    ...options,
    bases: new FileOverlayBasePosterStore({
      directory: join(dataDirectory, 'base-posters'),
    }),
    states: new FileOverlayApplicationStateRepository({
      directory: join(dataDirectory, 'application-state'),
    }),
  });
