import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const mode = process.argv[2];
const modulePath = process.argv[3] ?? "/workspace/build-order.mjs";
const { buildOrder } = await import(`${pathToFileURL(modulePath).href}?v=${Date.now()}`);

if (mode === "dependency") {
  assert.deepEqual(buildOrder(["compile", "test", "deploy"], [["compile", "test"], ["test", "deploy"]]), ["compile", "test", "deploy"]);
  assert.deepEqual(buildOrder(["api", "db", "web"], [["db", "api"], ["db", "web"]]), ["db", "api", "web"]);
} else if (mode === "lexical") {
  assert.deepEqual(buildOrder(["z", "a", "m", "b"], [["a", "z"]]), ["a", "b", "m", "z"]);
} else if (mode === "cycle") {
  assert.equal(buildOrder(["a", "b"], [["a", "b"], ["b", "a"]]), null);
  assert.equal(buildOrder(["a"], [["a", "a"]]), null);
} else if (mode === "contract") {
  const nodes = ["b", "a"];
  const edges = [];
  const beforeNodes = [...nodes];
  const beforeEdges = edges.map((edge) => [...edge]);
  assert.deepEqual(buildOrder(nodes, edges), ["a", "b"]);
  assert.deepEqual(nodes, beforeNodes);
  assert.deepEqual(edges, beforeEdges);
  assert.deepEqual(buildOrder([], []), []);
  assert.equal(buildOrder(["a", "a"], []), null);
  assert.equal(buildOrder(["a"], [["a", "missing"]]), null);
  assert.equal(buildOrder("invalid", []), null);
} else {
  throw new Error(`unknown mode: ${mode}`);
}
