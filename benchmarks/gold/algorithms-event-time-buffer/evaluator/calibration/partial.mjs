function validateEvent(event) {
  if (typeof event?.id !== "string" || event.id.length === 0 || !Number.isSafeInteger(event.at)) {
    throw new TypeError("invalid event");
  }
}

export class EventTimeBuffer {
  #buffer = [];
  #finished = false;
  #maxSeenAt = Number.NEGATIVE_INFINITY;

  constructor({ maxLatenessMs }) {
    if (!Number.isSafeInteger(maxLatenessMs) || maxLatenessMs < 0) throw new TypeError("invalid maxLatenessMs");
    this.maxLatenessMs = maxLatenessMs;
  }

  push(event) {
    if (this.#finished) throw new Error("buffer is finished");
    validateEvent(event);
    this.#maxSeenAt = Math.max(this.#maxSeenAt, event.at);
    const watermark = this.#maxSeenAt - this.maxLatenessMs;
    if (event.at >= watermark) this.#buffer.push({ ...event });
    const ready = this.#buffer.filter((item) => item.at <= watermark).sort((a, b) => a.at - b.at);
    this.#buffer = this.#buffer.filter((item) => item.at > watermark);
    return ready;
  }

  finish() {
    if (this.#finished) throw new Error("buffer is finished");
    this.#finished = true;
    return this.#buffer.sort((a, b) => a.at - b.at);
  }
}
