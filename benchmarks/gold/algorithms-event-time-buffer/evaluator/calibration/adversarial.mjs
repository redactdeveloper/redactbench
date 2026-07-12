export class EventTimeBuffer {
  #finished = false;

  constructor({ maxLatenessMs }) {
    this.maxLatenessMs = maxLatenessMs;
  }

  push(event) {
    if (this.#finished) throw new Error("buffer is finished");
    return [{ ...event }];
  }

  finish() {
    if (this.#finished) throw new Error("buffer is finished");
    this.#finished = true;
    return [];
  }
}
