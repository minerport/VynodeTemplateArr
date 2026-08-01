import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  FileOverlayApplicationStateRepository,
  FileOverlayBasePosterStore,
} from './application-file.js';

const state = {
  ratingKey: '../movie/101?token=secret',
  basePosterKey: 'base:../movie/101?token=secret',
  basePosterHash: 'a'.repeat(64),
  lastAppliedHash: 'b'.repeat(64),
  appliedTemplateIds: ['resolution', 'rating'],
  updatedAt: '2026-07-26T12:00:00.000Z',
};

test('persists base posters and application state across repository instances', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vynode-overlay-state-'));
  try {
    const bases = new FileOverlayBasePosterStore({ directory: join(root, 'bases') });
    const repository = new FileOverlayApplicationStateRepository({
      directory: join(root, 'state'),
    });
    await bases.put(state.basePosterKey, new Uint8Array([1, 2, 3]));
    await repository.put(state);

    const restartedBases = new FileOverlayBasePosterStore({
      directory: join(root, 'bases'),
    });
    const restartedRepository = new FileOverlayApplicationStateRepository({
      directory: join(root, 'state'),
    });
    assert.deepEqual([...(await restartedBases.get(state.basePosterKey))!], [1, 2, 3]);
    assert.deepEqual(await restartedRepository.get(state.ratingKey), state);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('uses opaque hashed filenames for user and Plex-controlled identifiers', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vynode-overlay-path-'));
  try {
    const bases = new FileOverlayBasePosterStore({ directory: join(root, 'bases') });
    const repository = new FileOverlayApplicationStateRepository({
      directory: join(root, 'state'),
    });
    await bases.put(state.basePosterKey, new Uint8Array([1]));
    await repository.put(state);
    assert.deepEqual((await readdir(join(root, 'bases'))).map((name) => name.length), [64]);
    assert.deepEqual(
      (await readdir(join(root, 'state'))).map((name) => name.length),
      [69]
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('rejects corrupt, mismatched, and oversized application state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vynode-overlay-corrupt-'));
  try {
    const repository = new FileOverlayApplicationStateRepository({
      directory: root,
      maxStateBytes: 512,
    });
    await repository.put(state);
    const [path] = await readdir(root);
    await writeFile(join(root, path!), '{bad json');
    await assert.rejects(repository.get(state.ratingKey), /corrupt/);
    await assert.rejects(
      repository.put({ ...state, basePosterHash: 'not-a-hash' }),
      /invalid/
    );
    await writeFile(join(root, path!), 'x'.repeat(513));
    await assert.rejects(repository.get(state.ratingKey), /invalid size/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('validates preserved base poster bounds and deletion is idempotent', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vynode-overlay-base-'));
  try {
    const bases = new FileOverlayBasePosterStore({
      directory: join(root, 'bases'),
      maxPosterBytes: 3,
    });
    await assert.rejects(bases.put('empty', new Uint8Array()), /invalid/);
    await assert.rejects(
      bases.put('large', new Uint8Array([1, 2, 3, 4])),
      /invalid/
    );
    const repository = new FileOverlayApplicationStateRepository({
      directory: join(root, 'state'),
    });
    await repository.delete('missing');
    await repository.delete('missing');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
