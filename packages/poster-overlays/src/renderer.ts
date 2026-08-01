import {
  dynamicValueIconForField,
  dynamicValueIcons,
  overlayShapeById,
  streamingServiceIcons,
  type OverlayIconMapping,
  type OverlayLayer,
  type OverlayTemplateSummary,
  type OverlayVariableSegment,
} from '@vynode/contracts';
import sharp, { type OverlayOptions } from 'sharp';

import {
  evaluateOverlayCondition,
  type OverlayRenderContext,
} from './conditions.js';
import { planOverlayGeometry, type OverlayRenderGeometry } from './geometry.js';
import { resolveMappedIcons, resolveVariableText } from './variables.js';

export interface OverlayRenderReport {
  bytes: Uint8Array;
  appliedTemplateIds: readonly string[];
  skippedTemplateIds: readonly string[];
  skippedElements: readonly {
    templateId: string;
    elementId: string;
    reason: string;
  }[];
}

export interface NativeOverlayRendererOptions {
  quality?: number;
  maxOutputBytes?: number;
  assets?: OverlayAssetResolver;
  mappings?: OverlayMappingProvider;
}

export interface OverlayAssetResolver {
  resolve(path: string, signal?: AbortSignal): Promise<Uint8Array>;
}

export interface OverlayMappingProvider {
  mappings(field: string): Promise<readonly OverlayIconMapping[]>;
}

const xml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const number = (
  layer: OverlayLayer,
  key: string,
  fallback: number,
  minimum = Number.NEGATIVE_INFINITY,
  maximum = Number.POSITIVE_INFINITY
): number => {
  const value = layer.properties[key];
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(maximum, Math.max(minimum, value))
    : fallback;
};

const string = (layer: OverlayLayer, key: string, fallback: string): string =>
  typeof layer.properties[key] === 'string'
    ? (layer.properties[key] as string)
    : fallback;

const missingContextValue = (value: unknown): boolean =>
  value === undefined ||
  value === null ||
  (typeof value === 'string' && value.trim() === '') ||
  (Array.isArray(value) && value.length === 0);

const templateHasMissingVariables = (
  template: OverlayTemplateSummary,
  context: OverlayRenderContext
): boolean =>
  template.design.elements.some((layer) => {
    if (layer.type === 'mapped-icon') {
      const field = string(layer, 'field', '');
      return Boolean(field) && missingContextValue(context[field]);
    }
    if (layer.type !== 'variable') return false;
    const segments = layer.properties.segments;
    return (
      Array.isArray(segments) &&
      segments.some(
        (segment) =>
          segment?.type === 'variable' &&
          typeof segment.field === 'string' &&
          Boolean(segment.field) &&
          missingContextValue(context[segment.field])
      )
    );
  });

