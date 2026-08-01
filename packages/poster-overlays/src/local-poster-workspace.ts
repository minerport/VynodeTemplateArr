import { mkdir, readdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { localPosterDirectory, type PosterMediaItem } from './index.js';

export interface LocalPosterWorkspaceResult {
  scanned: number;
  created: number;
  skippedExisting: number;
  skippedMissingTmdb: number;
  failed: number;
}

const emptyResult = (): LocalPosterWorkspaceResult => ({
  scanned: 0,
  created: 0,
  skippedExisting: 0,
  skippedMissingTmdb: 0,
  failed: 0,
});

const imageExtension = (bytes: Uint8Array): 'jpg' | 'png' | 'webp' | undefined => {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47)
    return 'png';
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'webp';
  return undefined;
};

const hasLocalImage = async (directory: string): Promise<boolean> => {
  try {
    return (await readdir(directory)).some((name) => /\.(?:jpe?g|png|webp)$/i.test(name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
};

export const generateLocalPosterFolders = async (
  root: string,
  items: readonly PosterMediaItem[],
  signal?: AbortSignal
): Promise<LocalPosterWorkspaceResult> => {
  const result = emptyResult();
  for (const item of items) {
    signal?.throwIfAborted();
    result.scanned += 1;
    const directory = localPosterDirectory(root, item);
    if (!directory) {
      result.skippedMissingTmdb += 1;
      continue;
    }
    try {
      const created = await mkdir(directory, { recursive: true });
      if (created === undefined) result.skippedExisting += 1;
      else result.created += 1;
    } catch {
      result.failed += 1;
    }
  }
  return result;
};

export const populateLocalPosters = async (
  root: string,
  items: readonly PosterMediaItem[],
  poster: (item: PosterMediaItem, signal?: AbortSignal) => Promise<Uint8Array>,
  signal?: AbortSignal
): Promise<LocalPosterWorkspaceResult> => {
  const result = emptyResult();
  for (const item of items) {
    signal?.throwIfAborted();
    result.scanned += 1;
    const directory = localPosterDirectory(root, item);
    if (!directory) {
      result.skippedMissingTmdb += 1;
      continue;
    }
    try {
      await mkdir(directory, { recursive: true });
      if (await hasLocalImage(directory)) {
        result.skippedExisting += 1;
        continue;
      }
      const bytes = await poster(item, signal);
      signal?.throwIfAborted();
      const extension = imageExtension(bytes);
      if (!extension) throw new Error('Plex returned an unsupported poster image.');
      await writeFile(join(directory, `poster.${extension}`), bytes, { flag: 'wx', mode: 0o600 });
      result.created += 1;
    } catch (error) {
      if (signal?.aborted) throw error;
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') result.skippedExisting += 1;
      else result.failed += 1;
    }
  }
  return result;
};
