import assert from 'node:assert/strict';
import test from 'node:test';
import { Writable } from 'node:stream';

import { ZipFile } from 'yazl';
import sharp from 'sharp';
import {
  normalizeAgregarrAsset,
  readAgregarrArchive,
  translateAgregarrCollectionPoster,
  translateAgregarrOverlay,
  uniqueImportedName,
} from './agregarr-template-import.js';

test('crops transparent Agregarr raster padding without changing visual placement', async () => {
  const bytes = await sharp({
    create: {
      width: 100,
      height: 80,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      {
        input: {
          create: {
            width: 30,
            height: 20,
            channels: 4,
            background: { r: 255, g: 255, b: 255, alpha: 1 },
          },
        },
        left: 25,
        top: 15,
      },
    ])
    .png()
    .toBuffer();
  const normalized = await normalizeAgregarrAsset({
    archivePath: 'assets/icons/value.png',
    name: 'value.png',
    mimeType: 'image/png',
    bytes,
  });
  assert.deepEqual(normalized.crop, {
    sourceWidth: 100,
    sourceHeight: 80,
    left: 25,
    top: 15,
    width: 30,
    height: 20,
  });
  const metadata = await sharp(normalized.asset.bytes).metadata();
  assert.deepEqual(
    { width: metadata.width, height: metadata.height },
    { width: 30, height: 20 }
  );
});

const zip = async (
  manifest: Record<string, unknown>,
  assets: Readonly<Record<string, Uint8Array>> = {}
): Promise<Uint8Array> => {
  const archive = new ZipFile();
  archive.addBuffer(
    Buffer.from(JSON.stringify(manifest)),
    'template.json'
  );
  for (const [name, bytes] of Object.entries(assets))
    archive.addBuffer(Buffer.from(bytes), name);
  archive.end();
  const chunks: Buffer[] = [];
  await new Promise<void>((resolve, reject) => {
    archive.outputStream
      .pipe(
        new Writable({
          write(chunk: Buffer, _encoding, callback) {
            chunks.push(chunk);
            callback();
          },
        })
      )
      .once('finish', resolve)
      .once('error', reject);
  });
  return new Uint8Array(Buffer.concat(chunks));
};

test('recovers referenced Agregarr system icons that are not embedded in exports', async () => {
  const archive = await readAgregarrArchive(
    await zip({
      version: '1.0',
      name: 'IMDb rating',
      type: 'rating',
      templateData: {
        width: 1000,
        height: 1500,
        elements: [
          {
            id: 'imdb-logo',
            type: 'svg',
            x: 16,
            y: 238,
            width: 130,
            height: 130,
            properties: {
              iconPath:
                '/api/v1/posters/icons/system/plain-imdb.svg',
            },
          },
        ],
      },
    }),
    'overlay'
  );
  assert.equal(archive.assets.length, 1);
  assert.equal(archive.assets[0]?.name, 'plain-imdb.svg');
  assert.equal(archive.assets[0]?.mimeType, 'image/svg+xml');
  assert.match(
    new TextDecoder().decode(archive.assets[0]?.bytes),
    /fill="#F5C518"/
  );
  const translated = translateAgregarrOverlay(
    archive,
    new Map([
      [
        'plain-imdb.svg',
        {
          id: 'stored-imdb',
          name: 'plain-imdb.svg',
          collectionPath:
            '/api/posters/collections/assets/stored-imdb',
          overlayPath: 'asset://stored-imdb',
          kind: 'svg',
        },
      ],
    ])
  );
  assert.equal(
    translated.design.elements[0]?.properties.iconPath,
    'asset://stored-imdb'
  );
});

test('discovers new referenced icons outside Agregarr canonical asset folders', async () => {
  const customSvg = new TextEncoder().encode(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M2 2h20v20H2z"/></svg>'
  );
  const archive = await readAgregarrArchive(
    await zip(
      {
        version: '1.0',
        name: 'Third-party icon',
        type: 'generic',
        templateData: {
          elements: [
            {
              id: 'custom-icon',
              type: 'svg',
              properties: { iconPath: '/plugins/custom/new-icon.svg' },
            },
          ],
        },
      },
      { 'plugins/custom/new-icon.svg': customSvg }
    ),
    'overlay'
  );

  assert.equal(archive.assets.length, 1);
  assert.equal(archive.assets[0]?.archivePath, 'plugins/custom/new-icon.svg');
  assert.equal(archive.assets[0]?.name, 'new-icon.svg');
  assert.deepEqual(archive.assets[0]?.bytes, customSvg);
});

test('reads and translates an Agregarr 2.0 collection-poster archive', async () => {
  const archive = await readAgregarrArchive(
    await zip(
      {
        version: '2.0',
        name: 'Legacy Poster',
        description: 'Imported',
        templateData: {
          width: 1000,
          height: 1500,
          background: {
            type: 'gradient',
            color: '#112233',
            secondaryColor: '#445566',
            intensity: 70,
            useSourceColors: false,
          },
          elements: [
            {
              id: 'logo',
              layerOrder: 0,
              type: 'svg',
              x: 10,
              y: 20,
              width: 200,
              height: 100,
              properties: {
                iconPath: '/api/v1/posters/icons/user/logo.svg',
              },
            },
          ],
        },
      },
      {
        'assets/icons/logo.svg': Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"></svg>'
        ),
      }
    ),
    'collection-poster'
  );
  assert.equal(archive.kind, 'collection-poster');
  assert.equal(archive.assets.length, 1);
  const translated = translateAgregarrCollectionPoster(
    archive,
    new Map([
      [
        'logo.svg',
        {
          id: 'asset-1',
          name: 'background.png',
          collectionPath: '/api/posters/collections/assets/asset-1',
          overlayPath: 'asset://asset-1',
          kind: 'svg',
        },
      ],
    ])
  );
  assert.equal(translated.design.migrated, true);
  assert.deepEqual(translated.design.elements[0]?.properties, {
    iconPath: '/api/posters/collections/assets/asset-1',
    assetId: 'asset-1',
    assetName: 'background.png',
  });
});

