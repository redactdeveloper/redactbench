export function buildOrder(nodes) {
  return Array.isArray(nodes) ? [...nodes].sort() : null;
}
