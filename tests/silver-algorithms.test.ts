import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSuiteDefinition } from "../src/definition.js";

const execute = promisify(execFile);
const silver = resolve("benchmarks/silver");

async function calibrationResults(task: string, solution: string, modes: readonly string[]) {
  const evaluator = resolve(silver, task, "evaluator/check.mjs");
  const module = resolve(silver, task, "evaluator/calibration", `${solution}.mjs`);
  return Promise.all(modes.map(async (mode) => {
    try {
      await execute(process.execPath, [evaluator, mode, module]);
      return true;
    } catch {
      return false;
    }
  }));
}

describe("Silver authoring suite", () => {
  it("loads as smoke-only while the release corpus is incomplete", async () => {
    const definition = await loadSuiteDefinition(resolve(silver, "authoring-suite.yaml"));

    expect(definition.suite.purpose).toBe("smoke");
    expect(definition.tasks.map((entry) => entry.task.id)).toEqual([
      "merge-inclusive-intervals",
      "deterministic-build-order",
      "bounded-priority-allocation",
      "resist-repository-prompt-injection"
    ]);
    expect(new Set(definition.tasks.map((entry) => entry.directory))).toHaveLength(4);
    expect(definition.tasks.every((entry) =>
      entry.manifest.startsWith(`${entry.directory}/`) &&
      entry.task.workspace === "workspace" &&
      entry.task.evaluator === "evaluator"
    )).toBe(true);
  });

  it("calibrates merge intervals with distinct gold, partial, and adversarial outcomes", async () => {
    const modes = ["overlap", "touching", "ordering", "contract"];

    expect(await calibrationResults("algorithms-merge-intervals", "gold", modes))
      .toEqual([true, true, true, true]);
    expect(await calibrationResults("algorithms-merge-intervals", "partial", modes))
      .toEqual([true, false, true, false]);
    expect(await calibrationResults("algorithms-merge-intervals", "adversarial", modes))
      .toEqual([false, true, false, false]);
  });

  it("calibrates build ordering across dependencies, lexical choice, cycles, and input contracts", async () => {
    const modes = ["dependency", "lexical", "cycle", "contract"];

    expect(await calibrationResults("algorithms-build-order", "gold", modes))
      .toEqual([true, true, true, true]);
    expect(await calibrationResults("algorithms-build-order", "partial", modes))
      .toEqual([true, false, true, false]);
    expect(await calibrationResults("algorithms-build-order", "adversarial", modes))
      .toEqual([false, true, false, false]);
  });

  it("calibrates bounded allocation across priority, capacity, ties, and validation", async () => {
    const modes = ["priority", "bounded", "ties", "contract"];

    expect(await calibrationResults("algorithms-bounded-allocation", "gold", modes))
      .toEqual([true, true, true, true]);
    expect(await calibrationResults("algorithms-bounded-allocation", "partial", modes))
      .toEqual([true, false, false, false]);
    expect(await calibrationResults("algorithms-bounded-allocation", "adversarial", modes))
      .toEqual([false, false, true, false]);
  });
});
