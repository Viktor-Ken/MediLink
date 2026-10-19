export class LRU {
  constructor({ max = 1000, ttlMs = 0 } = {}) {
    if (!Number.isInteger(max) || max < 1) {
      throw new TypeError('LRU max must be a positive integer');
    }
    if (!Number.isFinite(ttlMs) || ttlMs < 0) {
      throw new TypeError('LRU ttlMs must be a finite number >= 0');
    }
    this.max = max;
    this.ttlMs = ttlMs;
    this.map = new Map();
  }

  get size() {
    return this.map.size;
  }

  get(key, now = Date.now()) {
    const entry = this.map.get(key);
    if (entry === undefined) return undefined;
    if (this.ttlMs > 0 && now - entry.at >= this.ttlMs) {
      this.map.delete(key);
      return undefined;
    }
    this.map.delete(key);
    this.map.set(key, entry);
    return entry.value;
  }

  set(key, value, now = Date.now()) {
    this.map.delete(key);
    this.map.set(key, { value, at: now });
    while (this.map.size > this.max) {
      this.map.delete(this.map.keys().next().value);
    }
    return this;
  }

  delete(key) {
    return this.map.delete(key);
  }

  clear() {
    this.map.clear();
  }
}
