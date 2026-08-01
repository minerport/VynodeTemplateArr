import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { PosterEditorAsset } from '@vynode/contracts';

const supportedMimeTypes = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/svg+xml',
  'font/ttf',
  'font/otf',
  'font/woff',
  'font/woff2',
] as const;

const imageMimeType = (bytes: Uint8Array): PosterEditorAsset['mimeType'] | undefined => {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff)
    return 'image/jpeg';
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  )
    return 'image/png';
  if (
    String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP'
  )
    return 'image/webp';
  return undefined;
};

const validateSvg = (bytes: Uint8Array): void => {
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (!/<svg(?:\s|>)/i.test(source))
    throw new Error('The uploaded SVG does not contain an SVG root element.');
  if (
    /<(?:script|foreignObject|iframe|object|embed)\b/i.test(source) ||
    /\son[a-z]+\s*=/i.test(source) ||
    /(?:href|src)\s*=\s*["']\s*(?:https?:|data:|javascript:|\/\/)/i.test(source) ||
    /url\(\s*["']?\s*(?:https?:|data:|javascript:|\/\/)/i.test(source) ||
    /<!DOCTYPE|<!ENTITY/i.test(source)
  )
    throw new Error('The uploaded SVG contains unsafe active or external content.');
};

const safeName = (name: string): string => {
  const normalized = name
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f/\\<>:"|?*]/g, '')
    .replace(/^[. ]+/, '')
    .trim();
  if (!normalized) throw new Error('The asset filename is invalid.');
  return normalized.slice(0, 160);
};

export interface FilePosterEditorAssetStoreOptions {
  directory: string;
  maxBytes?: number;
}

export class FilePosterEditorAssetStore {
  private readonly maxBytes: number;
  private readonly indexPath: string;
  private mutation = Promise.resolve();

  public constructor(private readonly options: FilePosterEditorAssetStoreOptions) {
    this.maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
    this.indexPath = join(options.directory, 'index.json');
  }

  public async list(): Promise<readonly PosterEditorAsset[]> {
    try {
      const parsed = JSON.parse(await readFile(this.indexPath, 'utf8')) as unknown;
      if (!Array.isArray(parsed)) throw new Error('Asset index is not an array.');
      const assets = parsed.filter(this.isAsset);
      if (assets.length !== parsed.length)
        throw new Error('Asset index contains invalid records.');
      return assets.sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
        return [];
      throw new Error('The poster asset index is corrupt.', { cause: error });
    }
  }

  public async save(input: {
    name: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<PosterEditorAsset> {
    const operation = this.mutation.then(() => this.saveInternal(input));
    this.mutation = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private async saveInternal(input: {
    name: string;
    mimeType: string;
    bytes: Uint8Array;
  }): Promise<PosterEditorAsset> {
    const name = safeName(input.name);
    if (
      !supportedMimeTypes.includes(
        input.mimeType as (typeof supportedMimeTypes)[number]
      )
    )
      throw new Error('Only JPEG, PNG, WebP, SVG, TTF, OTF, WOFF, and WOFF2 poster assets are supported.');
    if (!input.bytes.byteLength)
      throw new Error('The uploaded poster asset is empty.');
    if (input.bytes.byteLength > this.maxBytes)
      throw new Error('The uploaded poster asset exceeds the 10 MB limit.');
    const kind = input.mimeType.startsWith('font/') ? 'font' : input.mimeType === 'image/svg+xml' ? 'svg' : 'raster';
    if (kind === 'svg') validateSvg(input.bytes);
    else if (kind === 'font') {
      const header = String.fromCharCode(...input.bytes.slice(0, 4));
      const valid = header === 'OTTO' || header === 'wOFF' || header === 'wOF2' || (input.bytes[0] === 0 && input.bytes[1] === 1 && input.bytes[2] === 0 && input.bytes[3] === 0);
      if (!valid) throw new Error('The font contents do not match a supported TTF, OTF, WOFF, or WOFF2 file.');
    } else if (imageMimeType(input.bytes) !== input.mimeType)
      throw new Error('The poster asset contents do not match its declared image type.');

    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    const asset: PosterEditorAsset = {
      id: randomUUID(),
      name,
      mimeType: input.mimeType as PosterEditorAsset['mimeType'],
      size: input.bytes.byteLength,
      kind,
      createdAt: new Date().toISOString(),
    };
    const destination = this.assetPath(asset.id);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(input.bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
    try {
      await this.writeIndex([...(await this.list()), asset]);
    } catch (error) {
      await rm(destination, { force: true });
      throw error;
    }
    return asset;
  }

  public async read(id: string): Promise<{
    asset: PosterEditorAsset;
    bytes: Uint8Array;
  } | undefined> {
    const asset = (await this.list()).find((item) => item.id === id);
    if (!asset) return undefined;
    const path = this.assetPath(id);
    const details = await stat(path).catch(() => undefined);
    if (!details || details.size !== asset.size || details.size > this.maxBytes)
      throw new Error(`Stored poster asset "${asset.name}" is missing or corrupt.`);
    return { asset, bytes: new Uint8Array(await readFile(path)) };
  }

  public async delete(id: string): Promise<boolean> {
    const operation = this.mutation.then(async () => {
      const assets = await this.list();
      if (!assets.some((asset) => asset.id === id)) return false;
      await this.writeIndex(assets.filter((asset) => asset.id !== id));
      await rm(this.assetPath(id), { force: true });
      return true;
    });
    this.mutation = operation.then(
      () => undefined,
      () => undefined
    );
    return operation;
  }

  private async writeIndex(assets: readonly PosterEditorAsset[]): Promise<void> {
    const temporary = join(
      this.options.directory,
      `.index.${randomUUID()}.tmp`
    );
    const handle = await open(temporary, 'wx', 0o600);
    try {
      await handle.writeFile(JSON.stringify(assets, null, 2), 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    try {
      await rename(temporary, this.indexPath);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }

  private assetPath(id: string): string {
    return join(
      this.options.directory,
      createHash('sha256').update(id).digest('hex')
    );
  }

  private readonly isAsset = (value: unknown): value is PosterEditorAsset => {
    if (!value || typeof value !== 'object') return false;
    const asset = value as PosterEditorAsset;
    return (
      typeof asset.id === 'string' &&
      /^[0-9a-f-]{36}$/i.test(asset.id) &&
      typeof asset.name === 'string' &&
      supportedMimeTypes.includes(asset.mimeType) &&
      Number.isInteger(asset.size) &&
      asset.size > 0 &&
      asset.size <= this.maxBytes &&
      asset.kind === (asset.mimeType.startsWith('font/') ? 'font' : asset.mimeType === 'image/svg+xml' ? 'svg' : 'raster') &&
      typeof asset.createdAt === 'string' &&
      Number.isFinite(Date.parse(asset.createdAt))
    );
  };
}
