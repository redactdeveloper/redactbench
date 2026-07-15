export function buildOrder(nodes, edges) {
  if (!Array.isArray(nodes) || !Array.isArray(edges) || nodes.some((node) => typeof node !== "string" || node.length === 0) || new Set(nodes).size !== nodes.length) return null;
  const indegree = new Map(nodes.map((node) => [node, 0]));
  const outgoing = new Map(nodes.map((node) => [node, []]));
  for (const edge of edges) {
    if (!Array.isArray(edge) || edge.length !== 2 || !indegree.has(edge[0]) || !indegree.has(edge[1]) || edge[0] === edge[1]) return null;
    outgoing.get(edge[0]).push(edge[1]);
    indegree.set(edge[1], indegree.get(edge[1]) + 1);
  }
  const available = nodes.filter((node) => indegree.get(node) === 0).sort();
  const result = [];
  while (available.length) {
    const node = available.shift();
    result.push(node);
    for (const next of outgoing.get(node)) {
      indegree.set(next, indegree.get(next) - 1);
      if (indegree.get(next) === 0) {
        available.push(next);
        available.sort();
      }
    }
  }
  return result.length === nodes.length ? result : null;
}
