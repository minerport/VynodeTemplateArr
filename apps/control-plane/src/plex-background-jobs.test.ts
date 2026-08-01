import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductionPlexServices } from '@vynode/media-servers';

import {
  registerPlexBackgroundJobs,
  type RegisteredBackgroundJob,
} from './plex-background-jobs.js';

test('registers full and quick Plex jobs with cancellation propagated', async () => {
  const calls: string[] = [];
  const jobs: RegisteredBackgroundJob<unknown>[] = [];
  const plex = {
    async discover(signal: AbortSignal) {
      assert.equal(signal.aborted, false);
      calls.push('discover');
      return { imported: [] };
    },
    async synchronize(signal: AbortSignal) {
      assert.equal(signal.aborted, false);
      calls.push('synchronize');
      return { itemReports: [], orderReports: [] };
    },
  } as unknown as ProductionPlexServices;
  registerPlexBackgroundJobs(
    {
      register(job) {
        jobs.push(job);
      },
    },
    plex
  );

  assert.deepEqual(
    jobs.map(({ id, cronSchedule }) => ({ id, cronSchedule })),
    [
      {
        id: 'plex-collections-sync',
        cronSchedule: '0 0 */6 * * *',
      },
      {
        id: 'plex-collections-quick-sync',
        cronSchedule: '0 */30 * * * *',
      },
    ]
  );
  await jobs[0]!.execute(new AbortController().signal);
  await jobs[1]!.execute(new AbortController().signal);
  assert.deepEqual(calls, ['discover', 'synchronize', 'synchronize']);
});

test('full Plex job never mutates stale state when discovery fails', async () => {
  const jobs: RegisteredBackgroundJob<unknown>[] = [];
  registerPlexBackgroundJobs(
    {
      register(job) {
        jobs.push(job);
      },
    },
    {
      async discover() {
        throw new Error('Plex unavailable');
      },
      async synchronize() {
        assert.fail('synchronization must not run after failed discovery');
      },
    } as unknown as ProductionPlexServices
  );
  await assert.rejects(
    jobs[0]!.execute(new AbortController().signal),
    /Plex unavailable/
  );
});