test('reads and translates an Agregarr 1.0 overlay and preserves conditions', async () => {
  const archive = await readAgregarrArchive(
    await zip({
      version: '1.0',
      name: 'Legacy Overlay',
      type: 'video',
      templateData: {
        elements: [
          {
            id: 'resolution',
            type: 'variable',
            x: 20,
            y: 30,
            width: 200,
            height: 80,
            properties: {
              segments: [{ type: 'variable', field: 'resolution' }],
            },
          },
        ],
      },
      applicationCondition: {
        sections: [
          {
            rules: [{ field: 'resolution', operator: 'exists', value: true }],
          },
        ],
      },
    }),
    'overlay'
  );
  const translated = translateAgregarrOverlay(archive, new Map());
  assert.equal(translated.design.elements[0]?.type, 'variable');
  assert.equal(
    translated.condition?.sections[0]?.rules[0]?.field,
    'resolution'
  );
});

test('preserves the downloaded Next episode overlay geometry and visual properties', async () => {
  const archive = await readAgregarrArchive(
    await zip(
      {
        name: 'Next episode',
        description:
          'Small banner showing date of the next episode within 7 days',
        type: 'status',
        version: '1.0',
        templateData: {
          width: 1000,
          height: 1500,
          elements: [
            {
              id: 'tile',
              layerOrder: 0,
              type: 'tile',
              x: -10.389610389610453,
              y: -5,
              width: 337,
              height: 179,
              properties: {
                fillColor: '#000000',
                fillOpacity: 70,
                borderColor: '#FFFFFF',
                borderWidth: 0,
                lockCorners: false,
                borderRadiusTopLeft: 10,
                borderRadiusTopRight: 10,
                borderRadiusBottomLeft: 10,
                borderRadiusBottomRight: 100,
              },
            },
            {
              id: 'date',
              layerOrder: 2,
              type: 'variable',
              x: -51,
              y: 58,
              width: 400,
              height: 120,
              properties: {
                segments: [
                  {
                    type: 'variable',
                    field: 'nextEpisodeAirDate',
                    format: 'MMM DD',
                  },
                ],
                fontSize: 70,
                fontFamily: 'Inter',
                fontWeight: 'bold',
                fontStyle: 'normal',
                color: '#FFFFFF',
                textAlign: 'center',
                opacity: 100,
              },
            },
            {
              id: 'next',
              layerOrder: 2,
              type: 'raster',
              x: -301,
              y: -388.9610389610389,
              width: 900,
              height: 900,
              properties: {
                imagePath:
                  '/api/v1/posters/icons/user/next-episode.png',
                opacity: 100,
              },
            },
          ],
        },
        applicationCondition: {
          sections: [
            {
              rules: [
                {
                  field: 'daysUntilNextEpisode',
                  operator: 'lte',
                  value: 7,
                },
                { field: 'mediaType', operator: 'eq', value: 'show' },
              ],
            },
          ],
        },
      },
      {
        'assets/icons/next-episode.png': new Uint8Array([
          0x89, 0x50, 0x4e, 0x47,
        ]),
      }
    ),
    'overlay'
  );
  const translated = translateAgregarrOverlay(
    archive,
    new Map([
      [
        'next-episode.png',
        {
          id: 'asset-id',
          name: '59da0c15-3dad-418c-aec0-0d0e324988a5.png',
          collectionPath: '/api/posters/collections/assets/asset-id',
          overlayPath: 'asset://asset-id',
          kind: 'raster',
        },
      ],
    ])
  );
  assert.deepEqual(
    translated.design.elements.map(
      ({ id, name: _name, rotation, ...layer }) => ({
        id,
        rotation,
        ...layer,
      })
    ),
    [
      {
        id: 'tile',
        rotation: 0,
        layerOrder: 0,
        type: 'tile',
        x: -10.389610389610453,
        y: -5,
        width: 337,
        height: 179,
        properties: {
          fillColor: '#000000',
          fillOpacity: 70,
          borderColor: '#FFFFFF',
          borderWidth: 0,
          lockCorners: false,
          borderRadiusTopLeft: 10,
          borderRadiusTopRight: 10,
          borderRadiusBottomLeft: 10,
          borderRadiusBottomRight: 100,
        },
      },
      {
        id: 'date',
        rotation: 0,
        layerOrder: 2,
        type: 'variable',
        x: -51,
        y: 58,
        width: 400,
        height: 120,
        properties: {
          segments: [
            {
              type: 'variable',
              field: 'nextEpisodeAirDate',
              format: 'MMM DD',
            },
          ],
          fontSize: 70,
          fontFamily: 'Inter',
          fontWeight: 'bold',
          fontStyle: 'normal',
          color: '#FFFFFF',
          textAlign: 'center',
          opacity: 100,
        },
      },
      {
        id: 'next',
        rotation: 0,
        layerOrder: 2,
        type: 'raster',
        x: -301,
        y: -388.9610389610389,
        width: 900,
        height: 900,
        properties: {
          imagePath: 'asset://asset-id',
          opacity: 100,
          assetId: 'asset-id',
          assetName: '59da0c15-3dad-418c-aec0-0d0e324988a5.png',
        },
      },
    ]
  );
  assert.deepEqual(translated.condition?.sections[0]?.rules, [
    { field: 'daysUntilNextEpisode', operator: 'lte', value: 7 },
    { field: 'mediaType', operator: 'eq', value: 'show' },
  ]);
  const cropped = translateAgregarrOverlay(
    archive,
    new Map([
      [
        'next-episode.png',
        {
          id: 'asset-id',
          name: 'next-episode.png',
          collectionPath: '/api/posters/collections/assets/asset-id',
          overlayPath: 'asset://asset-id',
          kind: 'raster',
          crop: {
            sourceWidth: 750,
            sourceHeight: 500,
            left: 229,
            top: 217,
            width: 304,
            height: 42,
          },
        },
      ],
    ])
  );
  const raster = cropped.design.elements.find((layer) => layer.type === 'raster');
  assert.ok(raster);
  assert.ok(Math.abs(raster.x - -26.2) < 0.001);
  assert.ok(Math.abs(raster.y - 21.4389610389611) < 0.001);
  assert.ok(Math.abs(raster.width - 364.8) < 0.001);
  assert.ok(Math.abs(raster.height - 50.4) < 0.001);
  assert.equal(raster.name, 'Next episode image');
});

test('rejects mismatched archive kinds and unsupported versions', async () => {
  await assert.rejects(
    readAgregarrArchive(
      await zip({
        version: '1.0',
        name: 'Overlay',
        templateData: {},
      }),
      'collection-poster'
    ),
    /overlay archive/
  );
  await assert.rejects(
    readAgregarrArchive(
      await zip({
        version: '9.0',
        name: 'Future',
        templateData: {},
      })
    ),
    /not supported/
  );
});

test('renames conflicts without overwriting Vynode templates', () => {
  assert.deepEqual(
    uniqueImportedName('Resolution', ['Resolution', 'Resolution (1)']),
    { name: 'Resolution (2)', renamed: true }
  );
});
