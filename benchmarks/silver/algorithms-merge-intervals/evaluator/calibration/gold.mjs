export function mergeIntervals(intervals) {
  if (!Array.isArray(intervals)) return [];
  if (intervals.some((item) => !Array.isArray(item) || item.length !== 2 ||
    !Number.isFinite(item[0]) || !Number.isFinite(item[1]) || item[0] > item[1])) return [];
  const ordered = intervals.map(([start, end]) => [start, end]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const merged = [];
  for (const interval of ordered) {
    const last = merged.at(-1);
    if (!last || interval[0] > last[1]) merged.push(interval);
    else last[1] = Math.max(last[1], interval[1]);
  }
  return merged;
}
