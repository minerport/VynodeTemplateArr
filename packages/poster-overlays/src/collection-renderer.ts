import type {
  CollectionPosterDesign,
  CollectionPosterLayer,
  SourceColorScheme,
} from '@vynode/contracts';
import sharp, { type OverlayOptions } from 'sharp';

export interface CollectionPosterRenderContext {
  title: string;
  sourceType?: string;
  sourceColors?: Readonly<Record<string, SourceColorScheme>>;
  itemPosters?: readonly Uint8Array[];
  personPoster?: Uint8Array;
}

export interface CollectionPosterAssetResolver {
  resolve(id: string, signal?: AbortSignal): Promise<Uint8Array>;
}

export interface CollectionPosterRendererOptions {
  assets?: CollectionPosterAssetResolver;
  quality?: number;
  maxOutputBytes?: number;
}

export interface CollectionPosterRenderReport {
  bytes: Uint8Array;
  renderedLayerIds: readonly string[];
  skippedLayers: readonly { id: string; reason: string }[];
}

const xml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const number = (
  layer: CollectionPosterLayer,
  key: string,
  fallback: number,
  minimum = Number.NEGATIVE_INFINITY,
  maximum = Number.POSITIVE_INFINITY
): number => {
  const value = Number(layer.properties[key]);
  return Number.isFinite(value)
    ? Math.max(minimum, Math.min(maximum, value))
    : fallback;
};

const textLayer = (
  layer: CollectionPosterLayer,
  title: string
): Buffer => {
  const alignment = String(layer.properties.textAlign ?? 'left');
  const x = alignment === 'center' ? '50%' : alignment === 'right' ? '100%' : '0';
  const anchor =
    alignment === 'center' ? 'middle' : alignment === 'right' ? 'end' : 'start';
  const content =
    layer.properties.elementType === 'collection-title'
      ? title
      : String(layer.properties.text ?? layer.name);
  const size = number(layer, 'fontSize', 72, 8, 400);
  const fill = String(layer.properties.color ?? '#ffffff');
  const family = xml(String(layer.properties.fontFamily ?? 'Arial'));
  const weight =
    String(layer.properties.fontWeight ?? 'normal') === 'bold'
      ? 'bold'
      : 'normal';
  const style =
    String(layer.properties.fontStyle ?? 'normal') === 'italic'
      ? 'italic'
      : 'normal';
  const opacity = number(layer, 'opacity', 100, 0, 100) / 100;
  const strokeColor = String(layer.properties.textStrokeColor ?? '#000000');
  const strokeWidth = number(layer, 'textStrokeWidth', 0, 0, 40);
  const shadowOpacity = number(layer, 'textShadowOpacity', 0, 0, 100) / 100;
  const shadowColor = String(layer.properties.textShadowColor ?? '#000000');
  const shadowBlur = number(layer, 'textShadowBlur', 0, 0, 100);
  const shadowX = number(layer, 'textShadowOffsetX', 0, -100, 100);
  const shadowY = number(layer, 'textShadowOffsetY', 0, -100, 100);
  const shadow = shadowOpacity > 0
    ? `<defs><filter id="text-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${shadowX}" dy="${shadowY}" stdDeviation="${shadowBlur}" flood-color="${shadowColor}" flood-opacity="${shadowOpacity}"/></filter></defs>`
    : '';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${layer.width}" height="${layer.height}">${shadow}<text x="${x}" y="50%" dominant-baseline="middle" text-anchor="${anchor}" font-family="${family}" font-size="${size}" font-weight="${weight}" font-style="${style}" fill="${fill}" stroke="${strokeColor}" stroke-width="${strokeWidth}" paint-order="stroke fill" opacity="${opacity}"${shadowOpacity > 0 ? ' filter="url(#text-shadow)"' : ''}>${xml(content)}</text></svg>`
  );
};

