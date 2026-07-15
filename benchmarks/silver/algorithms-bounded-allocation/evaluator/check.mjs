import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const mode = process.argv[2];
const modulePath = process.argv[3] ?? "/workspace/allocation.mjs";
const { selectRequests } = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);

if (mode === "priority") {
  assert.deepEqual(selectRequests([
    { id: "b", priority: 1, units: 1 },
    { id: "a", priority: 2, units: 2 },
    { id: "c", priority: 3, units: 2 }
  ], 4), ["c", "a"]);
} else if (mode === "bounded") {
  assert.deepEqual(selectRequests([
    { id: "huge", priority: 9, units: 8 },
    { id: "small-b", priority: 5, units: 3 },
    { id: "small-c", priority: 4, units: 2 }
  ], 5), ["small-b", "small-c"]);
} else if (mode === "ties") {
  assert.deepEqual(selectRequests([
    { id: "c", priority: 2, units: 1 },
    { id: "a", priority: 2, units: 1 },
    { id: "b", priority: 2, units: 1 }
  ], 2), ["a", "b"]);
} else if (mode === "contract") {
  const requests = [{ id: "a", priority: 1, units: 1 }];
  const before = requests.map((request) => ({ ...request }));
  assert.deepEqual(selectRequests(requests, 0), []);
  assert.deepEqual(requests, before);
  assert.deepEqual(selectRequests([{ id: "a", priority: 1, units: 1 }, { id: "a", priority: 2, units: 1 }], 2), []);
  assert.deepEqual(selectRequests([{ id: "a", priority: 1, units: 0 }], 2), []);
  assert.deepEqual(selectRequests([], 3), []);
  assert.deepEqual(selectRequests("invalid", 3), []);
  assert.deepEqual(selectRequests([], -1), []);
} else {
  throw new Error(`unknown mode: ${mode}`);
}
