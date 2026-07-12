function validateLanes(lanes) {
  const ids = new Set();
  if (!Array.isArray(lanes) || lanes.length === 0) throw new TypeError("invalid lanes");
  for (const lane of lanes) {
    if (typeof lane?.id !== "string" || ids.has(lane.id) || !Number.isSafeInteger(lane.quantum) || lane.quantum <= 0) {
      throw new TypeError("invalid lane");
    }
    ids.add(lane.id);
  }
}

export class DeficitScheduler {
  #ids = new Set();
  #lanes;
  #pointer = 0;

  constructor(lanes) {
    validateLanes(lanes);
    this.#lanes = lanes.map((lane) => ({ ...lane, queue: [] }));
  }

  enqueue(laneId, job) {
    const lane = this.#lanes.find((candidate) => candidate.id === laneId);
    if (!lane) throw new TypeError("unknown lane");
    if (typeof job?.id !== "string" || this.#ids.has(job.id) || !Number.isSafeInteger(job.cost) || job.cost <= 0) {
      throw new TypeError("invalid job");
    }
    this.#ids.add(job.id);
    lane.queue.push({ ...job });
  }

  next() {
    for (let visited = 0; visited < this.#lanes.length; visited += 1) {
      const lane = this.#lanes[this.#pointer];
      this.#pointer = (this.#pointer + 1) % this.#lanes.length;
      const job = lane.queue[0];
      if (job && job.cost <= lane.quantum) {
        lane.queue.shift();
        return { laneId: lane.id, job };
      }
    }
    return null;
  }
}
