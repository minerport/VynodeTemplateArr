import assert from 'node:assert/strict';
import test from 'node:test';

import type { OverlayTemplateSummary } from '@vynode/contracts';
import sharp from 'sharp';

import { NativeOverlayRenderer } from './renderer.js';

const template = (
  overrides: Partial<OverlayTemplateSummary> = {}
): OverlayTemplateSummary => ({
  id: 'rating',
  name: 'Rating',
  description: 'Rating banner',
  type: 'rating',
  tags: [],
  enabled: true,
  displayOrder: 1,
  elementCount: 3,
  conditionSummary: 'rating >= 8',
  accent: '#ff0000',
  condition: {
    sections: [{ rules: [{ field: 'rating', operator: 'gte', value: 8 }] }],
  },
  design: {
    width: 1000,
    height: 1500,
    elements: [
      {
        id: 'tile',
        layerOrder: 0,
        type: 'tile',
        x: 50,
        y: 50,
        width: 900,
        height: 180,
        rotation: 0,
        name: 'Tile',
        properties: {
          fillColor: '#ff0000',
          fillOpacity: 100,
          borderRadiusTopLeft: 20,
          borderRadiusTopRight: 10,
          borderRadiusBottomRight: 30,
          borderRadiusBottomLeft: 0,
        },
      },
      {
        id: 'text',
        layerOrder: 1,
        type: 'text',
        x: 100,
        y: 80,
        width: 800,
        height: 100,
        rotation: 0,
        name: 'Text',
        properties: {
          text: 'FEATURED',
          fontSize: 70,
          fontFamily: 'Arial',
          fontWeight: 'bold',
          fontStyle: 'normal',
          color: '#ffffff',
          textAlign: 'center',
        },
      },
      {
        id: 'variable',
        layerOrder: 2,
        type: 'variable',
        x: 100,
        y: 250,
        width: 800,
        height: 100,
        rotation: 8,
        name: 'Variable',
        properties: {
          segments: [
            { type: 'text', value: 'IMDb ' },
            { type: 'variable', field: 'imdbRating' },
          ],
          fontSize: 60,
          fontFamily: 'Arial',
          fontWeight: 'normal',
          fontStyle: 'italic',
          color: '#ffffff',
          textAlign: 'left',
        },
      },
    ],
  },
  ...overrides,
});

const basePoster = () =>
  sharp({
    create: {
      width: 500,
      height: 750,
      channels: 3,
      background: '#111111',
    },
  })
    .jpeg()
    .toBuffer();

test('renders ordered tile, text, and variable layers to bounded WebP output', async () => {
  const result = await new NativeOverlayRenderer().render(
    await basePoster(),
    [template()],
    { rating: 8.5, imdbRating: 8.4 }
  );
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 500);
  assert.equal(metadata.height, 750);
  assert.deepEqual(result.appliedTemplateIds, ['rating']);
  assert.deepEqual(result.skippedTemplateIds, []);
  assert.deepEqual(result.skippedElements, []);
});

test('does not render hidden layers or report them as failures', async () => {
  const hidden = template({
    design: {
      ...template().design,
      elements: template().design.elements.map((layer) => ({
        ...layer,
        properties: { ...layer.properties, hidden: true },
      })),
    },
  });
  const result = await new NativeOverlayRenderer().render(
    await basePoster(),
    [hidden],
    { rating: 8.5, imdbRating: 8.4 }
  );
  assert.deepEqual(result.appliedTemplateIds, []);
  assert.deepEqual(result.skippedTemplateIds, ['rating']);
  assert.deepEqual(result.skippedElements, []);
});

test('skips the entire template when any rendered variable is missing', async () => {
  const hidden = await new NativeOverlayRenderer().render(
    await basePoster(),
    [template({ condition: { sections: [] } })],
    { rating: 8.5 }
  );
  assert.deepEqual(hidden.appliedTemplateIds, []);
  assert.deepEqual(hidden.skippedTemplateIds, ['rating']);
  assert.deepEqual(hidden.skippedElements, []);

  const withFallback = template({
    condition: { sections: [] },
    design: {
      ...template().design,
      elements: template().design.elements.map((layer) =>
        layer.id === 'variable'
          ? {
              ...layer,
              properties: {
                ...layer.properties,
                missingValueBehavior: 'fallback',
                missingValueFallback: 'UNRATED',
              },
            }
          : layer
      ),
    },
  });
  const fallback = await new NativeOverlayRenderer().render(
    await basePoster(),
    [withFallback],
    { rating: 8.5 }
  );
  assert.deepEqual(fallback.appliedTemplateIds, []);
  assert.deepEqual(fallback.skippedTemplateIds, ['rating']);
});

