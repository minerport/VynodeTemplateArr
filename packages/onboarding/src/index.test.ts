import assert from 'node:assert/strict';
import test from 'node:test';

import {
  applyOnboardingEvent,
  createOnboardingState,
  nextOnboardingStage,
  OnboardingConflictError,
  OnboardingService,
} from './index.js';

test('onboarding resumes at the first unfinished stage', () => {
  let state = createOnboardingState('install-1');
  state = applyOnboardingEvent(state, {
    type: 'complete',
    stage: 'deployment',
  });
  state = applyOnboardingEvent(state, { type: 'navigate', stage: 'owner' });
  state = applyOnboardingEvent(state, { type: 'complete', stage: 'owner' });

  assert.equal(nextOnboardingStage(state), 'media-server');
  assert.equal(state.revision, 3);
});

test('optional stages may be skipped and activation is atomic', () => {
  let state = createOnboardingState('install-2');
  for (const stage of ['deployment', 'owner', 'media-server'] as const) {
    if (state.stage !== stage) {
      state = applyOnboardingEvent(state, { type: 'navigate', stage });
    }
    state = applyOnboardingEvent(state, { type: 'complete', stage });
  }
  state = applyOnboardingEvent(state, { type: 'navigate', stage: 'sources' });
  state = applyOnboardingEvent(state, { type: 'skip', stage: 'sources' });
  state = applyOnboardingEvent(state, {
    type: 'navigate',
    stage: 'downloads',
  });
  state = applyOnboardingEvent(state, { type: 'skip', stage: 'downloads' });
  state = applyOnboardingEvent(state, { type: 'navigate', stage: 'review' });
  state = applyOnboardingEvent(state, { type: 'complete', stage: 'review' });
  state = applyOnboardingEvent(state, {
    type: 'activate',
    activatedAt: '2026-07-25T00:00:00Z',
  });

  assert.equal(state.activatedAt, '2026-07-25T00:00:00Z');
  assert.equal(nextOnboardingStage(state), undefined);
});

test('later stages cannot be entered without prerequisites', () => {
  const state = createOnboardingState('install-3');
  assert.throws(
    () =>
      applyOnboardingEvent(state, {
        type: 'navigate',
        stage: 'media-server',
      }),
    /incomplete/
  );
});

test('concurrent updates are rejected with the latest state', async () => {
  let stored = createOnboardingState('install-4');
  const service = new OnboardingService({
    async get() {
      return stored;
    },
    async compareAndSet(expectedRevision, next) {
      if (stored.revision !== expectedRevision) return false;
      stored = next;
      return true;
    },
  });

  await service.apply(0, { type: 'complete', stage: 'deployment' });
  await assert.rejects(
    () => service.apply(0, { type: 'complete', stage: 'deployment' }),
    (error) =>
      error instanceof OnboardingConflictError &&
      error.current.revision === 1
  );
});
