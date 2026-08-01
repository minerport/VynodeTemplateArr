import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

import type {
  PlexSynchronizationCheckpointRepository,
  PlexSynchronizationCheckpointState,
} from './plex-production.js';

const empty = (): PlexSynchronizationCheckpointState => ({
  itemFingerprints: {},
});

const parse = (value: string): PlexSynchronizationCheckpointState => {
  const parsed = JSON.parse(value) as Partial<PlexSynchronizationCheckpointState>;
  if (
    !parsed.itemFingerprints ||
    typeof parsed.itemFingerprints !== 'object' ||
    Array.isArray(parsed.itemFingerprints) ||
    Object.values(parsed.itemFingerprints).some(
      (fingerprint) => typeof fingerprint !== 'string'
    ) ||
    (parsed.orderFingerprint !== undefined &&
      typeof parsed.orderFingerprint !== 'string')
  ) {
    throw new Error('The Plex synchronization checkpoint file is corrupt.');
  }
  return {
    itemFingerprints: parsed.itemFingerprints as Record<string, string>,
    ...(parsed.orderFingerprint
      ? { orderFingerprint: parsed.orderFingerprint }
      : {}),
  };
};

export class FilePlexSynchronizationCheckpointRepository
  implements PlexSynchronizationCheckpointRepository
{
  public constructor(private readonly path: string) {}

  public async get(): Promise<PlexSynchronizationCheckpointState> {
    try {
      return parse(await readFile(this.path, 'utf8'));
    } catch (error) {
      if (
        error instanceof Error &&
        'code' in error &&
        error.code === 'ENOENT'
      ) {
        return empty();
      }
      throw error;
    }
  }

  public async save(state: PlexSynchronizationCheckpointState): Promise<void> {
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
}
