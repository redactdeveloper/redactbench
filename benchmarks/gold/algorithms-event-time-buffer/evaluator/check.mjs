import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const mode = process.argv[2];
const modulePath = process.argv[3] ?? "/workspace/src/event-time-buffer.mjs";
const { EventTimeBuffer } = await import(pathToFileURL(modulePath).href);

function ids(events) {
  return events.map((event) => event.id);
}

if (mode === "reorder") {
  const buffer = new EventTimeBuffer({ maxLatenessMs: 10 });
  const emitted = [
    ...buffer.push({ id: "a", at: 100 }),
    ...buffer.push({ id: "b", at: 95 }),
    ...buffer.push({ id: "c", at: 120 }),
    ...buffer.finish()
  ];
  assert.deepEqual(ids(emitted), ["b", "a", "c"]);
} else if (mode === "ties") {
  const buffer = new EventTimeBuffer({ maxLatenessMs: 5 });
  const emitted = [
    ...buffer.push({ id: "z", at: 10 }),
    ...buffer.push({ id: "a", at: 10 }),
    ...buffer.push({ id: "marker", at: 20 }),
    ...buffer.finish()
  ];
  assert.deepEqual(ids(emitted), ["a", "z", "marker"]);
} else if (mode === "late-dedupe") {
  const buffer = new EventTimeBuffer({ maxLatenessMs: 10 });
  const emitted = [
    ...buffer.push({ id: "original", at: 100, value: 1 }),
    ...buffer.push({ id: "original", at: 101, value: 2 }),
    ...buffer.push({ id: "advance", at: 120 }),
    ...buffer.push({ id: "late", at: 90 }),
    ...buffer.finish()
  ];
  assert.deepEqual(ids(emitted), ["original", "advance"]);
  assert.equal(emitted[0].value, 1);
} else if (mode === "finish-contract") {
  const buffer = new EventTimeBuffer({ maxLatenessMs: 100 });
  const late = Object.freeze({ id: "late", at: 20, payload: "untouched" });
  const early = Object.freeze({ id: "early", at: 10, payload: "untouched" });
  assert.deepEqual(buffer.push(late), []);
  assert.deepEqual(buffer.push(early), []);
  assert.deepEqual(ids(buffer.finish()), ["early", "late"]);
  assert.equal(late.payload, "untouched");
  assert.throws(() => buffer.push({ id: "after", at: 30 }), /finished/u);
  assert.throws(() => new EventTimeBuffer({ maxLatenessMs: -1 }), /maxLatenessMs/u);
} else {
  throw new Error(`unknown evaluator mode: ${mode}`);
}
