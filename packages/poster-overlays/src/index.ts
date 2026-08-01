import { readFile, readdir } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';

import type { PosterSource } from '@vynode/contracts';

export * from './poster-cache.js';
export * from './conditions.js';
export * from './variables.js';
export * from './geometry.js';
export * from './renderer.js';
export * from './context.js';
export * from './application.js';
export * from './application-file.js';
export * from './operations.js';
export * from './editor-assets.js';
export * from './collection-renderer.js';
import type { FilePosterCache } from './poster-cache.js';

export interface PosterMediaItem {
  ratingKey: string;
  title: string;
  year?: number;
  mediaType: 'movie' | 'show';
  libraryId: string;
  libraryName: string;
  tmdbId?: number;
}

export interface RemotePosterProvider {
  poster(
    item: PosterMediaItem,
    language: string,
    signal?: AbortSignal
  ): Promise<Uint8Array | undefined>;
}

export interface PosterAcquisitionResult {
  bytes: Uint8Array;
  source: PosterSource;
  fallbackFrom?: PosterSource;
}

export interface PosterAcquisitionOptions {
  localRoot: string;
  plex: RemotePosterProvider;
  tmdb: RemotePosterProvider;
  maxBytes?: number;
}

export class CoalescingPosterProvider implements RemotePosterProvider {
  private readonly requests = new Map<
    string,
    Promise<Uint8Array | undefined>
  >();

  public constructor(private readonly provider: RemotePosterProvider) {}

  public poster(
    item: PosterMediaItem,
    language: string,
    signal?: AbortSignal
  ): Promise<Uint8Array | undefined> {
    if (signal?.aborted)
      return Promise.reject(
        new DOMException('Poster acquisition was cancelled.', 'AbortError')
      );
    const key = [
      item.mediaType,
      item.tmdbId ?? item.ratingKey,
      language.trim().toLowerCase(),
    ].join(':');
    const current = this.requests.get(key);
    if (current) return current;
    const request = this.provider.poster(item, language, signal).catch((error) => {
      this.requests.delete(key);
      throw error;
    });
    this.requests.set(key, request);
    return request;
  }

  public clear(): void {
    this.requests.clear();
  }
}

export class CachedPosterProvider implements RemotePosterProvider {
  public constructor(
    private readonly namespace: string,
    private readonly provider: RemotePosterProvider,
    private readonly cache: FilePosterCache
  ) {}

  public async poster(
    item: PosterMediaItem,
    language: string,
    signal?: AbortSignal
  ): Promise<Uint8Array | undefined> {
    if (signal?.aborted)
      throw new DOMException('Poster acquisition was cancelled.', 'AbortError');
    const key = [
      this.namespace,
      item.mediaType,
      item.libraryId,
      item.ratingKey,
      item.tmdbId ?? 'no-tmdb',
      language.trim().toLowerCase(),
    ].join(':');
    const cached = await this.cache.get(key);
    if (cached) return cached;
    const bytes = await this.provider.poster(item, language, signal);
    if (!bytes) return undefined;
    if (signal?.aborted)
      throw new DOMException('Poster acquisition was cancelled.', 'AbortError');
    await this.cache.put(key, bytes);
    return bytes;
  }
}

const sanitize = (value: string): string => {
  const cleaned = value
    .normalize('NFKC')
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
    .replace(/^[. ]+/g, '')
    .replace(/[. ]+$/g, '')
    .trim();
  return cleaned || 'Untitled';
};

export const localPosterDirectory = (
  root: string,
  item: PosterMediaItem
): string | undefined => {
  if (!item.tmdbId || !Number.isSafeInteger(item.tmdbId) || item.tmdbId <= 0)
    return undefined;
  const library = `${sanitize(item.libraryName)}-${sanitize(item.libraryId)}`;
  const year = item.year ? ` (${item.year})` : '';
  const title = `${sanitize(item.title)}${year} tmdb-${item.tmdbId}`;
  const base = resolve(root);
  const candidate = resolve(base, library, title);
  const pathFromBase = relative(base, candidate);
  if (
    pathFromBase.startsWith('..') ||
    isAbsolute(pathFromBase) ||
    candidate === base
  ) {
    throw new Error('The local poster path escapes the configured root.');
  }
  return candidate;
};

export {
  generateLocalPosterFolders,
  populateLocalPosters,
  type LocalPosterWorkspaceResult,
} from './local-poster-workspace.js';

const imageType = (bytes: Uint8Array): 'jpeg' | 'png' | 'webp' | undefined => {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return 'png';
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'webp';
  return undefined;
};

export class PosterAcquisitionService {
  private readonly maxBytes: number;

  public constructor(private readonly options: PosterAcquisitionOptions) {
    this.maxBytes = options.maxBytes ?? 25 * 1024 * 1024;
  }

  public async acquire(
    source: PosterSource,
    item: PosterMediaItem,
    language: string,
    signal?: AbortSignal
  ): Promise<PosterAcquisitionResult> {
    this.assertActive(signal);
    if (source === 'local') {
      const local = await this.local(item, signal);
      if (local) return { bytes: this.validate(local), source: 'local' };
      const fallback = await this.options.tmdb.poster(item, language, signal);
      if (!fallback)
        throw new Error(
          `No local or TMDB poster is available for "${item.title}".`
        );
      return {
        bytes: this.validate(fallback),
        source: 'tmdb',
        fallbackFrom: 'local',
      };
    }
    const bytes = await this.options[source].poster(item, language, signal);
    if (!bytes)
      throw new Error(
        `No ${source.toUpperCase()} poster is available for "${item.title}".`
      );
    return { bytes: this.validate(bytes), source };
  }

  private async local(
    item: PosterMediaItem,
    signal?: AbortSignal
  ): Promise<Uint8Array | undefined> {
    const directory = localPosterDirectory(this.options.localRoot, item);
    if (!directory) return undefined;
    let files: string[];
    try {
      files = await readdir(directory);
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return undefined;
      throw error;
    }
    this.assertActive(signal);
    const supported = files
      .filter((file) => /\.(?:jpe?g|png|webp)$/i.test(file))
      .sort((left, right) => {
        const preferred = (name: string) =>
          /^poster\.(?:jpe?g|png|webp)$/i.test(name) ? 0 : 1;
        return preferred(left) - preferred(right) || left.localeCompare(right);
      });
    if (!supported[0]) return undefined;
    return new Uint8Array(await readFile(join(directory, supported[0])));
  }

  private validate(bytes: Uint8Array): Uint8Array {
    if (!bytes.byteLength) throw new Error('The poster file is empty.');
    if (bytes.byteLength > this.maxBytes)
      throw new Error('The poster file exceeds the size limit.');
    if (!imageType(bytes))
      throw new Error('The poster is not a supported JPEG, PNG, or WebP image.');
    return bytes;
  }

  private assertActive(signal?: AbortSignal): void {
    if (signal?.aborted)
      throw new DOMException('Poster acquisition was cancelled.', 'AbortError');
  }
}
