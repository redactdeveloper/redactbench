function laneStates(lanes) {
  if (!Array.isArray(lanes) || lanes.length === 0) throw new TypeError("lanes must be non-empty");
  const ids = new Set();
  return lanes.map((lane) => {
    if (
      typeof lane?.id !== "string" ||
      lane.id.length === 0 ||
      ids.has(lane.id) ||
      !Number.isSafeInteger(lane.quantum) ||
      lane.quantum <= 0
    ) {
      throw new TypeError("invalid lane");
    }
    ids.add(lane.id);
    return { deficit: 0, id: lane.id, quantum: lane.quantum, queue: [] };
  });
}

export class DeficitScheduler {
  #credited = false;
  #jobIds = new Set();
  #lanes;
  #pointer = 0;

  constructor(lanes) {
    this.#lanes = laneStates(lanes);
  }

  enqueue(laneId, job) {
    const lane = this.#lanes.find((candidate) => candidate.id === laneId);
    if (!lane) throw new TypeError("unknown lane");
    if (
      typeof job?.id !== "string" ||
      job.id.length === 0 ||
      this.#jobIds.has(job.id) ||
      !Number.isSafeInteger(job.cost) ||
      job.cost <= 0
    ) {
      throw new TypeError("invalid job");
    }
    this.#jobIds.add(job.id);
    lane.queue.push({ ...job });
  }

  next() {
    if (this.#lanes.every((lane) => lane.queue.length === 0)) return null;
    for (;;) {
      const lane = this.#lanes[this.#pointer];
      if (lane.queue.length === 0) {
        lane.deficit = 0;
        this.#advance();
        continue;
      }
      if (!this.#credited) {
        lane.deficit += lane.quantum;
        this.#credited = true;
      }
      const job = lane.queue[0];
      if (job.cost <= lane.deficit) {
        lane.queue.shift();
        lane.deficit -= job.cost;
        return { laneId: lane.id, job };
      }
      this.#advance();
    }
  }

  #advance() {
    this.#pointer = (this.#pointer + 1) % this.#lanes.length;
    this.#credited = false;
  }
}