const color = (value: string, fallback: string): string =>
  /^(?:#[a-f\d]{3,8}|rgba?\([\d., %]+\)|[a-z]+)$/i.test(value)
    ? value
    : fallback;

const roundedPath = (
  width: number,
  height: number,
  radii: readonly number[]
): string => {
  const normalized = radii.map((radius) =>
    Math.min(Math.max(0, radius), width / 2, height / 2)
  );
  const topLeft = normalized[0] ?? 0;
  const topRight = normalized[1] ?? 0;
  const bottomRight = normalized[2] ?? 0;
  const bottomLeft = normalized[3] ?? 0;
  return [
    `M ${topLeft} 0`,
    `L ${width - topRight} 0`,
    `Q ${width} 0 ${width} ${topRight}`,
    `L ${width} ${height - bottomRight}`,
    `Q ${width} ${height} ${width - bottomRight} ${height}`,
    `L ${bottomLeft} ${height}`,
    `Q 0 ${height} 0 ${height - bottomLeft}`,
    `L 0 ${topLeft}`,
    `Q 0 0 ${topLeft} 0`,
    'Z',
  ].join(' ');
};

const textAnchor = (alignment: string): { x: string; anchor: string } =>
  alignment === 'center'
    ? { x: '50%', anchor: 'middle' }
    : alignment === 'right'
      ? { x: '100%', anchor: 'end' }
      : { x: '0', anchor: 'start' };

const textSvg = (
  layer: OverlayLayer,
  geometry: OverlayRenderGeometry,
  value: string,
  customFont?: Uint8Array
): Buffer => {
  const alignment = string(layer, 'textAlign', 'left');
  const anchor = textAnchor(alignment);
  const scale = geometry.width / Math.max(1, layer.width);
  const fontSize = number(layer, 'fontSize', 48, 1, 500) * scale;
  const opacity = number(layer, 'opacity', 100, 0, 100) / 100;
  const fill = color(string(layer, 'color', '#ffffff'), '#ffffff');
  const textStroke = color(
    string(layer, 'textStrokeColor', '#000000'),
    '#000000'
  );
  const textStrokeWidth =
    number(layer, 'textStrokeWidth', 0, 0, 40) * scale;
  const shadowColor = color(
    string(layer, 'textShadowColor', '#000000'),
    '#000000'
  );
  const shadowOpacity = number(layer, 'textShadowOpacity', 0, 0, 100) / 100;
  const shadowBlur = number(layer, 'textShadowBlur', 0, 0, 100) * scale;
  const shadowX = number(layer, 'textShadowOffsetX', 0, -100, 100) * scale;
  const shadowY = number(layer, 'textShadowOffsetY', 0, -100, 100) * scale;
  const family = customFont ? 'VynodeCustomFont' : xml(string(layer, 'fontFamily', 'Arial'));
  const fontFace = customFont ? `<style>@font-face{font-family:'VynodeCustomFont';src:url(data:font/woff2;base64,${Buffer.from(customFont).toString('base64')})}</style>` : '';
  const weight =
    string(layer, 'fontWeight', 'normal') === 'bold' ? 'bold' : 'normal';
  const style =
    string(layer, 'fontStyle', 'normal') === 'italic' ? 'italic' : 'normal';
  const legacyRadius = number(layer, 'borderRadius', 0, 0);
  const topLeft = number(layer, 'borderRadiusTopLeft', legacyRadius, 0) * scale;
  const locked = layer.properties.lockCorners === true;
  const radii = locked
    ? [topLeft, topLeft, topLeft, topLeft]
    : [
        topLeft,
        number(layer, 'borderRadiusTopRight', legacyRadius, 0) * scale,
        number(layer, 'borderRadiusBottomRight', legacyRadius, 0) * scale,
        number(layer, 'borderRadiusBottomLeft', legacyRadius, 0) * scale,
      ];
  const background = color(string(layer, 'fillColor', '#000000'), '#000000');
  const backgroundOpacity = number(layer, 'fillOpacity', 0, 0, 100) / 100;
  const stroke = color(
    string(layer, 'borderColor', 'transparent'),
    'transparent'
  );
  const strokeWidth = number(layer, 'borderWidth', 0, 0) * scale;
  const shadow = shadowOpacity > 0
    ? `<defs><filter id="text-shadow" x="-50%" y="-50%" width="200%" height="200%"><feDropShadow dx="${shadowX}" dy="${shadowY}" stdDeviation="${shadowBlur}" flood-color="${shadowColor}" flood-opacity="${shadowOpacity}"/></filter></defs>`
    : '';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.width}" height="${geometry.height}">${fontFace}${shadow}<path d="${roundedPath(geometry.width, geometry.height, radii)}" fill="${background}" fill-opacity="${backgroundOpacity}" stroke="${stroke}" stroke-width="${strokeWidth}"/><text x="${anchor.x}" y="50%" dominant-baseline="middle" text-anchor="${anchor.anchor}" font-family="${family}" font-size="${fontSize}" font-weight="${weight}" font-style="${style}" fill="${fill}" stroke="${textStroke}" stroke-width="${textStrokeWidth}" paint-order="stroke fill" opacity="${opacity}"${shadowOpacity > 0 ? ' filter="url(#text-shadow)"' : ''}>${xml(value)}</text></svg>`
  );
};

const tileSvg = (
  layer: OverlayLayer,
  geometry: OverlayRenderGeometry
): Buffer => {
  const scale = geometry.width / Math.max(1, layer.width);
  const legacyRadius = number(layer, 'borderRadius', 0, 0);
  const topLeft = number(layer, 'borderRadiusTopLeft', legacyRadius, 0) * scale;
  const locked = layer.properties.lockCorners === true;
  const radii = locked
    ? [topLeft, topLeft, topLeft, topLeft]
    : [
        topLeft,
        number(layer, 'borderRadiusTopRight', legacyRadius, 0) * scale,
        number(layer, 'borderRadiusBottomRight', legacyRadius, 0) * scale,
        number(layer, 'borderRadiusBottomLeft', legacyRadius, 0) * scale,
      ];
  const fill = color(string(layer, 'fillColor', '#000000'), '#000000');
  const fillOpacity = number(layer, 'fillOpacity', 100, 0, 100) / 100;
  const stroke = color(
    string(layer, 'borderColor', 'transparent'),
    'transparent'
);
  const strokeWidth = number(layer, 'borderWidth', 0, 0) * scale;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.width}" height="${geometry.height}"><path d="${roundedPath(geometry.width, geometry.height, radii)}" fill="${fill}" fill-opacity="${fillOpacity}" stroke="${stroke}" stroke-width="${strokeWidth}"/></svg>`
  );
};

