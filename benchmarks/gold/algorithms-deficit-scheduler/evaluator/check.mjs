import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const mode = process.argv[2];
const modulePath = process.argv[3] ?? "/workspace/src/deficit-scheduler.mjs";
const { DeficitScheduler } = await import(pathToFileURL(modulePath).href);

function nextIds(scheduler, count) {
  return Array.from({ length: count }, () => scheduler.next()?.job.id ?? null);
}

if (mode === "weighted") {
  const scheduler = new DeficitScheduler([
    { id: "fast", quantum: 2 },
    { id: "slow", quantum: 1 }
  ]);
  scheduler.enqueue("fast", { id: "f1", cost: 1 });
  scheduler.enqueue("slow", { id: "s1", cost: 1 });
  scheduler.enqueue("fast", { id: "f2", cost: 1 });
  scheduler.enqueue("slow", { id: "s2", cost: 1 });
  scheduler.enqueue("fast", { id: "f3", cost: 1 });
  assert.deepEqual(nextIds(scheduler, 5), ["f1", "f2", "s1", "f3", "s2"]);
} else if (mode === "accumulation") {
  const scheduler = new DeficitScheduler([
    { id: "large", quantum: 2 },
    { id: "small", quantum: 1 }
  ]);
  scheduler.enqueue("large", { id: "large-5", cost: 5 });
  scheduler.enqueue("small", { id: "small-1", cost: 1 });
  scheduler.enqueue("small", { id: "small-2", cost: 1 });
  assert.deepEqual(nextIds(scheduler, 3), ["small-1", "small-2", "large-5"]);
} else if (mode === "fifo-dynamic") {
  const scheduler = new DeficitScheduler([
    { id: "a", quantum: 2 },
    { id: "b", quantum: 1 }
  ]);
  scheduler.enqueue("a", { id: "a1", cost: 1 });
  scheduler.enqueue("a", { id: "a2", cost: 1 });
  assert.equal(scheduler.next()?.job.id, "a1");
  scheduler.enqueue("b", { id: "b1", cost: 1 });
  assert.deepEqual(nextIds(scheduler, 2), ["a2", "b1"]);
  assert.equal(scheduler.next(), null);
} else if (mode === "contract") {
  assert.throws(
    () => new DeficitScheduler([{ id: "same", quantum: 1 }, { id: "same", quantum: 2 }]),
    /lane/u
  );
  const lanes = [Object.freeze({ id: "only", quantum: 1 })];
  const scheduler = new DeficitScheduler(lanes);
  const job = Object.freeze({ id: "job", cost: 1, payload: "kept" });
  scheduler.enqueue("only", job);
  assert.deepEqual(scheduler.next(), { laneId: "only", job: { id: "job", cost: 1, payload: "kept" } });
  assert.equal(job.payload, "kept");
  assert.throws(() => scheduler.enqueue("missing", { id: "other", cost: 1 }), /lane/u);
  assert.throws(() => scheduler.enqueue("only", { id: "bad", cost: 0 }), /job/u);
} else {
  throw new Error(`unknown evaluator mode: ${mode}`);
}
