import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { AttemptOutcome } from "../src/attempt.js";
import { ModelConfigFileSchema, SuiteSchema, TaskSchema } from "../src/contracts.js";
import { runBenchmark, type RunProgressEvent } from "../src/run.js";

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
    const firstProgress = vi.fn(async (event: RunProgressEvent) => {
      if (event.type === "attempt.completed") {
        expect(await readFile(journalFile, "utf8"))
          .toContain('"type":"attempt.completed"');
      }
    });
    const firstReports = vi.fn();
    const resumedProgress = vi.fn();
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

    const first = await runBenchmark({ ...common, onProgress: firstProgress, onReport: firstReports });
    const resumed = await runBenchmark({ ...common, onProgress: resumedProgress });

    expect(executeAttempt).toHaveBeenCalledOnce();
    expect(first.attempts).toHaveLength(1);
    expect(resumed.attempts).toHaveLength(1);
    expect(resumed.leaderboard[0]?.score).toBe(1);
    expect(firstReports.mock.calls.map(([snapshot]) => ({
      attempts: snapshot.attempts.length,
      completedAt: snapshot.run.completedAt === null ? null : "set",
      score: snapshot.leaderboard[0]?.score
    }))).toEqual([
      { attempts: 0, completedAt: null, score: 0 },
      { attempts: 1, completedAt: null, score: 1 },
      { attempts: 1, completedAt: "set", score: 1 }
    ]);
    expect(firstProgress.mock.calls.map(([event]) => event)).toEqual([
      {
        completedAttempts: 0,
        remainingAttempts: 1,
        resumed: false,
        runId: "run-demo",
        totalAttempts: 1,
        type: "run.ready"
      },
      {
        attemptId: "run-demo:debug:fixture:1",
        completedAttempts: 1,
        modelId: "fixture",
        modelLabel: "Fixture",
        score: 1,
        status: "passed",
        taskId: "debug",
        taskTitle: "Debug",
        totalAttempts: 1,
        type: "attempt.completed"
      },
      {
        completedAttempts: 1,
        runId: "run-demo",
        totalAttempts: 1,
        type: "run.completed"
      }
    ]);
    expect(resumedProgress.mock.calls.map(([event]) => event)).toEqual([
      {
        completedAttempts: 1,
        remainingAttempts: 0,
        resumed: true,
        runId: "run-demo",
        totalAttempts: 1,
        type: "run.ready"
      },
      {
        completedAttempts: 1,
        runId: "run-demo",
        totalAttempts: 1,
        type: "run.completed"
      }
    ]);
  });
});