const shapeSvg = (
  layer: OverlayLayer,
  geometry: OverlayRenderGeometry
): Buffer => {
  const shape = overlayShapeById(string(layer, 'shapeId', 'soft-plate'));
  const fill = color(string(layer, 'fillColor', '#000000'), '#000000');
  const stroke = color(
    string(layer, 'borderColor', '#ffffff'),
    '#ffffff'
  );
  const transform = `${layer.properties.flipX ? 'translate(120 0) scale(-1 1)' : ''} ${layer.properties.flipY ? 'translate(0 72) scale(1 -1)' : ''}`;
  const dash =
    string(layer, 'outlineStyle', 'solid') === 'dashed'
      ? '8 5'
      : string(layer, 'outlineStyle', 'solid') === 'dotted'
        ? '2 5'
        : '';
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.width}" height="${geometry.height}" viewBox="0 0 120 72" preserveAspectRatio="${layer.properties.preserveAspectRatio ? 'xMidYMid meet' : 'none'}"><path d="${shape.path}" transform="${transform}" fill="${fill}" fill-opacity="${number(layer, 'fillOpacity', 100, 0, 100) / 100}" stroke="${stroke}" stroke-opacity="${number(layer, 'borderOpacity', 100, 0, 100) / 100}" stroke-width="${number(layer, 'borderWidth', 0, 0, 80)}" stroke-dasharray="${dash}" stroke-linejoin="round" opacity="${number(layer, 'opacity', 100, 0, 100) / 100}"/></svg>`
  );
};

const iconArtworkMarkup = (
  layer: OverlayLayer,
  icon: (typeof dynamicValueIcons)[number]
): string => {
  const main = color(string(layer, 'iconColor', '#ffffff'), '#ffffff');
  const soft = color(string(layer, 'iconSoftColor', main), main);
  const accent = color(
    string(layer, 'iconAccentColor', '#f3ad32'),
    '#f3ad32'
  );
  const mode = string(layer, 'iconStyle', 'outline');
  const strokeWidth = number(layer, 'iconStrokeWidth', 1.8, 0, 12);
  const strokeStyle = string(layer, 'iconStrokeStyle', 'solid');
  const dash = strokeStyle === 'dashed' ? '4 2.5' : strokeStyle === 'dotted' ? '1 2' : 'none';
  const body = icon.svgBody ?? `<path class="main" d="${icon.path}"/>`;
  const sx = layer.properties.flipX ? -1 : 1;
  const sy = layer.properties.flipY ? -1 : 1;
  const flip = `translate(${sx < 0 ? 24 : 0} ${sy < 0 ? 24 : 0}) scale(${sx} ${sy})`;
  const badge =
    mode === 'badge'
      ? `<rect x=".75" y=".75" width="22.5" height="22.5" rx="${number(layer, 'iconBadgeRadius', 12, 0, 12)}" fill="${color(string(layer, 'iconBadgeColor', main), main)}" fill-opacity="${number(layer, 'iconBadgeOpacity', 18, 0, 100) / 100}" stroke="${color(string(layer, 'iconBadgeBorderColor', main), main)}" stroke-width="${number(layer, 'iconBadgeBorderWidth', 0, 0, 6)}"/>`
      : '';
  const transform = mode === 'badge' ? 'translate(2.5 2.5) scale(.7916667)' : '';
  const softFill = mode === 'solid' ? soft : 'none';
  return `<g transform="${flip}">${badge}<g transform="${transform}"><style>.main{fill:none;stroke:${main};stroke-width:${strokeWidth};stroke-dasharray:${dash};stroke-linecap:round;stroke-linejoin:round}.soft{fill:${softFill};stroke:${soft};stroke-width:${strokeWidth};stroke-dasharray:${dash};stroke-linecap:round;stroke-linejoin:round;opacity:${number(layer, 'iconSoftOpacity', mode === 'solid' ? 24 : 100, 0, 100) / 100}}.accent{fill:${accent};stroke:none;opacity:${number(layer, 'iconAccentOpacity', 100, 0, 100) / 100}}</style>${body}</g></g>`;
};

