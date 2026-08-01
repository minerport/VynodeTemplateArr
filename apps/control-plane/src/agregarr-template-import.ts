import { basename, extname, posix } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';

import type {
  CollectionPosterDesign,
  CollectionPosterLayer,
  OverlayApplicationCondition,
  OverlayLayer,
} from '@vynode/contracts';
import sharp from 'sharp';
import yauzl, { type Entry, type ZipFile } from 'yauzl';

const MAX_ARCHIVE_BYTES = 50 * 1024 * 1024;
const MAX_TEMPLATE_BYTES = 2 * 1024 * 1024;
const MAX_ASSET_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 100 * 1024 * 1024;
const MAX_ENTRIES = 256;
const PLAIN_IMDB_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="#F5C518"><path d="M8.4 21.1H5.9V9.9h3.8l.7 4.7h.1l.5-4.7h3.8v11.2h-2.5v-6.7h-.1l-.9 6.7H9.4l-1-6.7v6.7ZM15.8 9.8c.4 0 3.2-.1 4.7.1 1.2.1 1.8 1.1 1.9 2.3.1 2.2.1 4.4.1 6.6 0 .2 0 .5-.1.8-.2.9-.7 1.4-1.9 1.5-1.5.1-3 .1-4.4.1h-.2V9.8Zm3 2.1v7.2c.5 0 .8-.2.8-.7v-5.9c0-.5-.2-.7-.8-.6ZM2 21.1V9.9h2.9v11.2H2ZM29.9 14.1c-.1-.8-.6-1.2-1.4-1.4-.8-.1-1.6 0-2.3.7V9.9h-2.8v11.2H26l.2-.5h.1l.3.3c.7.5 1.5.6 2.3.3.7-.3 1-.9 1-1.6.1-.8.1-1.7.1-2.6 0-1 0-2-.1-2.9Zm-2.8 5c0 .2-.2.4-.4.4s-.4-.2-.4-.4v-4.3c0-.2.2-.4.4-.4s.4.2.4.4v4.3Z"/></svg>`;
const AGREGARR_SYSTEM_ASSETS = new Map<
  string,
  { name: string; mimeType: AgregarrArchiveAsset['mimeType']; source: string }
>([
  [
    'plain-imdb.svg',
    {
      name: 'plain-imdb.svg',
      mimeType: 'image/svg+xml',
      source: PLAIN_IMDB_SVG,
    },
  ],
]);

export type AgregarrTemplateKind = 'collection-poster' | 'overlay';
export interface AgregarrArchiveAsset {
  archivePath: string;
  name: string;
  mimeType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/svg+xml';
  bytes: Uint8Array;
}
export interface AgregarrAssetCrop {
  sourceWidth: number;
  sourceHeight: number;
  left: number;
  top: number;
  width: number;
  height: number;
}
export interface NormalizedAgregarrAsset {
  asset: AgregarrArchiveAsset;
  crop?: AgregarrAssetCrop;
}
export interface AgregarrArchive {
  kind: AgregarrTemplateKind;
  name: string;
  description: string;
  type?: string;
  version: string;
  templateData: unknown;
  applicationCondition?: unknown;
  assets: readonly AgregarrArchiveAsset[];
  warnings: readonly string[];
}

const asRecord = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
const text = (value: unknown, fallback = ''): string =>
  typeof value === 'string' ? value : fallback;
const finite = (value: unknown, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback;
const color = (value: unknown, fallback: string): string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value)
    ? value.toLowerCase()
    : fallback;

const safeArchivePath = (value: string): string => {
  const normalized = value.replaceAll('\\', '/');
  if (
    normalized.includes('\0') ||
    normalized.startsWith('/') ||
    /^[a-z]:/i.test(normalized) ||
    normalized.split('/').includes('..') ||
    posix.normalize(normalized) !== normalized
  )
    throw new Error(`Archive entry "${value}" has an unsafe path.`);
  return normalized;
};

const mimeTypeFor = (
  name: string
): AgregarrArchiveAsset['mimeType'] | undefined => {
  switch (extname(name).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.svg':
      return 'image/svg+xml';
    default:
      return undefined;
  }
};

const openArchive = (bytes: Uint8Array): Promise<ZipFile> =>
  new Promise((resolve, reject) => {
    yauzl.fromBuffer(
      Buffer.from(bytes),
      { lazyEntries: true, decodeStrings: true, validateEntrySizes: true },
      (error, zip) => (error || !zip ? reject(error) : resolve(zip))
    );
  });

const readEntry = (zip: ZipFile, entry: Entry): Promise<Uint8Array> =>
  new Promise((resolve, reject) => {
    zip.openReadStream(entry, (error, stream) => {
      if (error || !stream) return reject(error);
      const chunks: Buffer[] = [];
      let size = 0;
      Readable.from(stream)
        .on('data', (chunk: Buffer) => {
          size += chunk.byteLength;
          chunks.push(chunk);
        })
        .once('error', reject)
        .once('end', () => resolve(new Uint8Array(Buffer.concat(chunks, size))));
    });
  });

export const readAgregarrArchive = async (
  bytes: Uint8Array,
  expectedKind?: AgregarrTemplateKind
): Promise<AgregarrArchive> => {
  if (!bytes.byteLength) throw new Error('The Agregarr archive is empty.');
  if (bytes.byteLength > MAX_ARCHIVE_BYTES)
    throw new Error('Agregarr template archives cannot exceed 50 MB.');
  const zip = await openArchive(bytes);
  const assets: AgregarrArchiveAsset[] = [];
  const warnings: string[] = [];
  let manifestBytes: Uint8Array | undefined;
  let totalBytes = 0;
  let entryCount = 0;
  try {
    await new Promise<void>((resolve, reject) => {
      zip.once('error', reject);
      zip.once('end', resolve);
      zip.on('entry', (entry: Entry) => {
        void (async () => {
          try {
            entryCount += 1;
            if (entryCount > MAX_ENTRIES)
              throw new Error('The archive contains too many files.');
            const path = safeArchivePath(entry.fileName);
            if (/\/$/.test(path)) return zip.readEntry();
            if ((entry.generalPurposeBitFlag & 0x1) !== 0)
              throw new Error('Encrypted ZIP entries are not supported.');
            const isManifest = path === 'template.json';
            // Older and third-party Agregarr exporters do not always preserve
            // the canonical assets/icons and assets/images folders. Discover
            // supported image files anywhere in the archive so referenced
            // custom icons remain portable.
            const isAsset = mimeTypeFor(path) !== undefined;
            if (!isManifest && !isAsset) {
              warnings.push(`Ignored unsupported archive entry: ${path}`);
              return zip.readEntry();
            }
            const limit = isManifest ? MAX_TEMPLATE_BYTES : MAX_ASSET_BYTES;
            if (entry.uncompressedSize > limit)
              throw new Error(
                isManifest
                  ? 'template.json exceeds the 2 MB limit.'
                  : `Asset "${path}" exceeds the 10 MB limit.`
              );
            totalBytes += entry.uncompressedSize;
            if (totalBytes > MAX_TOTAL_BYTES)
              throw new Error('The expanded archive exceeds the 100 MB limit.');
            const data = await readEntry(zip, entry);
            if (isManifest) {
              if (manifestBytes)
                throw new Error('The archive contains more than one template.json.');
              manifestBytes = data;
            } else {
              const mimeType = mimeTypeFor(path);
              if (!mimeType) warnings.push(`Skipped unsupported asset: ${path}`);
              else
                assets.push({
                  archivePath: path,
                  name: basename(path),
                  mimeType,
                  bytes: data,
                });
            }
            zip.readEntry();
          } catch (error) {
            reject(error);
            zip.close();
          }
        })();
      });
      zip.readEntry();
    });
  } finally {
    zip.close();
  }
  if (!manifestBytes)
    throw new Error('The archive does not contain template.json.');
  let manifest: Record<string, unknown>;
  try {
    manifest = asRecord(JSON.parse(new TextDecoder().decode(manifestBytes)))!;
  } catch {
    throw new Error('template.json is not valid JSON.');
  }
  if (!manifest) throw new Error('template.json must contain an object.');
  const serializedManifest = JSON.stringify(manifest);
  for (const [fileName, builtIn] of AGREGARR_SYSTEM_ASSETS) {
    if (
      !serializedManifest
        .toLowerCase()
        .includes(`/api/v1/posters/icons/system/${fileName}`) ||
      assets.some((asset) => asset.name.toLowerCase() === fileName)
    )
      continue;
    assets.push({
      archivePath: `assets/icons/system/${fileName}`,
      name: builtIn.name,
      mimeType: builtIn.mimeType,
      bytes: new TextEncoder().encode(builtIn.source),
    });
    warnings.push(
      `Bundled Agregarr system icon "${fileName}" was added to the imported template.`
    );
  }
  const version = text(manifest.version);
  if (version && version !== '1.0' && version !== '2.0')
    throw new Error(
      `Agregarr template version "${version}" is not supported.`
    );
  const kind: AgregarrTemplateKind = version
    ? version === '2.0'
      ? 'collection-poster'
      : 'overlay'
    : expectedKind ??
      (manifest.applicationCondition !== undefined || manifest.type !== undefined
        ? 'overlay'
        : 'collection-poster');
  if (!version)
    warnings.push(
      `The archive has no version marker; it was interpreted as an Agregarr ${kind === 'overlay' ? 'overlay' : 'collection-poster'} template.`
    );
  if (expectedKind && kind !== expectedKind)
    throw new Error(
      `This is an Agregarr ${kind === 'overlay' ? 'overlay' : 'collection-poster'} archive.`
    );
  if (!text(manifest.name).trim() || !asRecord(manifest.templateData))
    throw new Error('The archive is missing its template name or template data.');
  return {
    kind,
    name: text(manifest.name).trim().slice(0, 120),
    description: text(manifest.description, 'Imported from Agregarr').slice(
      0,
      kind === 'overlay' ? 1000 : 500
    ),
    type: text(manifest.type, 'generic'),
    version,
    templateData: manifest.templateData,
    applicationCondition: manifest.applicationCondition,
    assets,
    warnings,
  };
};

export const normalizeAgregarrAsset = async (
  asset: AgregarrArchiveAsset
): Promise<NormalizedAgregarrAsset> => {
  if (asset.mimeType !== 'image/png' && asset.mimeType !== 'image/webp')
    return { asset };
  const image = sharp(asset.bytes, { failOn: 'error', limitInputPixels: 25_000_000 });
  const metadata = await image.metadata();
  if (!metadata.hasAlpha || !metadata.width || !metadata.height)
    return { asset };
  const trimmed = await image
    .trim({ background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .toBuffer({ resolveWithObject: true });
  const left = Math.max(0, -(trimmed.info.trimOffsetLeft ?? 0));
  const top = Math.max(0, -(trimmed.info.trimOffsetTop ?? 0));
  if (
    !left &&
    !top &&
    trimmed.info.width === metadata.width &&
    trimmed.info.height === metadata.height
  )
    return { asset };
  return {
    asset: { ...asset, bytes: new Uint8Array(trimmed.data) },
    crop: {
      sourceWidth: metadata.width,
      sourceHeight: metadata.height,
      left,
      top,
      width: trimmed.info.width,
      height: trimmed.info.height,
    },
  };
};

type AssetReference = {
  id: string;
  name: string;
  collectionPath: string;
  overlayPath: string;
  kind: 'raster' | 'svg';
  crop?: AgregarrAssetCrop;
};
const assetForPath = (
  path: unknown,
  assets: ReadonlyMap<string, AssetReference>
): AssetReference | undefined => {
  if (typeof path !== 'string') return undefined;
  return assets.get(basename(path.replaceAll('\\', '/')).toLowerCase());
};

const safeProperties = (value: unknown): Record<string, unknown> => {
  const source = asRecord(value) ?? {};
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(source).slice(0, 100)) {
    if (
      typeof item === 'string' ||
      typeof item === 'number' ||
      typeof item === 'boolean' ||
      item === undefined
    )
      result[key] = item;
    else if (Array.isArray(item))
      result[key] = item.slice(0, 100).flatMap((part) => {
        const record = asRecord(part);
        if (!record) return [];
        return [
          Object.fromEntries(
            Object.entries(record).filter(
              ([, nested]) =>
                typeof nested === 'string' ||
                typeof nested === 'number' ||
                typeof nested === 'boolean' ||
                nested === undefined
            )
          ),
        ];
      });
  }
  return result;
};

const geometry = (input: Record<string, unknown>, index: number) => ({
  id: text(input.id, `agregarr-${randomUUID()}`),
  layerOrder: finite(input.layerOrder, index),
  x: finite(input.x, 0),
  y: finite(input.y, 0),
  width: finite(input.width, 100),
  height: finite(input.height, 100),
  rotation: finite(input.rotation, 0),
});

const croppedGeometry = (
  input: Record<string, unknown>,
  index: number,
  asset?: AssetReference
) => {
  const result = geometry(input, index);
  const crop = asset?.crop;
  if (!crop) return result;
  const scale = Math.min(
    result.width / crop.sourceWidth,
    result.height / crop.sourceHeight
  );
  const renderedWidth = crop.sourceWidth * scale;
  const renderedHeight = crop.sourceHeight * scale;
  return {
    ...result,
    x:
      result.x +
      (result.width - renderedWidth) / 2 +
      crop.left * scale,
    y:
      result.y +
      (result.height - renderedHeight) / 2 +
      crop.top * scale,
    width: crop.width * scale,
    height: crop.height * scale,
  };
};

const semanticLayerName = (
  archiveName: string,
  type: string,
  properties: Record<string, unknown>
) => {
  if (type === 'tile') return `${archiveName} background`;
  if (type === 'raster') return `${archiveName} image`;
  if (type === 'svg') return `${archiveName} icon`;
  if (type === 'variable') {
    const segment = Array.isArray(properties.segments)
      ? asRecord(properties.segments.find((item) => asRecord(item)?.type === 'variable'))
      : undefined;
    const field = text(segment?.field);
    if (field)
      return field
        .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
        .replace(/^./, (value) => value.toUpperCase());
  }
  return `${type} layer`;
};

export const translateAgregarrCollectionPoster = (
  archive: AgregarrArchive,
  assets: ReadonlyMap<string, AssetReference>
): { design: CollectionPosterDesign; warnings: string[] } => {
  if (archive.kind !== 'collection-poster')
    throw new Error('Expected an Agregarr collection-poster archive.');
  const data = asRecord(archive.templateData)!;
  const sourceElements = Array.isArray(data.elements) ? data.elements : [];
  const warnings = [...archive.warnings];
  const allowed = new Set(['text', 'raster', 'svg', 'content-grid', 'person']);
  const elements: CollectionPosterLayer[] = sourceElements
    .slice(0, 100)
    .flatMap((value, index) => {
      const input = asRecord(value);
      if (!input || !allowed.has(text(input.type))) {
        warnings.push(`Skipped unsupported collection-poster layer ${index + 1}.`);
        return [];
      }
      const type = text(input.type) as CollectionPosterLayer['type'];
      const properties = safeProperties(input.properties) as CollectionPosterLayer['properties'];
      const sourcePath =
        type === 'svg' ? properties.iconPath : type === 'raster' ? properties.imagePath : undefined;
      const asset = assetForPath(sourcePath, assets);
      if (type === 'svg' || type === 'raster') {
        if (asset && asset.kind === type) {
          properties.assetId = asset.id;
          properties.assetName = asset.name;
          properties[type === 'svg' ? 'iconPath' : 'imagePath'] =
            asset.collectionPath;
        } else if (sourcePath) {
          delete properties.iconPath;
          delete properties.imagePath;
          warnings.push(
            `Layer "${text(input.name, type)}" referenced an asset that was not bundled.`
          );
        }
      }
      return [
        {
          ...croppedGeometry(input, index, type === 'raster' ? asset : undefined),
          type,
          name: text(
            input.name,
            semanticLayerName(archive.name, type, properties)
          ).slice(0, 120),
          properties,
        },
      ];
    });
  const background = asRecord(data.background) ?? {};
  return {
    design: {
      width: 1000,
      height: 1500,
      background: {
        type: ['color', 'gradient', 'radial'].includes(text(background.type))
          ? (text(background.type) as 'color' | 'gradient' | 'radial')
          : 'color',
        color: color(background.color, '#111827'),
        secondaryColor: color(background.secondaryColor, '#030712'),
        intensity: Math.min(100, Math.max(0, finite(background.intensity, 50))),
        useSourceColors: bool(background.useSourceColors, false),
      },
      elements,
      migrated: true,
    },
    warnings,
  };
};

export const translateAgregarrOverlay = (
  archive: AgregarrArchive,
  assets: ReadonlyMap<string, AssetReference>
): {
  design: { width: 1000; height: 1500; elements: readonly OverlayLayer[] };
  condition?: OverlayApplicationCondition;
  warnings: string[];
} => {
  if (archive.kind !== 'overlay')
    throw new Error('Expected an Agregarr overlay archive.');
  const data = asRecord(archive.templateData)!;
  const sourceElements = Array.isArray(data.elements) ? data.elements : [];
  const warnings = [...archive.warnings];
  const allowed = new Set([
    'text',
    'tile',
    'variable',
    'raster',
    'svg',
    'mapped-icon',
  ]);
  const elements: OverlayLayer[] = sourceElements
    .slice(0, 100)
    .flatMap((value, index) => {
      const input = asRecord(value);
      if (!input || !allowed.has(text(input.type))) {
        warnings.push(`Skipped unsupported overlay layer ${index + 1}.`);
        return [];
      }
      const type = text(input.type) as OverlayLayer['type'];
      const properties = safeProperties(input.properties) as OverlayLayer['properties'];
      const sourcePath =
        type === 'svg' ? properties.iconPath : type === 'raster' ? properties.imagePath : undefined;
      const asset = assetForPath(sourcePath, assets);
      if (type === 'svg' || type === 'raster') {
        if (asset && asset.kind === type) {
          properties.assetId = asset.id;
          properties.assetName = asset.name;
          properties[type === 'svg' ? 'iconPath' : 'imagePath'] =
            asset.overlayPath;
        } else if (sourcePath) {
          delete properties.iconPath;
          delete properties.imagePath;
          warnings.push(
            `Layer "${text(input.name, type)}" referenced an asset that was not bundled.`
          );
        }
      }
      if (type === 'mapped-icon' && Array.isArray(properties.mappings)) {
        properties.mappings = properties.mappings.map((mapping) => {
          const mapped = { ...mapping };
          const mappedAsset = assetForPath(mapped.iconPath, assets);
          if (mappedAsset) mapped.iconPath = mappedAsset.overlayPath;
          return mapped;
        });
      }
      return [
        {
          ...croppedGeometry(input, index, type === 'raster' ? asset : undefined),
          type,
          name: text(
            input.name,
            semanticLayerName(archive.name, type, properties)
          ).slice(0, 120),
          properties,
        },
      ];
    });
  const conditionSource = asRecord(archive.applicationCondition);
  const sections = Array.isArray(conditionSource?.sections)
    ? conditionSource.sections.slice(0, 20).flatMap((sectionValue) => {
        const section = asRecord(sectionValue);
        if (!section || !Array.isArray(section.rules)) return [];
        const rules = section.rules.slice(0, 20).flatMap((ruleValue) => {
          const rule = asRecord(ruleValue);
          const operator = text(rule?.operator);
          if (
            !rule ||
            !text(rule.field) ||
            ![
              'eq',
              'neq',
              'gt',
              'gte',
              'lt',
              'lte',
              'in',
              'contains',
              'notContains',
              'regex',
              'begins',
              'ends',
              'exists',
            ].includes(operator)
          )
            return [];
          const value = rule.value;
          if (
            typeof value !== 'string' &&
            typeof value !== 'number' &&
            typeof value !== 'boolean' &&
            !(
              Array.isArray(value) &&
              value.every(
                (item) =>
                  typeof item === 'string' || typeof item === 'number'
              )
            )
          )
            return [];
          return [
            {
              ...(rule.ruleOperator === 'or' ? { ruleOperator: 'or' as const } : {}),
              field: text(rule.field),
              operator: operator as OverlayApplicationCondition['sections'][number]['rules'][number]['operator'],
              value,
            },
          ];
        });
        if (!rules.length) return [];
        return [
          {
            ...(section.sectionOperator === 'or'
              ? { sectionOperator: 'or' as const }
              : {}),
            rules,
          },
        ];
      })
    : [];
  return {
    design: { width: 1000, height: 1500, elements },
    ...(sections.length ? { condition: { sections } } : {}),
    warnings,
  };
};

export const uniqueImportedName = (
  desired: string,
  existing: readonly string[]
): { name: string; renamed: boolean } => {
  const base = desired.trim().slice(0, 120);
  const occupied = new Set(existing.map((name) => name.trim().toLowerCase()));
  if (!occupied.has(base.toLowerCase()))
    return { name: base, renamed: base !== desired };
  let counter = 1;
  while (
    occupied.has(
      `${base.slice(0, 120 - String(counter).length - 3)} (${counter})`.toLowerCase()
    )
  )
    counter += 1;
  return {
    name: `${base.slice(0, 120 - String(counter).length - 3)} (${counter})`,
    renamed: true,
  };
};
