import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSuiteDefinition } from "../src/definition.js";

const execute = promisify(execFile);
const task = resolve("benchmarks/gold/debugging-expiring-cache-race");
const modes = ["concurrent", "stale-rejection", "ttl-boundary", "error-retry"] as const;

async function evaluatorResults(module: string): Promise<boolean[]> {
  const evaluator = resolve(task, "evaluator/check.mjs");
  return Promise.all(modes.map(async (mode) => {
    try {
      await execute(process.execPath, [evaluator, mode, module]);
      return true;
    } catch {
      return false;
    }
  }));
}

function calibration(solution: string): Promise<boolean[]> {
  return evaluatorResults(resolve(task, "evaluator/calibration", `${solution}.mjs`));
}

describe("Gold expiring cache calibration", () => {
  it("is registered in the smoke-only authoring suite", async () => {
    const definition = await loadSuiteDefinition(resolve("benchmarks/gold/authoring-suite.yaml"));
    expect(definition.tasks.map((entry) => entry.task.id)).toContain(
      "stabilize-expiring-cache-refresh"
    );
    expect(definition.suite.purpose).toBe("smoke");
  });

  it("gives the strong implementation a complete profile", async () => {
    await expect(calibration("strong")).resolves.toEqual([true, true, true, true]);
  });

  it("separates cross-key serialization and an unsafe refresh generation", async () => {
    await expect(calibration("partial")).resolves.toEqual([false, false, true, true]);
  });

  it("separates missing single-flight behavior and the TTL boundary", async () => {
    await expect(calibration("adversarial")).resolves.toEqual([false, true, false, true]);
  });

  it("reproduces all three refresh defects in the visible workspace", async () => {
    await expect(evaluatorResults(resolve(task, "workspace/src/expiring-cache.mjs")))
      .resolves.toEqual([false, false, false, true]);
  });
});
