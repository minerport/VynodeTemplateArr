import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { PlexHttpTransport, type PlexServerConfiguration } from '@vynode/media-servers';
import { VynodeSqliteStorage } from '@vynode/storage';
import { ProductionCollectionPosterStore } from './production-collection-posters.js';
import { ProductionPlexOverlayExecutor } from './production-plex-overlays.js';
import { ProductionPosterOverlayStore } from './production-poster-overlays.js';

test('production overlay executor discovers Plex items and exposes originating service context', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vynode-plex-overlays-'));
  const requests: string[] = [];
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  const server = createServer((request, response) => {
    requests.push(`${request.method} ${request.url}`);
    if (request.url?.startsWith('/library/sections/1/all')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ MediaContainer: { Metadata: [{ ratingKey: '101' }] } }));
      return;
    }
    if (request.url?.startsWith('/library/metadata/101')) {
      response.setHeader('content-type', 'application/json');
      response.end(JSON.stringify({ MediaContainer: { Metadata: [{ ratingKey: '101', librarySectionID: '1', title: 'Example', year: 2026, studio: 'Netflix', thumb: '/library/metadata/101/thumb/1', Guid: [{ id: 'tmdb://10' }, { id: 'tvdb://20' }, { id: 'imdb://tt1234567' }], Rating: [{ image: 'imdb://image.rating', value: 7.9 }], Media: [{ width: 1920, height: 1080, videoResolution: '1080', Part: [{ Stream: [{ streamType: 1, colorTrc: 'smpte2084' }] }] }] }] } }));
      return;
    }
    if (request.url?.startsWith('/photo/:/transcode')) {
      response.setHeader('content-type', 'image/png');
      response.end(png);
      return;
    }
    response.statusCode = 404;
    response.end();
  });
  await new Promise<void>((resolvePromise) => server.listen(0, '127.0.0.1', resolvePromise));
  const address = server.address();
  assert.ok(address && typeof address === 'object');
  const configuration: PlexServerConfiguration = {
    revision: 1, host: '127.0.0.1', port: address.port, transport: 'http', autoEmptyTrash: false,
    machineIdentifier: 'machine', name: 'Plex', verifiedAt: '2026-08-01T00:00:00.000Z',
    libraries: [{ key: '1', title: 'Movies', type: 'movie', locations: [], available: true, observedAt: '2026-08-01T00:00:00.000Z' }],
  };
  const storage = new VynodeSqliteStorage(join(directory, 'vynode.sqlite'));
  try {
    const overlays = new ProductionPosterOverlayStore(storage, async () => configuration, directory);
    const assets = new ProductionCollectionPosterStore(storage, directory);
    const transport = new PlexHttpTransport({ connection: configuration, token: async () => 'token', clientIdentifier: 'test' });
    const executor = new ProductionPlexOverlayExecutor(join(directory, 'overlays'), overlays, assets, async () => ({ configured: configuration, transport }), async () => undefined, globalThis.fetch, { async title(){ return { imdbId:'tt1234567', rating:8.2, ratingCount:1200 }; } }, async () => [{ collectionId: 1, mediaId: '101', daysRemaining: 4 }], async () => ({ inRadarr: true, radarrTags: ['Featured'] }));
    overlays.connectOperations(executor);
    const saved=await overlays.saveTemplate(undefined,{name:'IMDb 5+',description:'',type:'rating',tags:[],enabled:true,conditionSummary:'IMDb rating at least 5',accent:'#fff',condition:{sections:[{rules:[{field:'imdbRating',operator:'gte',value:5}]}]},design:{width:1000,height:1500,elements:[{id:'rating',layerOrder:0,type:'text',x:10,y:10,width:100,height:40,rotation:0,name:'Rating',properties:{text:'IMDb'}},{id:'maintenance',layerOrder:1,type:'variable',x:10,y:60,width:100,height:40,rotation:0,name:'Maintenance',properties:{segments:[{type:'variable',field:'daysUntilAction'}]}},{id:'arr',layerOrder:2,type:'variable',x:10,y:110,width:100,height:40,rotation:0,name:'Arr',properties:{segments:[{type:'variable',field:'radarrTags'}]}}]}});
    await overlays.updateLibrary('1',{enabledTemplateIds:[saved.templates[0]!.id]});
    const found = await overlays.searchItems('exam', '1');
    assert.equal(found[0]?.ratingKey, '101');
    const preview = await overlays.testItem('101');
    assert.equal(preview?.context.streamingProvider, 'Netflix');
    assert.equal(preview?.context.imdbRating, 7.9);
    assert.equal(preview?.templates[0]?.matched, true);
    assert.equal(preview?.context.hdr, true);
    assert.equal(preview?.context.daysUntilAction, 4);
    assert.equal(preview?.context.radarrTags, 'Featured');
    assert.deepEqual(await overlays.posterForItem('101'), new Uint8Array(png));
    assert.ok(requests.some((request) => request.includes('includeCollections=1') && request.includes('includeLabels=1') && request.includes('includeMedia=1')));
    assert.ok(requests.every((request) => !request.includes('token')));
  } finally {
    storage.close();
    await new Promise<void>((resolvePromise) => server.close(() => resolvePromise()));
    await rm(directory, { recursive: true, force: true });
  }
});
