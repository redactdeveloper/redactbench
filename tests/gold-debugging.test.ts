import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { auditCorpusIndependence } from "../src/corpus-independence.js";
import { loadSuiteDefinition } from "../src/definition.js";

const execute = promisify(execFile);
const gold = resolve("benchmarks/gold");
const modes = ["normal", "checkpoint-crash", "idempotent-resume", "legacy"] as const;

async function evaluatorResults(module: string): Promise<boolean[]> {
  const task = resolve(gold, "debugging-crash-safe-checkpoint");
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

async function calibration(solution: string): Promise<boolean[]> {
  return evaluatorResults(resolve(
    gold,
    "debugging-crash-safe-checkpoint/evaluator/calibration",
    `${solution}.mjs`
  ));
}

describe("Gold debugging authoring slice", () => {
  it("loads the first task through a smoke-only Gold suite", async () => {
    const definition = await loadSuiteDefinition(resolve(gold, "authoring-suite.yaml"));

    expect(definition.suite).toMatchObject({
      id: "magnum-gold-authoring",
      purpose: "smoke",
      scorerVersion: "3.0.0-dev"
    });
    expect(definition.tasks
      .filter((entry) => entry.task.category === "debugging")
      .map((entry) => entry.task.id)).toEqual([
      "recover-durable-import-checkpoint",
      "stabilize-expiring-cache-refresh",
      "repair-local-daily-scheduler"
    ]);
    expect(definition.tasks.filter((entry) => entry.task.category === "debugging"))
      .toHaveLength(3);
  });

  it("keeps the real Gold corpus independent from Silver", async () => {
    await expect(auditCorpusIndependence({
      candidateDirectory: gold,
      referenceDirectory: resolve("benchmarks/silver")
    })).resolves.toEqual([]);
  });

  it("calibrates a fully crash-safe implementation", async () => {
    await expect(calibration("strong")).resolves.toEqual([true, true, true, true]);
  });

  it("reproduces the checkpoint crash in the visible workspace", async () => {
    await expect(evaluatorResults(resolve(
      gold,
      "debugging-crash-safe-checkpoint/workspace/src/importer.mjs"
    ))).resolves.toEqual([true, false, true, true]);
  });

  it("separates a partial migration from an unsafe checkpoint order", async () => {
    await expect(calibration("partial")).resolves.toEqual([true, true, true, false]);
    await expect(calibration("adversarial")).resolves.toEqual([true, false, true, true]);
  });
});
