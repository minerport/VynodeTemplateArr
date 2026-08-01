import assert from 'node:assert/strict';
import test from 'node:test';
import type { ManagedCollection } from '@vynode/contracts';
import { ManagedCollectionSynchronizer } from './managed-collection-synchronization.js';

const collection = (
  input: Partial<ManagedCollection> = {}
): ManagedCollection => ({
  id: 'weekly',
  title: 'Weekly Picks',
  description: '',
  mediaType: 'movie',
  libraryId: '1',
  libraryName: 'Movies',
  sourceType: 'manual',
  itemCount: 0,
  homeVisible: false,
  recommendedVisible: false,
  libraryVisible: true,
  sharedOrder: 0,
  libraryOrder: 0,
  status: 'needs-sync',
  ...input,
});

test('creates, reconciles, and verifies a managed collection', async () => {
  const calls: string[] = [];
  let members = ['10', '99'];
  const synchronizer = new ManagedCollectionSynchronizer({
    async create() {
      calls.push('create');
      return '500';
    },
    async snapshot() {
      calls.push('snapshot');
      return {
        ratingKey: '500',
        title: 'Old title',
        libraryId: '1',
        smart: false,
        memberKeys: members,
      };
    },
    async rename() {
      calls.push('rename');
    },
    async addMembers(_key, keys) {
      calls.push(`add:${keys.join(',')}`);
      members = [...members, ...keys];
      return { added: keys, failures: [] };
    },
    async removeMembers(_key, keys) {
      calls.push(`remove:${keys.join(',')}`);
      members = members.filter((key) => !keys.includes(key));
      return { removed: keys, failures: [] };
    },
    async reorderMembers(_key, keys) {
      calls.push(`reorder:${keys.join(',')}`);
      members = [...keys];
      return { moved: keys, failures: [] };
    },
  });

  const report = await synchronizer.synchronize(collection(), ['10', '20']);

  assert.equal(report.plexRatingKey, '500');
  assert.equal(report.created, true);
  assert.deepEqual(report.added, ['20']);
  assert.deepEqual(report.removed, ['99']);
  assert.deepEqual(report.failures, []);
  assert.deepEqual(report.verifiedMemberKeys, ['10', '20']);
  assert.deepEqual(calls, [
    'create',
    'snapshot',
    'rename',
    'add:20',
    'remove:99',
    'snapshot',
    'reorder:10,20',
    'snapshot',
  ]);
});

test('rejects empty results, wrong libraries, and smart collections before membership mutation', async () => {
  const unused = async () => {
    assert.fail('membership mutation must not run');
    return { added: [], failures: [] };
  };
  const plex = {
    async create() {
      return '500';
    },
    async snapshot() {
      return {
        ratingKey: '500',
        title: 'Weekly Picks',
        libraryId: '2',
        smart: false,
        memberKeys: [],
      };
    },
    async rename() {},
    addMembers: unused,
    async removeMembers() {
      await unused();
      return { removed: [], failures: [] };
    },
    async reorderMembers() {
      await unused();
      return { moved: [], failures: [] };
    },
  };
  const synchronizer = new ManagedCollectionSynchronizer(plex);
  await assert.rejects(
    synchronizer.synchronize(collection(), []),
    /resolved no valid Plex members/
  );
  await assert.rejects(
    synchronizer.synchronize(collection({ plexRatingKey: '500' }), ['10']),
    /belongs to library 2/
  );
  plex.snapshot = async () => ({
    ratingKey: '500',
    title: 'Weekly Picks',
    libraryId: '1',
    smart: true,
    memberKeys: [],
  });
  await assert.rejects(
    synchronizer.synchronize(collection({ plexRatingKey: '500' }), ['10']),
    /smart collection conversion is unavailable/
  );
});

test('reports transport and post-write verification failures without hiding partial progress', async () => {
  let snapshots = 0;
  const synchronizer = new ManagedCollectionSynchronizer({
    async create() {
      return '500';
    },
    async snapshot() {
      snapshots += 1;
      return {
        ratingKey: '500',
        title: 'Weekly Picks',
        libraryId: '1',
        smart: false,
        memberKeys: snapshots === 1 ? ['10', '30'] : ['10', '30'],
      };
    },
    async rename() {},
    async addMembers() {
      return { added: [], failures: ['20'] };
    },
    async removeMembers() {
      return { removed: [], failures: [] };
    },
    async reorderMembers() {
      return { moved: [], failures: [] };
    },
  });
  const report = await synchronizer.synchronize(
    collection({ plexRatingKey: '500' }),
    ['10', '20']
  );
  assert.deepEqual(report.failures, [
    'add:20',
    'verify-extra:30',
  ]);
});

