import { topKFrequent } from "/workspace/top-k.mjs";

const scenario = process.argv[2];
const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);

const scenarios = {
  frequency() {
    return equal(topKFrequent([3, 1, 1, 2, 2, 2], 2), [2, 1]);
  },
  ties() {
    return equal(topKFrequent([4, 2, 4, 2, 3, 3], 3), [2, 3, 4]);
  },
  edges() {
    return (
      equal(topKFrequent([], 3), []) &&
      equal(topKFrequent([5, 5, 2], 10), [5, 2]) &&
      equal(topKFrequent([1], 0), []) &&
      equal(topKFrequent([1], 1.5), [])
    );
  },
  immutable() {
    const values = Object.freeze([7, 8, 8, 7, 7]);
    return equal(topKFrequent(values, 2), [7, 8]) && equal(values, [7, 8, 8, 7, 7]);
  }
};

if (!scenario || !(scenario in scenarios) || !scenarios[scenario]()) {
  console.error(`Algorithm scenario failed: ${scenario ?? "missing"}`);
  process.exit(1);
}
