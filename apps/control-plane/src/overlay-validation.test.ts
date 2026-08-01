import assert from 'node:assert/strict';
import test from 'node:test';
import type {
  CollectionPosterDesign,
  OverlayTemplateSummary,
  PosterEditorAsset,
} from '@vynode/contracts';
import {
  validateCollectionPosterAssets,
  validateCollectionPosterInput,
  validateOverlayTemplateInput,
  validateSourceColorsImport,
} from './app.js';

type Input = Omit<OverlayTemplateSummary, 'id' | 'displayOrder' | 'elementCount'>;

const validInput = (): Input => ({
  name: 'Resolution',
  description: 'Resolution badge',
  type: 'video',
  tags: ['quality'],
  enabled: true,
  conditionSummary: 'Resolution exists',
  accent: '#f3ad32',
  design: {
    width: 1000,
    height: 1500,
    elements: [{
      id: 'value',
      layerOrder: 0,
      type: 'variable',
      x: 20,
      y: 20,
      width: 200,
      height: 80,
      rotation: 0,
      name: 'Value',
      properties: { segments: [{ type: 'variable', field: 'resolution' }] },
    }],
  },
  condition: { sections: [{ rules: [{ field: 'resolution', operator: 'exists', value: true }] }] },
});

test('overlay template validation accepts a complete persisted design', () => {
  assert.equal(validateOverlayTemplateInput(validInput()), undefined);
});

test('overlay template validation rejects duplicate layer ids and invalid geometry', () => {
  const duplicate = validInput();
  const firstLayer = duplicate.design.elements[0]!;
  duplicate.design = { ...duplicate.design, elements: [...duplicate.design.elements, { ...firstLayer }] };
  assert.match(validateOverlayTemplateInput(duplicate) ?? '', /unique identifier/);

  const invalidGeometry = validInput();
  invalidGeometry.design = { ...invalidGeometry.design, elements: [{ ...invalidGeometry.design.elements[0]!, width: 0 }] };
  assert.match(validateOverlayTemplateInput(invalidGeometry) ?? '', /positive width and height/);
});

test('overlay template validation rejects malformed conditions', () => {
  const input = validInput();
  input.condition = { sections: [{ rules: [] }] };
  assert.match(validateOverlayTemplateInput(input) ?? '', /cannot be empty/);
});

const validCollectionPosterDesign = (): CollectionPosterDesign => ({
  width: 1000,
  height: 1500,
  migrated: true,
  background: {
    type: 'radial',
    color: '#f3ad32',
    secondaryColor: '#17262d',
    intensity: 50,
    useSourceColors: false,
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
      properties: {
        columns: 3,
        rows: 2,
        spacing: 24,
        cornerRadius: 20,
      },
    },
  ],
});

test('collection poster validation accepts bounded designs', () => {
  assert.equal(
    validateCollectionPosterInput({
      name: 'Editorial',
      description: 'Six item grid',
      design: validCollectionPosterDesign(),
    }),
    undefined
  );
});

test('collection poster validation rejects unsafe geometry and properties', () => {
  const baseOutside = validCollectionPosterDesign();
  const outsideCanvas: CollectionPosterDesign = {
    ...baseOutside,
    elements: [{ ...baseOutside.elements[0]!, x: 900, width: 800 }],
  };
  assert.match(
    validateCollectionPosterInput({
      name: 'Outside',
      description: '',
      design: outsideCanvas,
    }) ?? '',
    /invalid geometry/
  );

  const baseGrid = validCollectionPosterDesign();
  const invalidGrid: CollectionPosterDesign = {
    ...baseGrid,
    elements: [{
      ...baseGrid.elements[0]!,
      properties: {
        ...baseGrid.elements[0]!.properties,
        columns: 0,
      },
    }],
  };
  assert.match(
    validateCollectionPosterInput({
      name: 'Grid',
      description: '',
      design: invalidGrid,
    }) ?? '',
    /invalid layout/
  );
});

test('source-color import normalizes provider keys and exact hex colors', () => {
  const result = validateSourceColorsImport({
    schema: 'vynode.source-colors',
    version: 1,
    sourceColors: {
      ' Trakt ': {
        primaryColor: '#ED1C24',
        secondaryColor: '#3A090B',
        textColor: '#FFFFFF',
      },
    },
  });
  assert.ok('colors' in result);
  assert.deepEqual(result.colors.trakt, {
    primaryColor: '#ed1c24',
    secondaryColor: '#3a090b',
    textColor: '#ffffff',
  });
});

test('source-color import rejects unsafe names, collisions, and malformed colors', () => {
  const unsafe = validateSourceColorsImport({
    sourceColors: {
      __proto__: {
        primaryColor: '#ffffff',
        secondaryColor: '#000000',
        textColor: '#ffffff',
      },
    },
  });
  assert.ok('error' in unsafe);

  const collision = validateSourceColorsImport({
    sourceColors: {
      Trakt: {
        primaryColor: '#ffffff',
        secondaryColor: '#000000',
        textColor: '#ffffff',
      },
      ' trakt ': {
        primaryColor: '#ffffff',
        secondaryColor: '#000000',
        textColor: '#ffffff',
      },
    },
  });
  assert.ok('error' in collision);

  const malformed = validateSourceColorsImport({
    version: '2.0',
    sourceColors: {
      trakt: {
        primaryColor: 'red',
        secondaryColor: '#000000',
        textColor: '#ffffff',
      },
    },
  });
  assert.ok('error' in malformed);
});

test('collection poster asset references must resolve with the expected kind and URL', () => {
  const asset: PosterEditorAsset = {
    id: '600b8da5-6837-4689-87af-09f601f33d47',
    name: 'badge.svg',
    mimeType: 'image/svg+xml',
    size: 120,
    kind: 'svg',
    createdAt: '2026-07-26T00:00:00.000Z',
  };
  const design = validCollectionPosterDesign();
  const layer = design.elements[0]!;
  const withSvg: CollectionPosterDesign = {
    ...design,
    elements: [
      {
        ...layer,
        type: 'svg',
        properties: {
          assetId: asset.id,
          iconPath: `/api/posters/collections/assets/${asset.id}`,
        },
      },
    ],
  };
  assert.equal(validateCollectionPosterAssets(withSvg, [asset]), undefined);
  assert.match(
    validateCollectionPosterAssets(
      {
        ...withSvg,
        elements: [
          {
            ...withSvg.elements[0]!,
            properties: {
              ...withSvg.elements[0]!.properties,
              iconPath: 'https://untrusted.example/icon.svg',
            },
          },
        ],
      },
      [asset]
    ) ?? '',
    /invalid asset reference/
  );
  assert.match(
    validateCollectionPosterAssets(
      {
        ...withSvg,
        elements: [{ ...withSvg.elements[0]!, type: 'raster' }],
      },
      [asset]
    ) ?? '',
    /wrong asset type/
  );
});
