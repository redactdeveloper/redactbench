export function buildOrder(nodes, edges) {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) return null;
  const indegree = new Map(nodes.map((node) => [node, 0]));
  const outgoing = new Map(nodes.map((node) => [node, []]));
  for (const [before, after] of edges) {
    if (!indegree.has(before) || !indegree.has(after) || before === after) return null;
    outgoing.get(before).push(after);
    indegree.set(after, indegree.get(after) + 1);
  }
  const queue = nodes.filter((node) => indegree.get(node) === 0);
  const result = [];
  while (queue.length) {
    const node = queue.shift();
    result.push(node);
    for (const next of outgoing.get(node)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) queue.push(next);
    }
  }
  return result.length === nodes.length ? result : null;
}