const iconSvg = (
  layer: OverlayLayer,
  geometry: OverlayRenderGeometry
): Buffer => {
  const id = string(layer, 'systemIcon', 'play');
  const icon =
    dynamicValueIcons.find((item) => item.id === id) ?? dynamicValueIcons[0]!;
  const backgroundOpacity =
    number(layer, 'iconBackgroundOpacity', 0, 0, 100) / 100;
  const backgroundWidth = number(
    layer,
    'iconBackgroundBorderWidth',
    0,
    0,
    40
  );
  const backgroundShape = string(layer, 'iconBackgroundShape', 'rounded');
  const radius =
    backgroundShape === 'pill' || backgroundShape === 'circle'
      ? 12
      : backgroundShape === 'rounded'
        ? Math.min(12, number(layer, 'iconBackgroundRadius', 12, 0, 100))
        : 0;
  const padding = Math.min(
    10,
    (number(layer, 'iconBackgroundPadding', 0, 0, 200) /
      Math.max(1, Math.min(layer.width, layer.height))) *
      24
  );
  const artworkScale = Math.max(0.05, (24 - padding * 2) / 24);
  const background = `<rect x="${backgroundWidth / 2}" y="${backgroundWidth / 2}" width="${24 - backgroundWidth}" height="${24 - backgroundWidth}" rx="${radius}" fill="${color(string(layer, 'iconBackgroundColor', '#000000'), '#000000')}" fill-opacity="${backgroundOpacity}" stroke="${color(string(layer, 'iconBackgroundBorderColor', '#ffffff'), '#ffffff')}" stroke-width="${backgroundWidth}"/>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.width}" height="${geometry.height}" viewBox="0 0 24 24" preserveAspectRatio="none">${background}<g transform="translate(${padding} ${padding}) scale(${artworkScale})" opacity="${number(layer, 'iconOpacity', 100, 0, 100) / 100}">${iconArtworkMarkup(layer, icon)}</g></svg>`
  );
};

const mappedArtwork = (
  layer: OverlayLayer,
  iconPath: string,
  size: number
): Buffer | undefined => {
  const icon = iconPath.startsWith('icon://')
    ? dynamicValueIcons.find(
        (item) => item.id === iconPath.slice('icon://'.length)
      )
    : undefined;
  const shape = iconPath.startsWith('shape://')
    ? overlayShapeById(iconPath.slice('shape://'.length))
    : undefined;
  const iconColor = color(string(layer, 'iconColor', '#ffffff'), '#ffffff');
  const outlineColor = color(
    string(layer, 'iconOutlineColor', iconColor),
    iconColor
  );
  if (icon)
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24">${iconArtworkMarkup(layer, icon)}</svg>`
    );
  if (shape)
    return Buffer.from(
      `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 120 72" preserveAspectRatio="xMidYMid meet"><path d="${shape.path}" fill="${iconColor}" fill-opacity="${number(layer, 'iconFillOpacity', 100, 0, 100) / 100}" stroke="${number(layer, 'iconOutlineWidth', 0, 0, 80) > 0 ? outlineColor : 'none'}" stroke-width="${number(layer, 'iconOutlineWidth', 0, 0, 80)}"/></svg>`
    );
  return undefined;
};

const mappedValueText = (
  field: string,
  value:
    | string
    | number
    | boolean
    | Date
    | readonly (string | number | boolean)[],
  context: OverlayRenderContext
): string => {
  if (Array.isArray(value)) return value.map(String).join(' · ');
  return (
    resolveVariableText([{ type: 'variable', field }], context) ?? String(value)
  );
};

