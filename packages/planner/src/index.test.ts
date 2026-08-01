import assert from 'node:assert/strict';
import test from 'node:test';

import { planCollectionSync } from './index.js';

test('creates a deterministic plan for a missing collection', () => {
  const current = {
    targetAdapterId: 'plex:main',
    collectionKey: 'trending',
    title: 'Trending',
    exists: false,
    members: [],
    visibleOnHome: false,
    visibleInLibrary: false,
    visibleOnRecommended: false,
  } as const;
  const desired = {
    targetAdapterId: 'plex:main',
    collectionKey: 'trending',
    title: 'Trending Now',
    members: [
      { key: 'tmdb:movie:1', title: 'First' },
      { key: 'tmdb:movie:2', title: 'Second' },
    ],
    visibleOnHome: true,
    visibleInLibrary: true,
    visibleOnRecommended: false,
  } as const;

  const first = planCollectionSync(current, desired, '2026-07-25T00:00:00Z');
  const second = planCollectionSync(current, desired, '2026-07-25T00:00:00Z');

  assert.deepEqual(first, second);
  assert.deepEqual(
    first.changes.map((change) => change.operation),
    [
      'collection.create',
      'collection.members.add',
      'collection.members.reorder',
      'collection.visibility.update',
    ]
  );
  assert.ok(
    first.changes
      .slice(1)
      .every((change) => change.dependsOn.includes(first.changes[0]!.id))
  );
});

test('plans only membership and ordering differences', () => {
  const plan = planCollectionSync(
    {
      targetAdapterId: 'plex:main',
      collectionKey: 'popular',
      title: 'Popular',
      exists: true,
      members: [
        { key: 'tmdb:movie:1', title: 'First' },
        { key: 'tmdb:movie:2', title: 'Second' },
      ],
      visibleOnHome: true,
      visibleInLibrary: true,
      visibleOnRecommended: true,
    },
    {
      targetAdapterId: 'plex:main',
      collectionKey: 'popular',
      title: 'Popular',
      members: [
        { key: 'tmdb:movie:2', title: 'Second' },
        { key: 'tmdb:movie:3', title: 'Third' },
      ],
      visibleOnHome: true,
      visibleInLibrary: true,
      visibleOnRecommended: true,
    },
    '2026-07-25T00:00:00Z'
  );

  assert.deepEqual(
    plan.changes.map((change) => change.operation),
    [
      'collection.members.add',
      'collection.members.remove',
      'collection.members.reorder',
    ]
  );
});
