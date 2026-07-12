import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSuiteDefinition } from "../src/definition.js";

const execute = promisify(execFile);
const task = resolve("benchmarks/gold/debugging-dst-scheduler");
const modes = ["spring-forward", "fall-back", "ordinary", "utc-contract"] as const;

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

describe("Gold local-time scheduler calibration", () => {
  it("is registered as the third debugging task", async () => {
    const definition = await loadSuiteDefinition(resolve("benchmarks/gold/authoring-suite.yaml"));
    expect(definition.tasks.map((entry) => entry.task.id)).toContain(
      "repair-local-daily-scheduler"
    );
  });

  it("calibrates the specified skipped and duplicated time policies", async () => {
    await expect(calibration("strong")).resolves.toEqual([true, true, true, true]);
  });

  it("separates choosing the second duplicated instant from a correct ordinary schedule", async () => {
    await expect(calibration("partial")).resolves.toEqual([false, false, true, true]);
  });

  it("separates fixed-duration arithmetic from local calendar scheduling", async () => {
    await expect(calibration("adversarial")).resolves.toEqual([false, false, false, true]);
  });

  it("reproduces the fixed-duration defect in the visible workspace", async () => {
    await expect(evaluatorResults(resolve(task, "workspace/src/scheduler.mjs")))
      .resolves.toEqual([false, false, false, true]);
  });
});
