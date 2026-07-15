export function mergeIntervals(intervals) {
  if (!Array.isArray(intervals)) return [];
  intervals.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const interval of intervals) {
    const last = merged.at(-1);
    if (!last || interval[0] >= last[1]) merged.push(interval);
    else last[1] = Math.max(last[1], interval[1]);
  }
  return merged;
}