test('renders a text layer background fill and rounded shape with the saved text', async () => {
  const filled = template({
    condition: { sections: [] },
    design: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'filled-text',
          layerOrder: 0,
          type: 'text',
          x: 100,
          y: 100,
          width: 400,
          height: 200,
          rotation: 0,
          name: 'Filled text',
          properties: {
            text: '',
            fontSize: 60,
            fillColor: '#00ff00',
            fillOpacity: 100,
            lockCorners: true,
            borderRadiusTopLeft: 40,
          },
        },
      ],
    },
  });
  const result = await new NativeOverlayRenderer().render(
    await basePoster(),
    [filled],
    {}
  );
  const pixel = await sharp(result.bytes)
    .extract({ left: 150, top: 100, width: 1, height: 1 })
    .raw()
    .toBuffer();
  assert.ok(pixel[1]! > 200, 'the saved text fill should render green');
  assert.ok(pixel[0]! < 40);
  assert.ok(pixel[2]! < 40);
});

test('skips disabled, condition-mismatched, missing-variable, and unsupported layers', async () => {
  const missingVariable = template({
    id: 'missing-variable',
    design: {
      width: 1000,
      height: 1500,
      elements: [template().design.elements[2]!],
    },
  });
  delete missingVariable.condition;
  const raster = template({
    id: 'raster',
    design: {
      width: 1000,
      height: 1500,
      elements: [
        {
          ...template().design.elements[0]!,
          id: 'image',
          type: 'raster',
          properties: { imagePath: '/asset.png' },
        },
      ],
    },
  });
  delete raster.condition;
  const result = await new NativeOverlayRenderer().render(
    await basePoster(),
    [
      template({ id: 'disabled', enabled: false }),
      template({ id: 'mismatch' }),
      missingVariable,
      raster,
    ],
    { rating: 2 }
  );
  assert.deepEqual(result.appliedTemplateIds, []);
  assert.deepEqual(result.skippedTemplateIds, [
    'disabled',
    'mismatch',
    'missing-variable',
    'raster',
  ]);
  assert.equal(result.skippedElements.length, 1);
});

test('rejects cancellation and output exceeding the configured Plex limit', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new NativeOverlayRenderer().render(
      await basePoster(),
      [template()],
      { rating: 9 },
      controller.signal
    ),
    /cancelled/
  );
  await assert.rejects(
    new NativeOverlayRenderer({ maxOutputBytes: 1 }).render(
      await basePoster(),
      [],
      {}
    ),
    /upload size limit/
  );
});

