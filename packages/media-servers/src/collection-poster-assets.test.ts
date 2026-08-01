import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  CollectionPosterDesign,
  CollectionPosterSettings,
  CollectionPosterWorkspace,
  PlexDiscoveredItem,
} from '@vynode/contracts';

import { CollectionPosterSynchronizationAssets } from './collection-poster-assets.js';

const design = (color: string): CollectionPosterDesign => ({
  width: 1000,
  height: 1500,
  migrated: true,
  background: {
    type: 'color',
    color,
    secondaryColor: '#000000',
    intensity: 50,
    useSourceColors: true,
  },
  elements: [],
});

const item = {
  id: 'collection-1',
  kind: 'pre-existing-collection',
  plexKey: '99',
  name: 'Top Animation',
} as PlexDiscoveredItem;

const settings = (
  overrides: Partial<CollectionPosterSettings> = {}
): CollectionPosterSettings => ({
  autoGenerate: true,
  applyOverlaysDuringSync: false,
  useTmdbFranchisePoster: false,
  hideIndividualItems: false,
  ...overrides,
});

const workspace = (): CollectionPosterWorkspace => ({
  templates: [
    {
      id: 'default',
      name: 'Default',
      description: '',
      design: design('#111111'),
      isDefault: true,
      createdAt: '2026-01-01',
      updatedAt: '2026-01-02',
    },
  ],
  savedPosters: [
    {
      id: 'saved',
      name: 'Saved',
      description: '',
      design: design('#222222'),
      isEditable: true,
      usedBy: [],
      createdAt: '2026-01-01',
      updatedAt: '2026-01-03',
    },
  ],
  sourceColors: {
    trakt: {
      primaryColor: '#ed1c24',
      secondaryColor: '#000000',
      textColor: '#ffffff',
    },
  },
  assets: [],
});

const harness = () => {
  const rendered: Array<{ design: CollectionPosterDesign; context: unknown }> = [];
  const resolver = new CollectionPosterSynchronizationAssets({
    async workspace() {
      return workspace();
    },
    renderInputs: {
      async inputs(_item, _settings, signal) {
        assert.ok(signal);
        return {
          sourceType: 'trakt',
          itemPosters: [new Uint8Array([1])],
          personPoster: new Uint8Array([2]),
          tmdbFranchisePoster: new Uint8Array([3]),
          fingerprint: 'members-v1',
        };
      },
      async uploadedPoster(id) {
        return id === 'upload' ? new Uint8Array([4]) : undefined;
      },
    },
    renderer: {
      async render(selectedDesign, context) {
        rendered.push({ design: selectedDesign, context });
        return { bytes: new Uint8Array([5]) };
      },
    },
    async resolveCollectionAsset() {
      return new Uint8Array();
    },
  });
  return { resolver, rendered };
};

test('honors uploaded, saved, franchise, and generated poster precedence', async () => {
  const signal = new AbortController().signal;
  const { resolver, rendered } = harness();
  assert.deepEqual(
    await resolver.renderPoster(
      item,
      settings({
        customPoster: { kind: 'upload', id: 'upload', name: 'Upload' },
      }),
      signal
    ),
    new Uint8Array([4])
  );
  assert.deepEqual(
    await resolver.renderPoster(
      item,
      settings({
        customPoster: { kind: 'saved', id: 'saved', name: 'Saved' },
        useTmdbFranchisePoster: true,
      }),
      signal
    ),
    new Uint8Array([5])
  );
  assert.equal(rendered[0]?.design.background.color, '#222222');
  assert.deepEqual(
    await resolver.renderPoster(
      item,
      settings({ useTmdbFranchisePoster: true }),
      signal
    ),
    new Uint8Array([3])
  );
  await resolver.renderPoster(item, settings(), signal);
  assert.equal(rendered[1]?.design.background.color, '#111111');
  assert.deepEqual(rendered[1]?.context, {
    title: 'Top Animation',
    sourceType: 'trakt',
    sourceColors: workspace().sourceColors,
    itemPosters: [new Uint8Array([1])],
    personPoster: new Uint8Array([2]),
  });
});

test('fails clearly when a selected uploaded or saved poster was removed', async () => {
  const { resolver } = harness();
  const signal = new AbortController().signal;
  await assert.rejects(
    resolver.renderPoster(
      item,
      settings({
        customPoster: { kind: 'upload', id: 'missing', name: 'Old upload' },
      }),
      signal
    ),
    /Uploaded poster "Old upload" no longer exists/
  );
  await assert.rejects(
    resolver.renderPoster(
      item,
      settings({
        customPoster: { kind: 'saved', id: 'missing', name: 'Old saved' },
      }),
      signal
    ),
    /Saved poster "Old saved" no longer exists/
  );
});

test('fingerprint changes when poster dependencies change', async () => {
  const { resolver } = harness();
  const signal = new AbortController().signal;
  const first = await resolver.posterFingerprint(item, settings(), signal);
  const changed = new CollectionPosterSynchronizationAssets({
    async workspace() {
      const next = workspace();
      return {
        ...next,
        templates: next.templates.map((template) => ({
          ...template,
          updatedAt: '2026-02-01',
        })),
      };
    },
    renderInputs: {
      async inputs() {
        return { itemPosters: [], fingerprint: 'members-v2' };
      },
    },
    renderer: {
      async render() {
        return { bytes: new Uint8Array() };
      },
    },
    async resolveCollectionAsset() {
      return new Uint8Array();
    },
  });
  assert.notEqual(
    first,
    await changed.posterFingerprint(item, settings(), signal)
  );
});
