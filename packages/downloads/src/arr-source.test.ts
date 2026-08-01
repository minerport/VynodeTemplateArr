import assert from 'node:assert/strict';
import test from 'node:test';
import { ArrTagSourceClient, type ArrSourceTransport } from './arr-source.js';

test('loads tags and filters Radarr movies using exact v3 requests', async () => {
  const calls: Parameters<ArrSourceTransport['request']>[0][] = [];
  const client = new ArrTagSourceClient({
    kind: 'radarr',
    hostname: 'radarr.local',
    port: 7878,
    useSsl: false,
    urlBase: '/radarr/',
    apiKey: 'secret',
    transport: {
      async request(input) {
        calls.push(input);
        return input.url.endsWith('/tag')
          ? {
              status: 200,
              body: [
                { id: 2, label: 'vynode' },
                { id: 1, label: 'favorites' },
              ],
            }
          : {
              status: 200,
              body: [
                {
                  id: 10,
                  title: 'Matched',
                  year: 2025,
                  tmdbId: 100,
                  tags: [2],
                },
                { id: 11, title: 'Ignored', tmdbId: 101, tags: [] },
              ],
            };
      },
    },
  });

  assert.deepEqual(await client.tags(), [
    { id: 1, label: 'favorites' },
    { id: 2, label: 'vynode' },
  ]);
  assert.deepEqual(await client.itemsForTag(2), [
    {
      serviceId: 10,
      title: 'Matched',
      year: 2025,
      tmdbId: 100,
      tagIds: [2],
    },
  ]);
  assert.deepEqual(
    calls.map((call) => call.url),
    [
      'http://radarr.local:7878/radarr/api/v3/tag',
      'http://radarr.local:7878/radarr/api/v3/movie',
    ]
  );
  assert.equal(calls[0]?.headers['X-Api-Key'], 'secret');
});

test('normalizes Sonarr TVDB identity and keeps failures credential-safe', async () => {
  const client = new ArrTagSourceClient({
    kind: 'sonarr',
    hostname: 'sonarr.local',
    port: 8989,
    useSsl: true,
    urlBase: '',
    apiKey: 'secret',
    transport: {
      async request({ url }) {
        if (url.endsWith('/series'))
          return {
            status: 200,
            body: [
              {
                id: 9,
                title: 'Example Series',
                year: 2024,
                tvdbId: 42,
                tags: [3, 8],
              },
            ],
          };
        return { status: 401, body: { apiKey: 'secret' } };
      },
    },
  });

  assert.deepEqual(await client.itemsForTag(3), [
    {
      serviceId: 9,
      title: 'Example Series',
      year: 2024,
      tvdbId: 42,
      tagIds: [3, 8],
    },
  ]);
  await assert.rejects(
    client.tags(),
    (error) =>
      error instanceof Error &&
      error.message === 'Sonarr rejected the API key.' &&
      !error.message.includes('secret')
  );
});

test('returns only monitored Arr titles with a future release in chronological order',async()=>{const futureA=new Date(Date.now()+86400000).toISOString(),futureB=new Date(Date.now()+172800000).toISOString(),past=new Date(Date.now()-86400000).toISOString();const client=new ArrTagSourceClient({kind:'radarr',hostname:'radarr.local',port:7878,useSsl:false,urlBase:'',apiKey:'secret',transport:{async request(){return{status:200,body:[{id:1,title:'Later',tmdbId:11,monitored:true,digitalRelease:futureB,tags:[]},{id:2,title:'Sooner',tmdbId:22,monitored:true,inCinemas:futureA,tags:[4]},{id:3,title:'Past',tmdbId:33,monitored:true,physicalRelease:past,tags:[]},{id:4,title:'Ignored',tmdbId:44,monitored:false,digitalRelease:futureA,tags:[]}]};}}});const result=await client.monitoredUpcoming();assert.deepEqual(result.map((item)=>item.title),['Sooner','Later']);assert.equal(result[0]?.releaseAt,futureA);assert.equal(result[0]?.monitored,true);});