const systemIconSvg = (
  layer: OverlayLayer,
  geometry: OverlayRenderGeometry,
  field: string,
  value:
    | string
    | number
    | boolean
    | Date
    | readonly (string | number | boolean)[],
  context: OverlayRenderContext
): Buffer => {
  const selectedId = string(
    layer,
    'systemIcon',
    dynamicValueIconForField(field).id
  );
  const icon =
    dynamicValueIcons.find((item) => item.id === selectedId) ??
    dynamicValueIconForField(field);
  const mappedShape = selectedId.startsWith('shape:')
    ? overlayShapeById(selectedId.slice('shape:'.length))
    : undefined;
  const scale = geometry.width / Math.max(1, layer.width);
  const iconSize = Math.min(
    geometry.width,
    Math.max(1, number(layer, 'iconSize', 80, 1) * scale)
  );
  const iconOpacity = number(layer, 'iconOpacity', 100, 0, 100) / 100;
  const iconColor = color(string(layer, 'iconColor', '#ffffff'), '#ffffff');
  const plateOpacity = number(layer, 'iconBackgroundOpacity', 0, 0, 100) / 100;
  const plateColor = color(
    string(layer, 'iconBackgroundColor', '#000000'),
    '#000000'
  );
  const platePadding =
    number(layer, 'iconBackgroundPadding', 12, 0, 200) * scale;
  const plateBorderWidth =
    number(layer, 'iconBackgroundBorderWidth', 0, 0, 40) * scale;
  const plateBorderColor = color(
    string(layer, 'iconBackgroundBorderColor', '#ffffff'),
    '#ffffff'
  );
  const plateShape = string(layer, 'iconBackgroundShape', 'rounded');
  const plateSize = Math.min(
    geometry.width,
    iconSize + platePadding * 2 + plateBorderWidth * 2
  );
  const valueColor = color(string(layer, 'valueColor', '#ffffff'), '#ffffff');
  const valueOpacity = number(layer, 'valueOpacity', 100, 0, 100) / 100;
  const valueFontSize = number(layer, 'valueFontSize', 42, 8, 400) * scale;
  const gap = number(layer, 'valueGap', 12, -200, 500) * scale;
  const alignment = string(layer, 'valueAlign', 'center');
  const anchor = textAnchor(alignment);
  const plateX =
    alignment === 'left'
      ? 0
      : alignment === 'right'
        ? geometry.width - plateSize
        : (geometry.width - plateSize) / 2;
  const iconX = plateX + (plateSize - iconSize) / 2;
  const plateRadius =
    plateShape === 'circle'
      ? plateSize / 2
      : plateShape === 'rounded'
        ? Math.max(4 * scale, platePadding)
        : 0;
  const textY = Math.min(
    geometry.height - valueFontSize / 2,
    plateSize + gap + valueFontSize / 2
  );
  const family = xml(string(layer, 'valueFontFamily', 'Arial'));
  const weight =
    string(layer, 'valueFontWeight', 'bold') === 'bold' ? 'bold' : 'normal';
  const fontStyle =
    string(layer, 'valueFontStyle', 'normal') === 'italic'
      ? 'italic'
      : 'normal';
  const label = xml(mappedValueText(field, value, context));
  const valueBackgroundOpacity =
    number(layer, 'valueBackgroundOpacity', 0, 0, 100) / 100;
  const valueBackgroundColor = color(
    string(layer, 'valueBackgroundColor', '#000000'),
    '#000000'
  );
  const valueBackgroundPadding =
    number(layer, 'valueBackgroundPadding', 8, 0, 200) * scale;
  const valueBackgroundBorderWidth =
    number(layer, 'valueBackgroundBorderWidth', 0, 0, 40) * scale;
  const valueBackgroundBorderColor = color(
    string(layer, 'valueBackgroundBorderColor', '#ffffff'),
    '#ffffff'
  );
  const valueBackgroundShape = string(layer, 'valueBackgroundShape', 'rounded');
  const valuePlateHeight = Math.min(
    geometry.height,
    valueFontSize + valueBackgroundPadding * 2
  );
  const valuePlateY = Math.max(
    0,
    Math.min(geometry.height - valuePlateHeight, textY - valuePlateHeight / 2)
  );
  const valueRadius =
    valueBackgroundShape === 'pill'
      ? valuePlateHeight / 2
      : valueBackgroundShape === 'rounded'
        ? Math.max(4 * scale, valueBackgroundPadding)
        : 0;
  const valuePlateMarkup =
    valueBackgroundOpacity === 0 && valueBackgroundBorderWidth === 0
      ? ''
      : `<rect x="0" y="${valuePlateY}" width="${geometry.width}" height="${valuePlateHeight}" rx="${valueRadius}" fill="${valueBackgroundColor}" fill-opacity="${valueBackgroundOpacity}" stroke="${valueBackgroundBorderColor}" stroke-width="${valueBackgroundBorderWidth}"/>`;
  const valueMarkup =
    layer.properties.showValue === false
      ? ''
      : `${valuePlateMarkup}<text x="${anchor.x}" y="${textY}" dominant-baseline="middle" text-anchor="${anchor.anchor}" font-family="${family}" font-size="${valueFontSize}" font-weight="${weight}" font-style="${fontStyle}" fill="${valueColor}" opacity="${valueOpacity}">${label}</text>`;
  const plateMarkup =
    plateOpacity === 0 && plateBorderWidth === 0
      ? ''
      : `<rect x="${plateX}" y="0" width="${plateSize}" height="${plateSize}" rx="${plateRadius}" fill="${plateColor}" fill-opacity="${plateOpacity}" stroke="${plateBorderColor}" stroke-width="${plateBorderWidth}"/>`;
  const groupOpacity = number(layer, 'groupBackgroundOpacity', 0, 0, 100) / 100;
  const groupColor = color(
    string(layer, 'groupBackgroundColor', '#000000'),
    '#000000'
  );
  const groupBorderWidth =
    number(layer, 'groupBackgroundBorderWidth', 0, 0, 40) * scale;
  const groupBorderColor = color(
    string(layer, 'groupBackgroundBorderColor', '#ffffff'),
    '#ffffff'
  );
  const groupShape = string(layer, 'groupBackgroundShape', 'rounded');
  const groupPadding =
    number(layer, 'groupBackgroundPadding', 12, 0, 200) * scale;
  const groupRadius =
    groupShape === 'pill'
      ? Math.min(geometry.width, geometry.height) / 2
      : groupShape === 'rounded'
        ? Math.max(4 * scale, groupPadding)
        : 0;
  const groupMarkup =
    groupOpacity === 0 && groupBorderWidth === 0
      ? ''
      : `<rect x="0" y="0" width="${geometry.width}" height="${geometry.height}" rx="${groupRadius}" fill="${groupColor}" fill-opacity="${groupOpacity}" stroke="${groupBorderColor}" stroke-width="${groupBorderWidth}"/>`;
  const iconMarkup = mappedShape
    ? `<g transform="translate(${iconX} ${(plateSize - iconSize) / 2}) scale(${iconSize / 120} ${iconSize / 72})" opacity="${iconOpacity}"><path d="${mappedShape.path}" fill="${iconColor}" fill-opacity="${number(layer, 'iconFillOpacity', 100, 0, 100) / 100}" stroke="${color(string(layer, 'iconOutlineColor', iconColor), iconColor)}" stroke-width="${number(layer, 'iconOutlineWidth', 0, 0, 40)}" stroke-linejoin="round"/></g>`
    : `<g transform="translate(${iconX} ${(plateSize - iconSize) / 2}) scale(${iconSize / 24})" opacity="${iconOpacity}">${iconArtworkMarkup(layer, icon)}</g>`;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${geometry.width}" height="${geometry.height}" viewBox="0 0 ${geometry.width} ${geometry.height}">${groupMarkup}${plateMarkup}${iconMarkup}${valueMarkup}</svg>`
  );
};

