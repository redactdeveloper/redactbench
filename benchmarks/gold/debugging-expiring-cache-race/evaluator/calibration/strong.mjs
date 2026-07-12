export class ExpiringCache {
  #entries = new Map();
  #inFlight = new Map();
  #generations = new Map();
  #now;

  constructor({ now = Date.now } = {}) {
    this.#now = now;
  }

  set(key, value, ttlMs) {
    this.#generations.set(key, (this.#generations.get(key) ?? 0) + 1);
    this.#entries.set(key, { value, expiresAt: this.#now() + ttlMs });
    this.#inFlight.delete(key);
  }

  get(key, loader, ttlMs) {
    const cached = this.#entries.get(key);
    if (cached && cached.expiresAt > this.#now()) return Promise.resolve(cached.value);
    if (cached) {
      this.#entries.delete(key);
      this.#generations.set(key, (this.#generations.get(key) ?? 0) + 1);
    }

    const active = this.#inFlight.get(key);
    if (active) return active;
    const generation = this.#generations.get(key) ?? 0;
    let promise;
    promise = Promise.resolve()
      .then(loader)
      .then((value) => {
        if ((this.#generations.get(key) ?? 0) === generation) {
          this.#entries.set(key, { value, expiresAt: this.#now() + ttlMs });
        }
        return value;
      })
      .finally(() => {
        if (this.#inFlight.get(key) === promise) this.#inFlight.delete(key);
      });
    this.#inFlight.set(key, promise);
    return promise;
  }
}
