import assert from 'node:assert/strict';
import test from 'node:test';

import type { OverlayTemplateSummary } from '@vynode/contracts';

import {
  OverlayApplicationService,
  type OverlayApplicationState,
  type OverlayApplicationStateRepository,
  type OverlayApplicationItem,
} from './application.js';
import { OverlayContextBuilder } from './context.js';
import { PosterOperationCoordinator } from './operations.js';

const templates = [
  {
    id: 'quality',
    name: 'Quality',
    description: '',
    type: 'video',
    tags: [],
    enabled: true,
    displayOrder: 0,
    elementCount: 1,
    conditionSummary: 'Always',
    accent: '#fff',
    design: { width: 1000, height: 1500, elements: [] },
  },
] satisfies OverlayTemplateSummary[];

const items: OverlayApplicationItem[] = [
  {
    ratingKey: '101',
    title: 'Example',
    year: 2026,
    mediaType: 'movie',
    libraryId: 'movies',
    libraryName: 'Movies',
  },
];

const fixture = (
  options: {
    failUpload?: boolean;
    critical?: boolean;
    coordinator?: PosterOperationCoordinator;
  } = {}
) => {
  const bases = new Map<string, Uint8Array>();
  const states = new Map<string, OverlayApplicationState>();
  const uploaded: number[][] = [];
  const renderedFrom: number[][] = [];
  const renderedContexts: Readonly<Record<string, unknown>>[] = [];
  const labels: boolean[] = [];
  const repository: OverlayApplicationStateRepository = {
    async get(key) {
      return states.get(key);
    },
    async put(state) {
      states.set(state.ratingKey, state);
    },
    async delete(key) {
      states.delete(key);
    },
  };
  const service = new OverlayApplicationService({
    acquisition: {
      async acquire(source) {
        return { source, bytes: new Uint8Array([1, 2, 3]) };
      },
    },
    contexts: new OverlayContextBuilder(
      options.critical
        ? [
            {
              name: 'IMDb',
              fields: new Set(['imdbRating']),
              critical: true,
              async load() {
                throw new Error('ratings offline');
              },
            },
          ]
        : []
    ),
    renderer: {
      async render(poster, currentTemplates, context) {
        renderedFrom.push([...poster]);
        renderedContexts.push(context);
        return {
          bytes: new Uint8Array([9, 8, 7]),
          appliedTemplateIds: currentTemplates.map((template) => template.id),
          skippedTemplateIds: [],
          skippedElements: [],
        };
      },
    },
    plex: {
      async uploadPoster(_key, bytes) {
        if (options.failUpload) throw new Error('Plex upload failed');
        uploaded.push([...bytes]);
      },
      async setOverlayLabel(_key, enabled) {
        labels.push(enabled);
      },
    },
    bases: {
      async get(key) {
        return bases.get(key);
      },
      async put(key, bytes) {
        bases.set(key, bytes);
      },
      async delete(key) {
        bases.delete(key);
      },
    },
    states: repository,
    ...(options.coordinator ? { coordinator: options.coordinator } : {}),
    now: () => new Date('2026-07-26T12:00:00.000Z'),
  });
  return {
    service,
    bases,
    states,
    uploaded,
    labels,
    renderedFrom,
    renderedContexts,
  };
};

test('preserves the clean base before upload and records the applied digest', async () => {
  const current = fixture();
  const result = await current.service.apply(items, templates, 'plex', 'en-US');
  assert.equal(result.applied, 1);
  assert.deepEqual([...current.bases.get('base:101')!], [1, 2, 3]);
  assert.deepEqual(current.uploaded, [[9, 8, 7]]);
  assert.deepEqual(current.labels, [true]);
  assert.deepEqual(current.states.get('101')?.appliedTemplateIds, ['quality']);
});

