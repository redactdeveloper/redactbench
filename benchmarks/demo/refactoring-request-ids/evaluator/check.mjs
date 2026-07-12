import { readFile } from "node:fs/promises";

import { createRequestIdGenerator } from "/workspace/request-ids.mjs";

const scenario = process.argv[2];

const scenarios = {
  sequence() {
    const next = createRequestIdGenerator("req");
    return next() === "req-1" && next() === "req-2" && next() === "req-3";
  },
  isolation() {
    const first = createRequestIdGenerator("same");
    return (
      first() === "same-1" &&
      first() === "same-2" &&
      createRequestIdGenerator("same")() === "same-1" &&
      first() === "same-3"
    );
  },
  prefix() {
    return createRequestIdGenerator("job")() === "job-1";
  },
  async structure() {
    const source = await readFile("/workspace/request-ids.mjs", "utf8");
    const exportOffset = source.indexOf("export function createRequestIdGenerator");
    if (exportOffset < 0) return false;
    const moduleScope = source.slice(0, exportOffset);
    return (
      !/^\s*(?:let|var)\s+/mu.test(moduleScope) &&
      !/^\s*const\s+\w+\s*=\s*new\s+(?:Map|Set|WeakMap|WeakSet)\b/mu.test(
        moduleScope
      )
    );
  }
};

if (
  !scenario ||
  !(scenario in scenarios) ||
  !(await scenarios[scenario]())
) {
  console.error(`Refactoring scenario failed: ${scenario ?? "missing"}`);
  process.exit(1);
}
