import assert from 'node:assert/strict';
import test from 'node:test';

import { DashboardJobService } from './dashboard-jobs.js';

const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

test('dashboard jobs report phases, outcomes, and terminal progress', async () => {
  const service = new DashboardJobService(
    {
      async items() {
        return [{ id: 'one', name: 'Trending', sourceType: 'Trakt' }];
      },
      async process() {
        return { outcome: 'success', durationMs: 25, created: false };
      },
      async cleanup() {},
    },
    () => new Date('2026-07-25T00:00:00.000Z')
  );
  const started = await service.start('collections');
  assert.ok(started.runId);
  await settle();
  const finished = service.status('collections');
  assert.equal(finished.phase, 'completed');
  assert.equal(finished.progressPercent, 100);
  assert.equal(finished.successCount, 1);
  assert.equal(finished.createdCount, 0);
  assert.equal(finished.recentOutcomes[0]?.name, 'Trending');
});

test('dashboard jobs reject duplicate starts and cancel through AbortSignal', async () => {
  const service = new DashboardJobService(
    {
      async items() {
        return [{ id: 'one', name: 'Movies', sourceType: 'Plex library' }];
      },
      async process(_kind, _item, signal) {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        });
        return { outcome: 'success', durationMs: 1 };
      },
      async cleanup() {},
    },
    () => new Date('2026-07-25T00:00:00.000Z')
  );
  await service.start('overlays');
  await assert.rejects(service.start('overlays'), /already running/);
  service.cancel('overlays');
  await settle();
  assert.equal(service.status('overlays').phase, 'cancelled');
});

test('dashboard jobs can synchronize one selected collection without processing siblings', async () => {
  const processed: string[] = [];
  const service = new DashboardJobService(
    {
      async items() {
        return [
          { id: 'movies', name: 'Movies', sourceType: 'manual' },
          { id: 'shows', name: 'Shows', sourceType: 'manual' },
        ];
      },
      async process(_kind, item) {
        processed.push(item.id);
        return { outcome: 'success', durationMs: 1 };
      },
      async cleanup() {},
    },
    () => new Date('2026-07-25T00:00:00.000Z')
  );
  await service.startSelected('collections', ['shows']);
  await settle();
  assert.deepEqual(processed, ['shows']);
  assert.equal(service.status('collections').totalItems, 1);
});
