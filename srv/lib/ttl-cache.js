'use strict';

class TtlCache {
  #store = new Map();
  #ttlMs;

  constructor(ttlSeconds = 60) {
    this.#ttlMs = ttlSeconds * 1000;
  }

  get(key) {
    const entry = this.#store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) { this.#store.delete(key); return null; }
    return entry.data;
  }

  set(key, data) {
    this.#store.set(key, { data, expiresAt: Date.now() + this.#ttlMs });
  }

  invalidate(key)  { this.#store.delete(key); }
  invalidateAll()  { this.#store.clear(); }
  get size()       { return this.#store.size; }
}

module.exports = { TtlCache };
