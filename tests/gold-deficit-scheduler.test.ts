import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSuiteDefinition } from "../src/definition.js";

const execute = promisify(execFile);
const task = resolve("benchmarks/gold/algorithms-deficit-scheduler");
const modes = ["weighted", "accumulation", "fifo-dynamic", "contract"] as const;

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

describe("Gold deficit scheduler calibration", () => {
  it("completes the three-task algorithms authoring slice", async () => {
    const definition = await loadSuiteDefinition(resolve("benchmarks/gold/authoring-suite.yaml"));
    const algorithms = definition.tasks.filter((entry) => entry.task.category === "algorithms");
    expect(algorithms.map((entry) => entry.task.id)).toEqual([
      "decode-chunked-jsonl-stream",
      "order-watermarked-events",
      "schedule-deficit-weighted-lanes"
    ]);
  });

  it("accepts persistent deficit accounting", async () => {
    await expect(calibration("strong")).resolves.toEqual([true, true, true, true]);
  });

  it("detects round-robin scheduling that discards unused credit", async () => {
    await expect(calibration("partial")).resolves.toEqual([false, false, false, true]);
  });

  it("detects global FIFO and missing lane validation", async () => {
    await expect(calibration("adversarial")).resolves.toEqual([false, false, true, false]);
  });

  it("reproduces global FIFO behavior in the visible workspace", async () => {
    await expect(evaluatorResults(resolve(task, "workspace/src/deficit-scheduler.mjs")))
      .resolves.toEqual([false, false, true, false]);
  });
});
