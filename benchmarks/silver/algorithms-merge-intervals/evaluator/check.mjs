import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const mode = process.argv[2];
const modulePath = process.argv[3] ?? "/workspace/intervals.mjs";
const { mergeIntervals } = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);

if (mode === "overlap") {
  assert.deepEqual(mergeIntervals([[1, 4], [2, 6], [9, 11]]), [[1, 6], [9, 11]]);
} else if (mode === "touching") {
  assert.deepEqual(mergeIntervals([[5, 7], [1, 10], [2, 3], [10, 12]]), [[1, 12]]);
} else if (mode === "ordering") {
  assert.deepEqual(mergeIntervals([[3.5, 4], [-5, -2], [-3, 1], [8, 9]]), [[-5, 1], [3.5, 4], [8, 9]]);
} else if (mode === "contract") {
  const input = [[4, 6], [1, 2]];
  const before = input.map((interval) => [...interval]);
  assert.deepEqual(mergeIntervals(input), [[1, 2], [4, 6]]);
  assert.deepEqual(input, before);
  assert.notEqual(mergeIntervals(input), input);
  assert.deepEqual(mergeIntervals([[1, 0]]), []);
  assert.deepEqual(mergeIntervals([[1, Number.NaN]]), []);
  assert.deepEqual(mergeIntervals("invalid"), []);
} else {
  throw new Error(`unknown mode: ${mode}`);
}
