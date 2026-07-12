export class ExpiringCache {
  #entries = new Map();
  #now;

  constructor({ now = Date.now } = {}) {
    this.#now = now;
  }

  set(key, value, ttlMs) {
    this.#entries.set(key, { value, expiresAt: this.#now() + ttlMs });
  }

  async get(key, loader, ttlMs) {
    const cached = this.#entries.get(key);
    if (cached && cached.expiresAt >= this.#now()) return cached.value;
    const value = await loader();
    this.set(key, value, ttlMs);
    return value;
  }
}
