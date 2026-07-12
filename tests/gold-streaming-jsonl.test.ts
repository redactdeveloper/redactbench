import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadSuiteDefinition } from "../src/definition.js";

const execute = promisify(execFile);
const task = resolve("benchmarks/gold/algorithms-streaming-jsonl");
const modes = ["boundaries", "utf8", "line-contract", "limits"] as const;

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

describe("Gold streaming JSONL calibration", () => {
  it("is registered as an independent algorithms task", async () => {
    const definition = await loadSuiteDefinition(resolve("benchmarks/gold/authoring-suite.yaml"));
    const entry = definition.tasks.find((candidate) =>
      candidate.task.id === "decode-chunked-jsonl-stream"
    );
    expect(entry?.task.category).toBe("algorithms");
  });

  it("accepts a byte-safe streaming implementation", async () => {
    await expect(calibration("strong")).resolves.toEqual([true, true, true, true]);
  });

  it("detects a decoder that corrupts split UTF-8 sequences", async () => {
    await expect(calibration("partial")).resolves.toEqual([true, false, true, true]);
  });

  it("detects per-chunk framing and missing finalization", async () => {
    await expect(calibration("adversarial")).resolves.toEqual([false, false, true, false]);
  });

  it("reproduces the framing defects in the visible workspace", async () => {
    await expect(evaluatorResults(resolve(task, "workspace/src/jsonl-decoder.mjs")))
      .resolves.toEqual([false, false, true, false]);
  });
});
