import assert from 'node:assert/strict';
import test from 'node:test';
import { AdaptiveTtlCache } from './adaptive-ttl-cache.js';

test('adaptive TTL grows for stable data and contracts when provider data changes', async () => {
  let now = 0;
  let value = { title: 'Stable' };
  const cache = new AdaptiveTtlCache<typeof value>({ minimumTtlMs: 10, initialTtlMs: 20, maximumTtlMs: 80, now: () => now });
  await cache.get('item', async () => value);
  assert.equal(cache.inspect('item')?.ttlMs, 20);
  now = 21;
  await cache.get('item', async () => value);
  assert.equal(cache.inspect('item')?.ttlMs, 40);
  now = 62;
  value = { title: 'Changed' };
  await cache.get('item', async () => value);
  assert.equal(cache.inspect('item')?.ttlMs, 20);
});

test('adaptive TTL coalesces requests and supports explicit invalidation', async () => {
  let calls = 0;
  const cache = new AdaptiveTtlCache<number>({ minimumTtlMs: 10, initialTtlMs: 20, maximumTtlMs: 80 });
  const load = async () => { calls += 1; return 42; };
  assert.deepEqual(await Promise.all([cache.get('item', load), cache.get('item', load)]), [42, 42]);
  assert.equal(calls, 1);
  cache.invalidate('item');
  await cache.get('item', load);
  assert.equal(calls, 2);
});
