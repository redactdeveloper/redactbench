export class DeficitScheduler {
  #queue = [];

  constructor(lanes) {
    this.lanes = lanes;
  }

  enqueue(laneId, job) {
    this.#queue.push({ laneId, job: { ...job } });
  }

  next() {
    return this.#queue.shift() ?? null;
  }
}
