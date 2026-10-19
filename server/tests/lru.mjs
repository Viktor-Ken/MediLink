import assert from 'node:assert/strict';
import { LRU } from '../src/lru.js';
import { createCache, load, invalidate } from '../src/cache.js';

const tests = [];
function it(name, fn) {
  tests.push([name, fn]);
}

it('evicts the least recently used entry when full', () => {
  const lru = new LRU({ max: 2 });
  lru.set('a', 1);
  lru.set('b', 2);
  lru.set('c', 3);
  assert.equal(lru.size, 2);
  assert.equal(lru.get('a'), undefined);
  assert.equal(lru.get('b'), 2);
  assert.equal(lru.get('c'), 3);
});

it('get() refreshes recency', () => {
  const lru = new LRU({ max: 2 });
  lru.set('a', 1);
  lru.set('b', 2);
  assert.equal(lru.get('a'), 1);
  lru.set('c', 3);
  assert.equal(lru.get('a'), 1);
  assert.equal(lru.get('b'), undefined);
});

it('updating a key keeps size stable and stores the new value', () => {
  const lru = new LRU({ max: 2 });
  lru.set('a', 1);
  lru.set('a', 2);
  assert.equal(lru.size, 1);
  assert.equal(lru.get('a'), 2);
});

it('expires entries after ttlMs', () => {
  const lru = new LRU({ max: 4, ttlMs: 100 });
  lru.set('k', 'v', 1_000);
  assert.equal(lru.get('k', 1_099), 'v');
  assert.equal(lru.get('k', 1_100), undefined);
  assert.equal(lru.size, 0);
});

it('delete() and clear() remove entries', () => {
  const lru = new LRU({ max: 4 });
  lru.set('a', 1);
  lru.set('b', 2);
  assert.equal(lru.delete('a'), true);
  assert.equal(lru.delete('a'), false);
  assert.equal(lru.size, 1);
  lru.clear();
  assert.equal(lru.size, 0);
});

it('rejects invalid options', () => {
  assert.throws(() => new LRU({ max: 0 }), TypeError);
  assert.throws(() => new LRU({ max: 1.5 }), TypeError);
  assert.throws(() => new LRU({ ttlMs: -1 }), TypeError);
});

it('load() caches the produced value', async () => {
  const cache = createCache('test-basic', { ttlMs: 1_000 });
  let calls = 0;
  const producer = async () => { calls += 1; return { n: calls }; };

  assert.deepEqual(await load(cache, 'k', producer), { value: { n: 1 }, hit: false });
  assert.deepEqual(await load(cache, 'k', producer), { value: { n: 1 }, hit: true });
  assert.equal(calls, 1);
});

it('load() coalesces concurrent misses into one producer call', async () => {
  const cache = createCache('test-inflight', { ttlMs: 1_000 });
  let calls = 0;
  const slow = () => new Promise((resolve) => setTimeout(() => resolve(calls += 1), 10));

  const [a, b] = await Promise.all([load(cache, 'k', slow), load(cache, 'k', slow)]);
  assert.equal(calls, 1);
  assert.equal(a.value, 1);
  assert.equal(b.value, 1);
});

it('invalidate() forces the next load to re-run the producer', async () => {
  const cache = createCache('test-invalidate', { ttlMs: 1_000 });
  let calls = 0;
  const producer = async () => { calls += 1; return calls; };

  assert.equal((await load(cache, 'k', producer)).value, 1);
  invalidate(cache);
  const after = await load(cache, 'k', producer);
  assert.equal(after.value, 2);
  assert.equal(after.hit, false);
});

it('caches are isolated from each other', async () => {
  const a = createCache('test-iso-a', { ttlMs: 1_000 });
  const b = createCache('test-iso-b', { ttlMs: 1_000 });
  let calls = 0;
  const producer = async () => (calls += 1);

  assert.equal((await load(a, 'k', producer)).value, 1);
  assert.equal((await load(b, 'k', producer)).value, 2);
  assert.equal(calls, 2);
});

let passed = 0;
const failures = [];

for (const [name, fn] of tests) {
  try {
    await fn();
    passed += 1;
    console.log(`  ok   ${name}`);
  } catch (err) {
    console.error(`  FAIL ${name}\n       ${err.message}`);
  }
}

console.log(`\n${passed}/${tests.length} LRU/cache assertions passed`);
if (passed !== tests.length) process.exitCode = 1;
