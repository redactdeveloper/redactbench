export class ExpiringCache {
  #entries = new Map();
  #active = null;
  #now;

  constructor({ now = Date.now } = {}) {
    this.#now = now;
  }

  set(key, value, ttlMs) {
    this.#entries.set(key, { value, expiresAt: this.#now() + ttlMs });
  }

  get(key, loader, ttlMs) {
    const cached = this.#entries.get(key);
    if (cached && cached.expiresAt > this.#now()) return Promise.resolve(cached.value);
    if (this.#active) return this.#active;
    this.#active = Promise.resolve()
      .then(loader)
      .then((value) => {
        this.set(key, value, ttlMs);
        return value;
      })
      .catch((error) => {
        this.#entries.delete(key);
        throw error;
      })
      .finally(() => {
        this.#active = null;
      });
    return this.#active;
  }
}