const backgroundSvg = (
  design: CollectionPosterDesign,
  context: CollectionPosterRenderContext
): Buffer => {
  const source = context.sourceType?.trim().toLowerCase();
  const palette =
    design.background.useSourceColors && source
      ? context.sourceColors?.[source]
      : undefined;
  const primary = palette?.primaryColor ?? design.background.color;
  const secondary =
    palette?.secondaryColor ?? design.background.secondaryColor;
  const intensity = design.background.intensity / 100;
  if (design.background.type === 'color')
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500"><rect width="1000" height="1500" fill="${primary}"/></svg>`
    );
  const radial = design.background.type === 'radial';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="1500"><defs><${radial ? 'radialGradient' : 'linearGradient'} id="background" ${radial ? 'cx="55%" cy="35%" r="75%"' : 'x1="0" y1="0" x2="1" y2="1"'}><stop offset="0" stop-color="${primary}" stop-opacity="${Math.max(0.15, intensity)}"/><stop offset="1" stop-color="${secondary}"/></${radial ? 'radialGradient' : 'linearGradient'}></defs><rect width="1000" height="1500" fill="url(#background)"/></svg>`
  );
};

export class NativeCollectionPosterRenderer {
  private readonly quality: number;
  private readonly maxOutputBytes: number;

  public constructor(private readonly options: CollectionPosterRendererOptions = {}) {
    this.quality = options.quality ?? 92;
    this.maxOutputBytes = options.maxOutputBytes ?? 11 * 1024 * 1024;
  }

  public async render(
    design: CollectionPosterDesign,
    context: CollectionPosterRenderContext,
    signal?: AbortSignal
  ): Promise<CollectionPosterRenderReport> {
    this.active(signal);
    if (design.width !== 1000 || design.height !== 1500)
      throw new Error('Collection posters must use a 1000 × 1500 canvas.');
    const overlays: OverlayOptions[] = [];
    const renderedLayerIds: string[] = [];
    const skippedLayers: { id: string; reason: string }[] = [];
    for (const layer of [...design.elements].sort(
      (left, right) =>
        left.layerOrder - right.layerOrder || left.id.localeCompare(right.id)
    )) {
      this.active(signal);
      if (layer.properties.hidden === true) continue;
      let input: Uint8Array | Buffer | undefined;
      if (layer.type === 'text') input = textLayer(layer, context.title);
      if (layer.type === 'raster' || layer.type === 'svg') {
        const assetId = String(layer.properties.assetId ?? '');
        if (assetId && this.options.assets)
          input = await this.options.assets.resolve(assetId, signal);
      }
      if (layer.type === 'person') input = context.personPoster;
      if (layer.type === 'content-grid')
        input = await this.contentGrid(layer, context.itemPosters ?? [], signal);
      if (!input) {
        skippedLayers.push({
          id: layer.id,
          reason:
            layer.type === 'content-grid'
              ? 'No collection item posters are available.'
              : layer.type === 'person'
                ? 'No person poster is available.'
                : 'The required stored asset is unavailable.',
        });
        continue;
      }
      let pipeline = sharp(input).resize({
        width: layer.width,
        height: layer.height,
        fit: String(layer.properties.fit ?? (layer.type === 'raster' ? 'cover' : 'contain')) === 'fill'
          ? 'fill'
          : String(layer.properties.fit ?? (layer.type === 'raster' ? 'cover' : 'contain')) === 'contain'
            ? 'contain'
            : 'cover',
      });
      if (layer.type === 'svg' && layer.properties.grayscale === true)
        pipeline = pipeline.grayscale().tint('#ffffff');
      if (layer.type !== 'text') {
        const opacity = number(layer, 'opacity', 100, 0, 100) / 100;
        pipeline = pipeline.ensureAlpha(opacity);
      }
      let rendered = await pipeline.png().toBuffer();
      if (layer.rotation)
        rendered = await sharp(rendered)
          .rotate(layer.rotation, {
            background: { r: 0, g: 0, b: 0, alpha: 0 },
          })
          .png()
          .toBuffer();
      const metadata = await sharp(rendered).metadata();
      const width = metadata.width ?? layer.width;
      const height = metadata.height ?? layer.height;
      overlays.push({
        input: rendered,
        left: Math.max(
          0,
          Math.min(1000 - width, layer.x + Math.round((layer.width - width) / 2))
        ),
        top: Math.max(
          0,
          Math.min(
            1500 - height,
            layer.y + Math.round((layer.height - height) / 2)
          )
        ),
      });
      renderedLayerIds.push(layer.id);
    }
    this.active(signal);
    const bytes = await sharp(backgroundSvg(design, context))
      .composite(overlays)
      .webp({ quality: this.quality })
      .toBuffer();
    if (bytes.byteLength > this.maxOutputBytes)
      throw new Error('The collection poster exceeds the Plex upload size limit.');
    return { bytes: new Uint8Array(bytes), renderedLayerIds, skippedLayers };
  }

  private async contentGrid(
    layer: CollectionPosterLayer,
    posters: readonly Uint8Array[],
    signal?: AbortSignal
  ): Promise<Uint8Array | undefined> {
    const columns = Math.round(number(layer, 'columns', 3, 1, 8));
    const rows = Math.round(number(layer, 'rows', 2, 1, 8));
    const spacing = Math.round(number(layer, 'spacing', 24, 0, 100));
    const padding = Math.round(number(layer, 'padding', 0, 0, 200));
    const radius = Math.round(number(layer, 'cornerRadius', 20, 0, 100));
    const count = Math.min(columns * rows, posters.length);
    if (!count) return undefined;
    const width = Math.floor((layer.width - padding * 2 - spacing * (columns - 1)) / columns);
    const height = Math.floor((layer.height - padding * 2 - spacing * (rows - 1)) / rows);
    if (width < 1 || height < 1) return undefined;
    const tiles: OverlayOptions[] = [];
    for (let index = 0; index < count; index++) {
      this.active(signal);
      let tilePipeline = sharp(posters[index]!).resize(width, height, {
        fit: String(layer.properties.imageFit ?? 'cover') === 'contain' ? 'contain' : 'cover',
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      });
      const composites: OverlayOptions[] = [
          {
            input: Buffer.from(
              `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" rx="${radius}" fill="white"/></svg>`
            ),
            blend: 'dest-in',
          },
        ];
      if (layer.properties.showItemText === true)
        composites.push({
          input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><text x="${width - 8}" y="${height - 8}" text-anchor="end" font-family="Arial" font-size="${number(layer, 'itemTextSize', 28, 8, 100)}" font-weight="bold" fill="${String(layer.properties.itemTextColor ?? '#ffffff')}">#${index + 1}</text></svg>`),
          left: 0,
          top: 0,
        });
      const tile = await tilePipeline.composite(composites).png().toBuffer();
      tiles.push({
        input: tile,
        left: padding + (index % columns) * (width + spacing),
        top: padding + Math.floor(index / columns) * (height + spacing),
      });
    }
    return new Uint8Array(
      await sharp({
        create: {
          width: layer.width,
          height: layer.height,
          channels: 4,
          background: { r: 0, g: 0, b: 0, alpha: 0 },
        },
      })
        .composite(tiles)
        .png()
        .toBuffer()
    );
  }

  private active(signal?: AbortSignal): void {
    if (signal?.aborted)
      throw new DOMException('Collection poster rendering was cancelled.', 'AbortError');
  }
}
