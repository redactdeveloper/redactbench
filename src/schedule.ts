export interface SchedulableAttemptJob {
  modelId: string;
  repeat: number;
  taskId: string;
}

function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function shuffle<T>(values: T[], random: () => number): T[] {
  for (let index = values.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [values[index], values[other]] = [values[other]!, values[index]!];
  }
  return values;
}

export function scheduleAttemptJobs<T extends SchedulableAttemptJob>(
  jobs: readonly T[],
  seed?: number,
  completed: (job: T) => boolean = () => false
): T[] {
  const blocks = new Map<string, T[]>();
  const modelOrder = [...new Set(jobs.map((job) => job.modelId))];
  for (const job of jobs) {
    const key = `${job.taskId}\0${job.repeat}`;
    const block = blocks.get(key) ?? [];
    block.push(job);
    blocks.set(key, block);
  }

  const random = seed === undefined ? null : seededRandom(seed);
  const orderedBlocks = [...blocks.values()];
  const orderedModels = [...modelOrder];
  if (random) {
    shuffle(orderedBlocks, random);
    shuffle(orderedModels, random);
  }

  return orderedBlocks.flatMap((block, blockIndex) => {
    const jobsByModel = new Map(block.map((job) => [job.modelId, job]));
    const rotation = orderedModels.length === 0 ? 0 : blockIndex % orderedModels.length;
    const rotated = [
      ...orderedModels.slice(rotation),
      ...orderedModels.slice(0, rotation)
    ];
    return rotated
      .flatMap((modelId) => {
        const job = jobsByModel.get(modelId);
        return job ? [job] : [];
      })
      .filter((job) => !completed(job));
  });
}