test('renders raster and SVG assets only through the injected resolver', async () => {
  const paths: string[] = [];
  const asset = await sharp({
    create: {
      width: 40,
      height: 40,
      channels: 4,
      background: { r: 0, g: 255, b: 0, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const rasterTemplate = template({
    id: 'assets',
    condition: {
      sections: [],
    },
    design: {
      width: 1000,
      height: 1500,
      elements: [
        {
          ...template().design.elements[0]!,
          id: 'raster',
          type: 'raster',
          properties: { imagePath: 'asset://raster', opacity: 50 },
        },
        {
          ...template().design.elements[0]!,
          id: 'svg',
          layerOrder: 1,
          type: 'svg',
          properties: {
            iconType: 'custom-icon',
            iconPath: 'asset://svg',
            grayscale: true,
            opacity: 75,
          },
        },
      ],
    },
  });
  const result = await new NativeOverlayRenderer({
    assets: {
      async resolve(path) {
        paths.push(path);
        return asset;
      },
    },
  }).render(await basePoster(), [rasterTemplate], {});
  assert.deepEqual(paths, ['asset://raster', 'asset://svg']);
  assert.deepEqual(result.appliedTemplateIds, ['assets']);
  assert.deepEqual(result.skippedElements, []);
});

test('renders mapped icons with saved precedence, current fallback, grid layout, and limits', async () => {
  const resolvedPaths: string[] = [];
  const icon = await sharp({
    create: {
      width: 20,
      height: 20,
      channels: 4,
      background: { r: 0, g: 0, b: 255, alpha: 1 },
    },
  })
    .png()
    .toBuffer();
  const mapped = template({
    id: 'mapped',
    design: {
      width: 1000,
      height: 1500,
      elements: [
        {
          ...template().design.elements[0]!,
          id: 'mapped-icons',
          type: 'mapped-icon',
          properties: {
            field: 'audioLanguages',
            mappings: [{ value: 'English', iconPath: 'asset://saved-english' }],
            layout: 'grid',
            iconSize: 80,
            spacingX: 10,
            spacingY: 12,
            gridColumns: 2,
            maxIcons: 2,
            grayscale: true,
            opacity: 80,
          },
        },
      ],
    },
  });
  delete mapped.condition;
  const result = await new NativeOverlayRenderer({
    assets: {
      async resolve(path) {
        resolvedPaths.push(path);
        return icon;
      },
    },
    mappings: {
      async mappings() {
        return [
          { value: 'English', iconPath: 'asset://current-english' },
          { value: 'German', iconPath: 'asset://current-german' },
          { value: 'French', iconPath: 'asset://current-french' },
        ];
      },
    },
  }).render(await basePoster(), [mapped], {
    audioLanguages: ['English', 'German', 'French'],
  });
  assert.deepEqual(resolvedPaths, [
    'asset://saved-english',
    'asset://current-german',
  ]);
  assert.deepEqual(result.appliedTemplateIds, ['mapped']);
  assert.deepEqual(result.skippedElements, []);
});

test('renders a transparent bundled SVG icon and live value without an asset resolver', async () => {
  const dynamic = template({
    id: 'dynamic-icon',
    condition: { sections: [] },
    design: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'rating-icon',
          layerOrder: 0,
          type: 'mapped-icon',
          x: 100,
          y: 100,
          width: 400,
          height: 300,
          rotation: 0,
          name: 'Rating icon and value',
          properties: {
            field: 'imdbRating',
            systemIcon: 'rating',
            mappings: [],
            iconSize: 120,
            iconColor: '#ff0000',
            iconOpacity: 100,
            showValue: true,
            valueColor: '#00ff00',
            valueOpacity: 100,
            valueFontSize: 54,
            valueGap: 16,
            valueAlign: 'center',
          },
        },
      ],
    },
  });
  const result = await new NativeOverlayRenderer().render(
    await basePoster(),
    [dynamic],
    { imdbRating: 8.4 }
  );
  assert.deepEqual(result.appliedTemplateIds, ['dynamic-icon']);
  assert.deepEqual(result.skippedElements, []);
  const colors = await sharp(result.bytes)
    .extract({ left: 50, top: 50, width: 200, height: 150 })
    .raw()
    .toBuffer();
  assert.ok(
    colors.some((value, index) => index % 3 === 0 && value > 150),
    'the configured icon color should be present'
  );
  assert.ok(
    colors.some((value, index) => index % 3 === 1 && value > 150),
    'the configured live-value color should be present'
  );
});

test('renders a bundled date icon using the live Plex date value', async () => {
  const dynamic = template({
    id: 'date-added-icon',
    condition: { sections: [] },
    design: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'date-added',
          layerOrder: 0,
          type: 'mapped-icon',
          x: 100,
          y: 100,
          width: 500,
          height: 300,
          rotation: 0,
          name: 'Date added to Plex',
          properties: {
            field: 'dateAdded',
            systemIcon: 'calendar',
            mappings: [],
            iconSize: 100,
            iconColor: '#ff0000',
            iconBackgroundColor: '#0000ff',
            iconBackgroundOpacity: 100,
            iconBackgroundShape: 'circle',
            iconBackgroundPadding: 12,
            showValue: true,
            valueColor: '#00ff00',
            valueFontSize: 46,
          },
        },
      ],
    },
  });
  const result = await new NativeOverlayRenderer().render(
    await basePoster(),
    [dynamic],
    { dateAdded: new Date('2026-07-27T12:00:00.000Z') }
  );
  assert.deepEqual(result.appliedTemplateIds, ['date-added-icon']);
  assert.deepEqual(result.skippedElements, []);
  const colors = await sharp(result.bytes)
    .extract({ left: 50, top: 50, width: 250, height: 150 })
    .raw()
    .toBuffer();
  assert.ok(
    colors.some((value, index) => index % 3 === 2 && value > 150),
    'the configured icon background should be present'
  );
  assert.ok(
    colors.some((value, index) => index % 3 === 1 && value > 150),
    'the formatted date value should be rendered'
  );
});

test('renders library shapes and icons through the production application path', async () => {
  const visual = template({
    id: 'shape-icon-parity',
    condition: { sections: [] },
    design: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'shape',
          layerOrder: 0,
          type: 'shape',
          x: 80,
          y: 80,
          width: 500,
          height: 180,
          rotation: 12,
          name: 'Soft plate',
          properties: {
            shapeId: 'soft-plate',
            fillColor: '#ff0000',
            fillOpacity: 75,
            borderColor: '#00ff00',
            borderOpacity: 100,
            borderWidth: 8,
            outlineStyle: 'dashed',
            flipX: true,
            preserveAspectRatio: false,
          },
        },
        {
          id: 'icon',
          layerOrder: 1,
          type: 'icon',
          x: 200,
          y: 300,
          width: 180,
          height: 180,
          rotation: -8,
          name: 'Trailer placeholder',
          properties: {
            systemIcon: 'concept-placeholder',
            iconColor: '#0000ff',
            iconSoftColor: '#00ff00',
            iconAccentColor: '#ff0000',
            iconStyle: 'badge',
            iconBadgeColor: '#ffff00',
            iconBadgeOpacity: 45,
            iconBadgeBorderColor: '#ffffff',
            iconBadgeBorderWidth: 1,
            iconOpacity: 100,
            iconStrokeWidth: 3,
            iconStrokeStyle: 'dashed',
            flipY: true,
          },
        },
      ],
    },
  });
  const result = await new NativeOverlayRenderer().render(
    await basePoster(),
    [visual],
    {}
  );
  assert.deepEqual(result.appliedTemplateIds, ['shape-icon-parity']);
  assert.deepEqual(result.skippedElements, []);
  const metadata = await sharp(result.bytes).metadata();
  assert.equal(metadata.width, 500);
  assert.equal(metadata.height, 750);
});