test('propagates cancellation before any Plex request', async () => {
  const controller = new AbortController();
  controller.abort();
  const synchronizer = new ManagedCollectionSynchronizer({
    async create() {
      assert.fail('Plex must not be contacted');
    },
    async snapshot() {
      assert.fail('Plex must not be contacted');
    },
    async rename() {},
    async addMembers() {
      return { added: [], failures: [] };
    },
    async removeMembers() {
      return { removed: [], failures: [] };
    },
    async reorderMembers() {
      return { moved: [], failures: [] };
    },
  });
  await assert.rejects(
    synchronizer.synchronize(collection(), ['10'], controller.signal),
    { name: 'AbortError' }
  );
});

test('applies inactive scheduled visibility after membership verification', async () => {
  let applied: unknown;
  const synchronizer = new ManagedCollectionSynchronizer({
    async create() { return '500'; },
    async snapshot() {
      return { ratingKey: '500', title: 'Weekly Picks', libraryId: '1', smart: false, memberKeys: ['10'] };
    },
    async rename() {},
    async addMembers() { return { added: [], failures: [] }; },
    async removeMembers() { return { removed: [], failures: [] }; },
    async reorderMembers() { return { moved: ['10'], failures: [] }; },
    async updateHubVisibility(libraryId, ratingKey, visibility) {
      applied = { libraryId, ratingKey, visibility };
    },
  }, () => new Date('2026-08-01T12:00:00Z'));
  const report = await synchronizer.synchronize(collection({
    plexRatingKey: '500',
    behaviorSettings: {
      visibility: { usersHome: true, serverOwnerHome: true, libraryRecommended: true },
      randomizeHomeOrder: false,
      showUnwatchedOnly: false,
      smartCollectionSort: 'titleAsc',
      timeRestriction: {
        alwaysActive: false,
        removeFromPlexWhenInactive: false,
        inactiveVisibility: { usersHome: false, serverOwnerHome: false, libraryRecommended: false },
        dateRanges: [{ startDate: '01-01', endDate: '31-01' }],
        weeklySchedule: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true, sunday: true },
      },
      syncSchedule: { enabled: false, scheduleType: 'preset', preset: '1d', customCron: '', startNow: true, startDate: '01-01', startTime: '09:00' },
    },
  }), ['10']);
  assert.deepEqual(applied, {
    libraryId: '1',
    ratingKey: '500',
    visibility: { usersHome: false, serverOwnerHome: false, libraryRecommended: false },
  });
  assert.deepEqual(report.failures, []);
});

test('randomizes and verifies Home placement after a successful active sync', async () => {
  let randomized: unknown;
  const synchronizer = new ManagedCollectionSynchronizer({
    async create() { return '500'; },
    async snapshot() {
      return { ratingKey: '500', title: 'Weekly Picks', libraryId: '1', smart: false, memberKeys: ['10'] };
    },
    async rename() {},
    async addMembers() { return { added: [], failures: [] }; },
    async removeMembers() { return { removed: [], failures: [] }; },
    async reorderMembers() { return { moved: [], failures: [] }; },
    async updateHubVisibility() {},
    async randomizeHubPosition(libraryId, ratingKey, randomValue) {
      randomized = { libraryId, ratingKey, randomValue };
      return 2;
    },
  }, () => new Date('2026-08-01T12:00:00Z'), () => 0.75);
  const behavior = {
    visibility: { usersHome: true, serverOwnerHome: true, libraryRecommended: true },
    randomizeHomeOrder: true,
    showUnwatchedOnly: false,
    smartCollectionSort: 'titleAsc' as const,
    timeRestriction: {
      alwaysActive: true,
      removeFromPlexWhenInactive: false,
      inactiveVisibility: { usersHome: false, serverOwnerHome: false, libraryRecommended: false },
      dateRanges: [],
      weeklySchedule: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true, sunday: true },
    },
    syncSchedule: { enabled: false, scheduleType: 'preset' as const, preset: '1d' as const, customCron: '', startNow: true, startDate: '01-01', startTime: '09:00' },
  };
  const report = await synchronizer.synchronize(collection({ plexRatingKey: '500', behaviorSettings: behavior }), ['10']);
  assert.deepEqual(randomized, { libraryId: '1', ratingKey: '500', randomValue: 0.75 });
  assert.deepEqual(report.failures, []);
});