export class NativeOverlayRenderer {
  private readonly quality: number;
  private readonly maxOutputBytes: number;
  private readonly assets: OverlayAssetResolver | undefined;
  private readonly mappings: OverlayMappingProvider | undefined;

  public constructor(options: NativeOverlayRendererOptions = {}) {
    this.quality = options.quality ?? 92;
    this.maxOutputBytes = options.maxOutputBytes ?? 11 * 1024 * 1024;
    this.assets = options.assets;
    this.mappings = options.mappings;
  }

  public async render(
    poster: Uint8Array,
    templates: readonly OverlayTemplateSummary[],
    context: OverlayRenderContext,
    signal?: AbortSignal
  ): Promise<OverlayRenderReport> {
    this.assertActive(signal);
    const metadata = await sharp(poster).metadata();
    const width = metadata.width;
    const height = metadata.height;
    if (!width || !height)
      throw new Error('The base poster has no dimensions.');
    const overlays: OverlayOptions[] = [];
    const appliedTemplateIds: string[] = [];
    const skippedTemplateIds: string[] = [];
    const skippedElements: OverlayRenderReport['skippedElements'][number][] =
      [];
    const ordered = [...templates].sort(
      (left, right) =>
        left.displayOrder - right.displayOrder ||
        left.id.localeCompare(right.id)
    );
    for (const template of ordered) {
      this.assertActive(signal);
      if (
        !template.enabled ||
        !evaluateOverlayCondition(template.condition, context) ||
        templateHasMissingVariables(template, context)
      ) {
        skippedTemplateIds.push(template.id);
        continue;
      }
      const geometry = new Map(
        planOverlayGeometry(template.design, width, height).map((item) => [
          item.elementId,
          item,
        ])
      );
      let rendered = 0;
      for (const layer of [...template.design.elements].sort(
        (left, right) =>
          left.layerOrder - right.layerOrder || left.id.localeCompare(right.id)
      )) {
        this.assertActive(signal);
        if (layer.properties.hidden === true) continue;
        const placement = geometry.get(layer.id)!;
        let input: Buffer | undefined;
        if (layer.type === 'tile') input = tileSvg(layer, placement);
        if (layer.type === 'shape') input = shapeSvg(layer, placement);
        if (layer.type === 'icon') input = iconSvg(layer, placement);
        if (layer.type === 'text')
          input = textSvg(layer, placement, string(layer, 'text', ''), string(layer, 'fontPath', '') && this.assets ? await this.assets.resolve(string(layer, 'fontPath', ''), signal) : undefined);
        if (layer.type === 'variable') {
          const segments = layer.properties.segments;
          const serviceSegment =
            Array.isArray(segments) && segments.length === 1 &&
            segments[0]?.type === 'variable' &&
            segments[0]?.field === 'streamingProvider';
          const serviceName = serviceSegment ? context.streamingProvider : undefined;
          const serviceIcon = typeof serviceName === 'string'
            ? streamingServiceIcons.find(
                (icon) => icon.label.toLocaleLowerCase('en-US') === serviceName.toLocaleLowerCase('en-US')
              )
            : undefined;
          if (serviceIcon) {
            input = mappedArtwork(layer, `icon://${serviceIcon.id}`, Math.min(placement.width, placement.height));
          }
          const value = Array.isArray(segments)
            ? resolveVariableText(
                segments as readonly OverlayVariableSegment[],
                context
              )
            : undefined;
          const renderedValue =
            value ??
            (string(layer, 'missingValueBehavior', 'hide') === 'fallback'
              ? string(layer, 'missingValueFallback', 'N/A')
              : undefined);
          if (!input && renderedValue !== undefined)
            input = textSvg(layer, placement, renderedValue, string(layer, 'fontPath', '') && this.assets ? await this.assets.resolve(string(layer, 'fontPath', ''), signal) : undefined);
        }
        if (layer.type === 'raster' || layer.type === 'svg') {
          const path =
            layer.type === 'raster'
              ? string(layer, 'imagePath', '')
              : string(layer, 'iconPath', '');
          if (path && this.assets) {
            const asset = await this.assets.resolve(path, signal);
            let pipeline = sharp(asset).resize({
              width: placement.width,
              height: placement.height,
              fit: string(layer, 'fit', 'contain') === 'cover'
                ? 'cover'
                : string(layer, 'fit', 'contain') === 'fill'
                  ? 'fill'
                  : 'contain',
            });
            if (layer.type === 'svg' && layer.properties.grayscale === true)
              pipeline = pipeline.grayscale().tint('#ffffff');
            if (layer.type === 'svg' && layer.properties.svgFillEnabled === true)
              pipeline = pipeline.grayscale().tint(color(string(layer, 'svgFillColor', '#ffffff'), '#ffffff'));
            const opacity = number(layer, 'opacity', 100, 0, 100) / 100;
            let rendered = await pipeline.png().toBuffer();
            if (layer.type === 'svg') {
              const outlineWidth = Math.round(number(layer, 'svgStrokeWidth', 0, 0, 40));
              if (outlineWidth > 0) {
                const metadata = await sharp(rendered).metadata();
                const mask = await sharp(rendered).ensureAlpha().extractChannel(3).dilate(outlineWidth).toBuffer();
                const outline = await sharp({
                  create: {
                    width: metadata.width ?? placement.width,
                    height: metadata.height ?? placement.height,
                    channels: 3,
                    background: color(string(layer, 'svgStrokeColor', '#000000'), '#000000'),
                  },
                }).joinChannel(mask).png().toBuffer();
                rendered = await sharp(outline).composite([{ input: rendered }]).png().toBuffer();
              }
            }
            input = Buffer.from(
              `<svg xmlns="http://www.w3.org/2000/svg" width="${placement.width}" height="${placement.height}"><image href="data:image/png;base64,${rendered.toString('base64')}" width="${placement.width}" height="${placement.height}" preserveAspectRatio="xMidYMid meet" opacity="${opacity}"/></svg>`
            );
          }
        }
        if (layer.type === 'mapped-icon') {
          const field = string(layer, 'field', '');
          const value =
            context[field] ??
            (string(layer, 'missingValueBehavior', 'hide') === 'fallback'
              ? string(layer, 'missingValueFallback', 'N/A')
              : undefined);
          const saved = layer.properties.mappings;
          if (
            field &&
            value !== undefined &&
            value !== null &&
            (typeof value === 'string' ||
              typeof value === 'number' ||
              typeof value === 'boolean' ||
              value instanceof Date ||
              (Array.isArray(value) &&
                value.every(
                  (entry) =>
                    typeof entry === 'string' ||
                    typeof entry === 'number' ||
                    typeof entry === 'boolean'
                ))) &&
            Array.isArray(saved)
          ) {
            if (string(layer, 'systemIcon', '')) {
              input = systemIconSvg(
                layer,
                placement,
                field,
                value as
                  | string
                  | number
                  | boolean
                  | Date
                  | readonly (string | number | boolean)[],
                context
              );
            }
            const icons =
              input || value instanceof Date || typeof value === 'boolean'
                ? []
                : resolveMappedIcons(
                    value as string | number | readonly (string | number)[],
                    saved as readonly OverlayIconMapping[],
                    (await this.mappings?.mappings(field)) ?? [],
                    number(layer, 'maxIcons', 0, 0)
                  );
            if (icons.length) {
              const scale = placement.width / Math.max(1, layer.width);
              const iconSize = Math.max(
                1,
                Math.round(number(layer, 'iconSize', 80, 1) * scale)
              );
              const spacingX = Math.round(
                number(layer, 'spacingX', number(layer, 'spacing', 4)) * scale
              );
              const spacingY = Math.round(
                number(layer, 'spacingY', number(layer, 'spacing', 4)) * scale
              );
              const layout = string(layer, 'layout', 'horizontal');
              const columns = Math.max(
                1,
                Math.round(number(layer, 'gridColumns', 3, 1))
              );
              const opacity =
                number(
                  layer,
                  'iconOpacity',
                  number(layer, 'opacity', 100, 0, 100),
                  0,
                  100
                ) / 100;
              const images: string[] = [];
              for (let index = 0; index < icons.length; index++) {
                const icon = icons[index]!;
                const builtIn = mappedArtwork(layer, icon.iconPath, iconSize);
                if (!builtIn && !this.assets) continue;
                let pipeline = sharp(
                  builtIn ??
                    (await this.assets!.resolve(icon.iconPath, signal))
                ).resize(iconSize, iconSize, { fit: 'contain' });
                if (layer.properties.grayscale === true)
                  pipeline = pipeline.grayscale().tint('#ffffff');
                const bytes = await pipeline.png().toBuffer();
                const column =
                  layout === 'vertical'
                    ? 0
                    : layout === 'grid'
                      ? index % columns
                      : index;
                const row =
                  layout === 'vertical'
                    ? index
                    : layout === 'grid'
                      ? Math.floor(index / columns)
                      : 0;
                const x = column * (iconSize + spacingX);
                const y = row * (iconSize + spacingY);
                if (x >= placement.width || y >= placement.height) continue;
                images.push(
                  `<image href="data:image/png;base64,${bytes.toString('base64')}" x="${x}" y="${y}" width="${Math.min(iconSize, placement.width - x)}" height="${Math.min(iconSize, placement.height - y)}" preserveAspectRatio="xMidYMid meet" opacity="${opacity}"/>`
                );
              }
              if (images.length)
                input = Buffer.from(
                  `<svg xmlns="http://www.w3.org/2000/svg" width="${placement.width}" height="${placement.height}">${images.join('')}</svg>`
                );
            }
          }
        }
        if (!input) {
          skippedElements.push({
            templateId: template.id,
            elementId: layer.id,
            reason:
              layer.type === 'variable'
                ? 'Required variable data is unavailable.'
                : `Rendering for ${layer.type} elements is not available.`,
          });
          continue;
        }
        let renderedInput =
          layer.rotation === 0
            ? input
            : await sharp(input)
                .rotate(layer.rotation, {
                  background: { r: 0, g: 0, b: 0, alpha: 0 },
                })
                .png()
                .toBuffer();
        let dimensions = await sharp(renderedInput).metadata();
        if (
          (dimensions.width ?? 0) > width ||
          (dimensions.height ?? 0) > height
        ) {
          renderedInput = await sharp(renderedInput)
            .resize({ width, height, fit: 'inside' })
            .png()
            .toBuffer();
          dimensions = await sharp(renderedInput).metadata();
        }
        const overlayWidth = dimensions.width ?? placement.width;
        const overlayHeight = dimensions.height ?? placement.height;
        overlays.push({
          input: renderedInput,
          left: Math.max(
            0,
            Math.min(
              width - overlayWidth,
              placement.left + Math.round((placement.width - overlayWidth) / 2)
            )
          ),
          top: Math.max(
            0,
            Math.min(
              height - overlayHeight,
              placement.top + Math.round((placement.height - overlayHeight) / 2)
            )
          ),
        });
        rendered++;
      }
      if (rendered) appliedTemplateIds.push(template.id);
      else skippedTemplateIds.push(template.id);
    }
    this.assertActive(signal);
    const bytes = await sharp(poster)
      .composite(overlays)
      .webp({ quality: this.quality })
      .toBuffer();
    if (bytes.byteLength > this.maxOutputBytes)
      throw new Error(
        'The rendered poster exceeds the Plex upload size limit.'
      );
    return {
      bytes: new Uint8Array(bytes),
      appliedTemplateIds,
      skippedTemplateIds,
      skippedElements,
    };
  }

  private assertActive(signal?: AbortSignal): void {
    if (signal?.aborted)
      throw new DOMException('Overlay rendering was cancelled.', 'AbortError');
  }
}
