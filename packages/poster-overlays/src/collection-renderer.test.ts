import assert from 'node:assert/strict';
import test from 'node:test';

import type { CollectionPosterDesign } from '@vynode/contracts';
import sharp from 'sharp';

import { NativeCollectionPosterRenderer } from './collection-renderer.js';

const image = (color: string): Uint8Array =>
  new TextEncoder().encode(
    `<svg xmlns="http://www.w3.org/2000/svg" width="300" height="450"><rect width="300" height="450" fill="${color}"/></svg>`
  );

const design = (): CollectionPosterDesign => ({
  width: 1000,
  height: 1500,
  migrated: true,
  background: {
    type: 'radial',
    color: '#101820',
    secondaryColor: '#000000',
    intensity: 60,
    useSourceColors: true,
  },
  elements: [
    {
      id: 'grid',
      layerOrder: 0,
      type: 'content-grid',
      x: 100,
      y: 100,
      width: 800,
      height: 800,
      rotation: 0,
      name: 'Grid',
      properties: { columns: 2, rows: 1, spacing: 20, cornerRadius: 18 },
    },
    {
      id: 'title',
      layerOrder: 1,
      type: 'text',
      x: 100,
      y: 1000,
      width: 800,
      height: 220,
      rotation: 0,
      name: 'Title',
      properties: {
        elementType: 'collection-title',
        fontSize: 86,
        fontFamily: 'Arial',
        fontWeight: 'bold',
        color: '#ffffff',
        textAlign: 'center',
      },
    },
    {
      id: 'badge',
      layerOrder: 2,
      type: 'svg',
      x: 400,
      y: 1250,
      width: 200,
      height: 160,
      rotation: 5,
      name: 'Badge',
      properties: { assetId: 'badge-id', grayscale: false },
    },
  ],
});

test('renders source colors, collection items, text, and stored assets to Plex-safe WebP', async () => {
  const resolved: string[] = [];
  const renderer = new NativeCollectionPosterRenderer({
    assets: {
      async resolve(id) {
        resolved.push(id);
        return image('#f3ad32');
      },
    },
  });
  const report = await renderer.render(design(), {
    title: 'Top Animation',
    sourceType: 'trakt',
    sourceColors: {
      trakt: {
        primaryColor: '#ed1c24',
        secondaryColor: '#3a090b',
        textColor: '#ffffff',
      },
    },
    itemPosters: [image('#ff0000'), image('#00ff00')],
  });
  assert.deepEqual(resolved, ['badge-id']);
  assert.deepEqual(report.renderedLayerIds, ['grid', 'title', 'badge']);
  assert.deepEqual(report.skippedLayers, []);
  const metadata = await sharp(report.bytes).metadata();
  assert.equal(metadata.format, 'webp');
  assert.equal(metadata.width, 1000);
  assert.equal(metadata.height, 1500);
  assert.ok(report.bytes.byteLength < 11 * 1024 * 1024);
});

test('reports unavailable optional context without failing the whole poster', async () => {
  const input = design();
  input.elements = [
    input.elements[0]!,
    {
      ...input.elements[2]!,
      properties: {},
    },
    {
      ...input.elements[2]!,
      id: 'person',
      type: 'person',
      properties: {},
    },
  ];
  const report = await new NativeCollectionPosterRenderer().render(input, {
    title: 'Empty',
  });
  assert.equal(report.renderedLayerIds.length, 0);
  assert.deepEqual(
    report.skippedLayers.map((item) => item.id),
    ['grid', 'badge', 'person']
  );
  assert.equal((await sharp(report.bytes).metadata()).format, 'webp');
});

test('propagates cancellation and enforces the configured output limit', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    new NativeCollectionPosterRenderer().render(
      design(),
      { title: 'Cancelled' },
      controller.signal
    ),
    /cancelled/i
  );
  await assert.rejects(
    new NativeCollectionPosterRenderer({ maxOutputBytes: 1 }).render(design(), {
      title: 'Too large',
      itemPosters: [image('#ff0000')],
    }),
    /upload size limit/
  );
});
