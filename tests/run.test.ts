import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { AttemptOutcome } from "../src/attempt.js";
import { ModelConfigFileSchema, SuiteSchema, TaskSchema } from "../src/contracts.js";
import { runBenchmark } from "../src/run.js";

describe("runBenchmark", () => {
  it("resumes without executing a completed attempt twice", async () => {
    const directory = await mkdtemp(join(tmpdir(), "redactbench-run-"));
    const taskDirectory = join(directory, "task");
    await mkdir(join(taskDirectory, "workspace"), { recursive: true });
    await mkdir(join(taskDirectory, "evaluator"), { recursive: true });
    const task = TaskSchema.parse({
      schemaVersion: 1,
      id: "debug",
      title: "Debug",
      category: "debugging",
      description: "Debug a deterministic fixture.",
      prompt: "Fix it.",
      checks: [
        {
          argv: ["node", "/evaluator/check.mjs"],
          id: "check",
          image: "node:22-alpine"
        }
      ]
    });
    await writeFile(join(taskDirectory, "task.yaml"), JSON.stringify(task));
    const suite = SuiteSchema.parse({
      schemaVersion: 1,
      id: "demo",
      title: "Demo",
      tasks: [{ manifest: "task/task.yaml" }]
    });
    const models = ModelConfigFileSchema.parse({
      schemaVersion: 1,
      models: [
        {
          fixtureFile: "fixture.json",
          id: "fixture",
          label: "Fixture",
          model: "fixture-v1",
          provider: "fixture"
        }
      ]
    });
    const outcome: AttemptOutcome = {
      artifacts: {
        notes: null,
        patchHash: null,
        promptHash: "a".repeat(64),
        responseHash: "b".repeat(64)
      },
      imageIds: ["sha256:image"],
      report: {
        attemptId: "run-demo:debug:fixture:1",
        taskId: "debug",
        taskTitle: "Debug",
        category: "debugging",
        modelId: "fixture",
        provider: "fixture",
        providerModel: "fixture-v1",
        repeat: 1,
        startedAt: "2026-07-12T00:00:00.000Z",
        completedAt: "2026-07-12T00:00:01.000Z",
        status: "passed",
        score: 1,
        metrics: {
          costUsd: null,
          durationMs: 1_000,
          inputTokens: 1,
          outputTokens: 1,
          outputTokensPerSecond: 1,
          ttftMs: 1
        },
        checks: []
      }
    };
    const executeAttempt = vi.fn().mockResolvedValue(outcome);
    const journalFile = join(directory, "run", "journal.jsonl");
    const common = {
      executeAttempt,
      journalFile,
      modelConfigDirectory: directory,
      models,
      repeatCount: 1,
      runId: "run-demo",
      suite,
      suiteDirectory: directory
    };

    const first = await runBenchmark(common);
    const resumed = await runBenchmark(common);

    expect(executeAttempt).toHaveBeenCalledOnce();
    expect(first.attempts).toHaveLength(1);
    expect(resumed.attempts).toHaveLength(1);
    expect(resumed.leaderboard[0]?.score).toBe(1);
  });
});
