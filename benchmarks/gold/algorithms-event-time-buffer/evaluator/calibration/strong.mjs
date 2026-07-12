function compareEvents(left, right) {
  return left.at - right.at || left.id.localeCompare(right.id);
}

function validateEvent(event) {
  if (
    typeof event !== "object" ||
    event === null ||
    typeof event.id !== "string" ||
    event.id.length === 0 ||
    !Number.isSafeInteger(event.at)
  ) {
    throw new TypeError("invalid event");
  }
}

export class EventTimeBuffer {
  #buffer = [];
  #finished = false;
  #maxSeenAt = Number.NEGATIVE_INFINITY;
  #seen = new Set();

  constructor({ maxLatenessMs }) {
    if (!Number.isSafeInteger(maxLatenessMs) || maxLatenessMs < 0) {
      throw new TypeError("invalid maxLatenessMs");
    }
    this.maxLatenessMs = maxLatenessMs;
  }

  #drain(watermark) {
    const ready = this.#buffer.filter((event) => event.at <= watermark).sort(compareEvents);
    this.#buffer = this.#buffer.filter((event) => event.at > watermark);
    return ready;
  }

  push(event) {
    if (this.#finished) throw new Error("buffer is finished");
    validateEvent(event);
    if (this.#seen.has(event.id)) return [];
    this.#maxSeenAt = Math.max(this.#maxSeenAt, event.at);
    const watermark = this.#maxSeenAt - this.maxLatenessMs;
    if (event.at < watermark) return this.#drain(watermark);
    this.#seen.add(event.id);
    this.#buffer.push({ ...event });
    return this.#drain(watermark);
  }

  finish() {
    if (this.#finished) throw new Error("buffer is finished");
    this.#finished = true;
    return this.#buffer.sort(compareEvents);
  }
}
