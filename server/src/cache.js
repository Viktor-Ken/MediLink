import { LRU } from './lru.js';

const disabled = process.env.CACHE_DISABLED === '1';
const inflight = new Map();

export function createCache(name, { max = 32, ttlMs = 30_000 } = {}) {
  return { name, lru: new LRU({ max, ttlMs }) };
}

export async function load(cache, key, producer) {
  if (disabled) return { value: await producer(), hit: false };

  const cached = cache.lru.get(key);
  if (cached !== undefined) return { value: cached, hit: true };

  const flightKey = `${cache.name}\u0000${key}`;
  const pending = inflight.get(flightKey);
  if (pending !== undefined) return { value: await pending, hit: true };

  const promise = Promise.resolve()
    .then(producer)
    .then((value) => {
      cache.lru.set(key, value);
      return value;
    })
    .finally(() => inflight.delete(flightKey));

  inflight.set(flightKey, promise);
  return { value: await promise, hit: false };
}

export function invalidate(cache) {
  cache.lru.clear();
}

export const caches = {
  departments: createCache('departments', { ttlMs: 30_000 }),
  staff: createCache('staff', { ttlMs: 30_000 }),
  wards: createCache('wards', { ttlMs: 10_000 }),
};
