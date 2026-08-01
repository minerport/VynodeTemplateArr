import { createHash, randomUUID } from 'node:crypto';
import { mkdir, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { CollectionAssetReference } from '@vynode/contracts';

export interface FileCollectionAssetStoreOptions {
  directory: string;
  maxBytes?: number;
}

const assetFileName = (id: string): string =>
  createHash('sha256').update(id).digest('hex');

const decodePreview = (
  reference: CollectionAssetReference,
  maxBytes: number
): Uint8Array => {
  const prefix = `data:${reference.mimeType};base64,`;
  if (!reference.previewDataUrl.startsWith(prefix)) {
    throw new Error(`Asset "${reference.name}" has an invalid data URL.`);
  }
  const encoded = reference.previewDataUrl.slice(prefix.length);
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error(`Asset "${reference.name}" is not valid base64.`);
  }
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.byteLength !== reference.size) {
    throw new Error(`Asset "${reference.name}" size does not match its metadata.`);
  }
  if (bytes.byteLength > maxBytes) {
    throw new Error(`Asset "${reference.name}" exceeds the upload limit.`);
  }
  return new Uint8Array(bytes);
};

export class FileCollectionAssetStore {
  private readonly maxBytes: number;

  public constructor(private readonly options: FileCollectionAssetStoreOptions) {
    this.maxBytes = options.maxBytes ?? 10 * 1024 * 1024;
  }

  public async persist(reference: CollectionAssetReference): Promise<void> {
    const bytes = decodePreview(reference, this.maxBytes);
    await mkdir(this.options.directory, { recursive: true, mode: 0o700 });
    const destination = this.path(reference.id);
    const temporary = join(
      this.options.directory,
      `.${assetFileName(reference.id)}.${randomUUID()}.tmp`
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

  public async resolveAsset(
    reference: CollectionAssetReference
  ): Promise<Uint8Array> {
    const destination = this.path(reference.id);
    try {
      const details = await stat(destination);
      if (details.size !== reference.size || details.size > this.maxBytes) {
        throw new Error(
          `Stored asset "${reference.name}" size does not match its metadata.`
        );
      }
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          'code' in error &&
          error.code === 'ENOENT'
        )
      ) {
        throw error;
      }
      await this.persist(reference);
    }
    return new Uint8Array(await readFile(destination));
  }

  private path(id: string): string {
    return join(this.options.directory, assetFileName(id));
  }
}