test('atomically converts a regular collection to a verified unwatched smart collection', async () => {
  const labels = new Set(['10']);
  const calls: string[] = [];
  const synchronizer = new ManagedCollectionSynchronizer({
    async create() { assert.fail('regular creation is not used'); },
    async snapshot(key) {
      return key === '500'
        ? { ratingKey: '500', title: 'Weekly Picks', libraryId: '1', smart: false, memberKeys: ['10'] }
        : { ratingKey: '600', title: 'Weekly Picks', libraryId: '1', smart: true, memberKeys: ['20'] };
    },
    async rename() {}, async addMembers() { return { added: [], failures: [] }; },
    async removeMembers() { return { removed: [], failures: [] }; },
    async reorderMembers() { return { moved: [], failures: [] }; },
    async membersWithManagedLabel() { return [...labels]; },
    async setManagedLabel(key, _label, enabled) {
      calls.push(`label:${key}:${enabled}`);
      if (enabled) labels.add(key); else labels.delete(key);
    },
    async createUnwatchedSmart() { calls.push('create-smart'); return '600'; },
    async delete(key) { calls.push(`delete:${key}`); },
    async updateHubVisibility() {},
  });
  const behavior = {
    visibility: { usersHome: true, serverOwnerHome: true, libraryRecommended: true },
    randomizeHomeOrder: false, showUnwatchedOnly: true, smartCollectionSort: 'titleAsc' as const,
    timeRestriction: { alwaysActive: true, removeFromPlexWhenInactive: false, inactiveVisibility: { usersHome: false, serverOwnerHome: false, libraryRecommended: false }, dateRanges: [], weeklySchedule: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true, sunday: true } },
    syncSchedule: { enabled: false, scheduleType: 'preset' as const, preset: '1d' as const, customCron: '', startNow: true, startDate: '01-01', startTime: '09:00' },
  };
  const report = await synchronizer.synchronize(collection({ id: '12345678-1234-1234-1234-123456789abc', plexRatingKey: '500', behaviorSettings: behavior }), ['20']);
  assert.equal(report.plexRatingKey, '600');
  assert.deepEqual(calls, ['label:20:true', 'label:10:false', 'create-smart', 'delete:500']);
});

test('rolls ownership labels back when unwatched smart creation fails', async () => {
  const labels = new Set(['10']);
  const synchronizer = new ManagedCollectionSynchronizer({
    async create() { assert.fail('regular creation is not used'); },
    async snapshot() { assert.fail('snapshot is not reached'); },
    async rename() {}, async addMembers() { return { added: [], failures: [] }; },
    async removeMembers() { return { removed: [], failures: [] }; },
    async reorderMembers() { return { moved: [], failures: [] }; },
    async membersWithManagedLabel() { return [...labels]; },
    async setManagedLabel(key, _label, enabled) { if (enabled) labels.add(key); else labels.delete(key); },
    async createUnwatchedSmart() { throw new Error('create failed'); },
    async delete() {},
  });
  const behavior = {
    visibility: { usersHome: false, serverOwnerHome: false, libraryRecommended: false },
    randomizeHomeOrder: false, showUnwatchedOnly: true, smartCollectionSort: 'titleAsc' as const,
    timeRestriction: { alwaysActive: true, removeFromPlexWhenInactive: false, inactiveVisibility: { usersHome: false, serverOwnerHome: false, libraryRecommended: false }, dateRanges: [], weeklySchedule: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true, sunday: true } },
    syncSchedule: { enabled: false, scheduleType: 'preset' as const, preset: '1d' as const, customCron: '', startNow: true, startDate: '01-01', startTime: '09:00' },
  };
  await assert.rejects(() => synchronizer.synchronize(collection({ id: '12345678-1234-1234-1234-123456789abc', behaviorSettings: behavior }), ['20']), /create failed/);
  assert.deepEqual([...labels], ['10']);
});

test('atomically converts an unwatched smart collection back to a regular collection', async () => {
  const labels = new Set(['10', '20']);
  const deleted: string[] = [];
  let created = false;
  const synchronizer = new ManagedCollectionSynchronizer({
    async create() { created = true; return '700'; },
    async snapshot(key) {
      if (key === '600') return { ratingKey: '600', title: 'Weekly Picks', libraryId: '1', smart: true, memberKeys: ['10'] };
      return { ratingKey: '700', title: 'Weekly Picks', libraryId: '1', smart: false, memberKeys: created ? ['10', '20'] : [] };
    },
    async rename() {},
    async addMembers(_key, keys) { return { added: keys, failures: [] }; },
    async removeMembers(_key, keys) { return { removed: keys, failures: [] }; },
    async reorderMembers() { return { moved: [], failures: [] }; },
    async membersWithManagedLabel() { return [...labels]; },
    async setManagedLabel(key, _label, enabled) { if (enabled) labels.add(key); else labels.delete(key); },
    async delete(key) { deleted.push(key); },
  });
  const report = await synchronizer.synchronize(collection({
    id: '12345678-1234-1234-1234-123456789abc',
    plexRatingKey: '600',
    behaviorSettings: {
      visibility: { usersHome: false, serverOwnerHome: false, libraryRecommended: false },
      randomizeHomeOrder: false, showUnwatchedOnly: false, smartCollectionSort: 'titleAsc',
      timeRestriction: { alwaysActive: true, removeFromPlexWhenInactive: false, inactiveVisibility: { usersHome: false, serverOwnerHome: false, libraryRecommended: false }, dateRanges: [], weeklySchedule: { monday: true, tuesday: true, wednesday: true, thursday: true, friday: true, saturday: true, sunday: true } },
      syncSchedule: { enabled: false, scheduleType: 'preset', preset: '1d', customCron: '', startNow: true, startDate: '01-01', startTime: '09:00' },
    },
  }), ['10', '20']);
  assert.equal(report.plexRatingKey, '700');
  assert.deepEqual([...labels], []);
  assert.deepEqual(deleted, ['600']);
});
