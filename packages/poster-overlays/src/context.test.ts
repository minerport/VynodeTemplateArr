import assert from 'node:assert/strict';
import test from 'node:test';

import type { OverlayTemplateSummary } from '@vynode/contracts';

import {
  collectRequiredContextFields,
  identifyStreamingProvider,
  OverlayContextBuilder,
  type OverlayContextProvider,
  type PlexOverlayMedia,
} from './context.js';

test('identifies the originating streaming service from durable Plex metadata',()=>{
  assert.deepEqual(identifyStreamingProvider({networks:['Netflix']}),{name:'Netflix',id:8});
  assert.deepEqual(identifyStreamingProvider({studio:'Amazon Studios'}),{name:'Prime Video',id:9});
  assert.deepEqual(identifyStreamingProvider({labels:['Apple TV+ Original']}),{name:'Apple TV+',id:350});
  assert.deepEqual(identifyStreamingProvider({streamingProvider:'Custom Service',streamingProviderId:44}),{name:'Custom Service',id:44});
  assert.deepEqual(identifyStreamingProvider({collections:['Prime Video Originals']}),{name:'Prime Video',id:9});
});

const templates = [
  {
    id: 'quality',
    name: 'Quality',
    description: '',
    type: 'video',
    tags: [],
    enabled: true,
    displayOrder: 0,
    elementCount: 2,
    conditionSummary: '',
    accent: '#fff',
    condition: {
      sections: [{ rules: [{ field: 'imdbRating', operator: 'gt', value: 7 }] }],
    },
    design: {
      width: 1000,
      height: 1500,
      elements: [
        {
          id: 'resolution',
          layerOrder: 0,
          type: 'mapped-icon',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          rotation: 0,
          name: 'Resolution',
          properties: { field: 'resolution' },
        },
        {
          id: 'title',
          layerOrder: 1,
          type: 'variable',
          x: 0,
          y: 100,
          width: 100,
          height: 100,
          rotation: 0,
          name: 'Title',
          properties: {
            segments: [{ type: 'variable', field: 'runtimeHHMM' }],
          },
        },
      ],
    },
  },
] satisfies OverlayTemplateSummary[];

const item: PlexOverlayMedia = {
  ratingKey: '101',
  title: 'Example',
  year: 2025,
  mediaType: 'movie',
  durationMs: 8_160_000,
  userRating: 8,
  directors: ['Director'],
  genres: ['Drama'],
  labels: ['Overlay'],
  collections: ['12'],
  addedAt: '2025-01-08T12:00:00.000Z',
  lastViewedAt: '2025-01-09T12:00:00.000Z',
  viewCount: 4,
  releaseDate: '2025-01-15',
  media: [
    { width: 1920, height: 1080, resolution: '1080p' },
    {
      width: 3840,
      height: 2160,
      resolution: '4K',
      videoCodec: 'hevc',
      hdr: true,
      audioCodec: 'truehd',
      audioChannels: 8,
      audioLanguages: [
        { code: 'en', name: 'English' },
        { code: 'de', name: 'German' },
      ],
      subtitleLanguages: [{ code: 'es', name: 'Spanish' }],
    },
  ],
};

test('collects condition, mapped-icon, and variable fields once', () => {
  assert.deepEqual([...collectRequiredContextFields(templates)].sort(), [
    'imdbRating',
    'isPlaceholder',
    'mediaType',
    'resolution',
    'runtimeHHMM',
    'title',
    'year',
  ]);
});

test('normalizes Plex metadata and selects the highest-resolution media part', async () => {
  const result = await new OverlayContextBuilder(
    [],
    () => new Date('2025-01-10T12:00:00.000Z')
  ).build(item, templates);
  assert.equal(result.context.resolution, '4K');
  assert.equal(result.context.runtime, 136);
  assert.equal(result.context.runtimeHHMM, '2h 16m');
  assert.equal(result.context.daysSinceAdded, 2);
  assert.equal(result.context.daysSinceLastPlayed, 1);
  assert.deepEqual(result.context.audioLanguageCodes, ['en', 'de']);
  assert.deepEqual(result.context.subtitleLanguages, ['Spanish']);
  assert.equal(result.context.hasSubtitles, true);
  assert.equal(result.context.daysUntilRelease, 4);
  assert.equal(result.context.daysAgo, -5);
});

test('requests only fields used by active render inputs and merges providers', async () => {
  let requested: readonly string[] = [];
  const provider: OverlayContextProvider = {
    name: 'ratings',
    fields: new Set(['imdbRating', 'rtCriticsScore']),
    async load(_item, fields) {
      requested = [...fields];
      return { imdbRating: 8.7, rtCriticsScore: 90 };
    },
  };
  const result = await new OverlayContextBuilder([provider]).build(item, templates);
  assert.deepEqual(requested, ['imdbRating']);
  assert.equal(result.context.imdbRating, 8.7);
  assert.equal(result.context.rtCriticsScore, 90);
});

test('providers fill missing values in priority order without replacing Plex values', async () => {
  const first: OverlayContextProvider = {
    name: 'first',
    fields: new Set(['imdbRating']),
    async load() { return { imdbRating: 8.1 }; },
  };
  const second: OverlayContextProvider = {
    name: 'second',
    fields: new Set(['imdbRating']),
    async load() { return { imdbRating: 9.9 }; },
  };
  const enriched = await new OverlayContextBuilder([first, second]).build(item, templates);
  assert.equal(enriched.context.imdbRating, 8.1);
  const plexWins = await new OverlayContextBuilder([first]).build(
    { ...item, imdbRating: 7.4 },
    templates
  );
  assert.equal(plexWins.context.imdbRating, 7.4);
});

test('reports optional failures and marks critical provider failures', async () => {
  const provider: OverlayContextProvider = {
    name: 'IMDb',
    fields: new Set(['imdbRating']),
    critical: true,
    async load() {
      throw new Error('temporarily unavailable');
    },
  };
  const result = await new OverlayContextBuilder([provider]).build(item, templates);
  assert.equal(result.criticalProviderFailed, true);
  assert.deepEqual(result.warnings, [
    { provider: 'IMDb', message: 'temporarily unavailable' },
  ]);
});

test('propagates cancellation instead of downgrading it to a warning', async () => {
  const controller = new AbortController();
  const provider: OverlayContextProvider = {
    name: 'ratings',
    fields: new Set(['imdbRating']),
    async load() {
      controller.abort();
      controller.signal.throwIfAborted();
      return {};
    },
  };
  await assert.rejects(
    new OverlayContextBuilder([provider]).build(item, templates, {
      signal: controller.signal,
    }),
    { name: 'AbortError' }
  );
});
