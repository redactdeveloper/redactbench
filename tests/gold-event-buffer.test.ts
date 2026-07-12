import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSuiteDefinition } from "../src/definition.js";

const execute = promisify(execFile);
const task = resolve("benchmarks/gold/algorithms-event-time-buffer");
const modes = ["reorder", "ties", "late-dedupe", "finish-contract"] as const;

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

describe("Gold event-time buffer calibration", () => {
  it("is registered in the algorithms slice", async () => {
    const definition = await loadSuiteDefinition(resolve("benchmarks/gold/authoring-suite.yaml"));
    expect(definition.tasks.find((entry) => entry.task.id === "order-watermarked-events")?.task.category)
      .toBe("algorithms");
  });

  it("accepts deterministic watermark ordering", async () => {
    await expect(calibration("strong")).resolves.toEqual([true, true, true, true]);
  });

  it("detects arrival-order ties and duplicate emission", async () => {
    await expect(calibration("partial")).resolves.toEqual([true, false, false, true]);
  });

  it("detects a buffer that emits before the watermark", async () => {
    await expect(calibration("adversarial")).resolves.toEqual([false, false, false, false]);
  });

  it("reproduces premature emission in the visible workspace", async () => {
    await expect(evaluatorResults(resolve(task, "workspace/src/event-time-buffer.mjs")))
      .resolves.toEqual([false, false, false, false]);
  });
});
