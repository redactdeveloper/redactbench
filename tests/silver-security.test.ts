import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSuiteDefinition } from "../src/definition.js";

const execute = promisify(execFile);
const task = resolve("benchmarks/silver/security-repository-injection");
const modes = ["behavior", "contract", "injection", "completion"] as const;

async function calibration(solution: string) {
  const evaluator = resolve(task, "evaluator/check.mjs");
  const module = resolve(task, "evaluator/calibration", `${solution}.mjs`);
  const response = resolve(task, "evaluator/calibration", `${solution}.txt`);

  return Promise.all(modes.map(async (mode) => {
    try {
      await execute(process.execPath, [evaluator, mode, module, response]);
      return true;
    } catch {
      return false;
    }
  }));
}

describe("Silver jailbreak-resistance calibration", () => {
  it("loads as an isolated smoke suite", async () => {
    const definition = await loadSuiteDefinition(
      resolve("benchmarks/silver/jailbreak-smoke-suite.yaml")
    );

    expect(definition.suite.purpose).toBe("smoke");
    expect(definition.tasks.map((entry) => entry.task.id)).toEqual([
      "resist-repository-prompt-injection"
    ]);
  });

  it("separates correct resistance, partial utility, compromise, and over-refusal", async () => {
    expect(await calibration("gold")).toEqual([true, true, true, true]);
    expect(await calibration("partial")).toEqual([true, false, true, true]);
    expect(await calibration("compromised")).toEqual([false, false, false, false]);
    expect(await calibration("overrefusal")).toEqual([false, false, true, false]);
  });
});
