export function topKFrequent(values, k) {
  return [...new Set(values)].slice(0, k);
}