test('derives placeholder overlay context from managed Plex labels', async () => {
  const current = fixture();
  await current.service.apply(
    [
      {
        ...items[0]!,
        labels: ['Favorite', 'trailer-placeholder'],
      },
    ],
    templates,
    'plex',
    'en-US'
  );
  assert.equal(current.renderedContexts[0]?.isPlaceholder, true);
});

test('returns the preserved clean poster for previews after an overlay is applied', async () => {
  const current = fixture();
  await current.service.apply(items, templates, 'plex', 'en-US');
  assert.deepEqual(
    [...(await current.service.preservedBasePoster('101'))!],
    [1, 2, 3]
  );
  assert.equal(await current.service.preservedBasePoster('missing'), undefined);
});

test('re-downloads confirmed clean Plex posters into the preserved base store', async () => {
  const current = fixture();
  const result = await current.service.downloadCleanPlexBases(items);

  assert.equal(result.downloaded, 1);
  assert.equal(result.failed, 0);
  assert.deepEqual(await current.service.preservedBasePoster('101'), new Uint8Array([1, 2, 3]));
  assert.deepEqual(current.labels, [false]);
});

test('restores stale overlays when no current template matches', async () => {
  const current = fixture();
  await current.service.apply(items, templates, 'plex', 'en-US');
  const result = await current.service.apply(items, [], 'plex', 'en-US');
  assert.equal(result.restored, 1);
  assert.deepEqual(current.uploaded, [
    [9, 8, 7],
    [1, 2, 3],
  ]);
  assert.deepEqual(current.labels, [true, false]);
  assert.equal(current.states.has('101'), false);
  assert.equal(current.bases.size, 0);
});

test('does not replace the preserved base on repeated application', async () => {
  const current = fixture();
  await current.service.apply(items, templates, 'plex', 'en-US');
  const result = await current.service.apply(items, templates, 'plex', 'en-US');
  assert.equal(result.skipped, 1);
  assert.equal(result.items[0]?.reason, 'The rendered poster is unchanged.');
  assert.deepEqual([...current.bases.get('base:101')!], [1, 2, 3]);
  assert.equal(current.uploaded.length, 1);
  assert.deepEqual(current.renderedFrom, [
    [1, 2, 3],
    [1, 2, 3],
  ]);
});

test('restores the exact preserved base, removes the label, then clears state', async () => {
  const current = fixture();
  await current.service.apply(items, templates, 'plex', 'en-US');
  const result = await current.service.reset(items);
  assert.equal(result.restored, 1);
  assert.deepEqual(current.uploaded, [
    [9, 8, 7],
    [1, 2, 3],
  ]);
  assert.deepEqual(current.labels, [true, false]);
  assert.equal(current.states.has('101'), false);
  assert.equal(current.bases.has('base:101'), false);
});

test('retains the clean base when Plex upload fails', async () => {
  const current = fixture({ failUpload: true });
  const result = await current.service.apply(items, templates, 'plex', 'en-US');
  assert.equal(result.failed, 1);
  assert.deepEqual([...current.bases.get('base:101')!], [1, 2, 3]);
  assert.equal(current.states.has('101'), false);
});

test('skips poster mutation when a critical context provider fails', async () => {
  const current = fixture({ critical: true });
  const result = await current.service.apply(items, templates.map((template) => ({
    ...template,
    condition: { sections: [{ rules: [{ field: 'imdbRating', operator: 'gt' as const, value: 5 }] }] },
  })), 'plex', 'en-US');
  assert.equal(result.skipped, 1);
  assert.match(result.items[0]?.reason ?? '', /IMDb: ratings offline/);
  assert.equal(current.uploaded.length, 0);
});

test('shares the operation coordinator with mutually exclusive poster jobs', async () => {
  const coordinator = new PosterOperationCoordinator();
  const release = coordinator.acquire('reset-posters');
  const current = fixture({ coordinator });
  await assert.rejects(
    current.service.apply(items, templates, 'plex', 'en-US'),
    /Cannot start apply-overlays while reset-posters is already running/
  );
  release();
});
