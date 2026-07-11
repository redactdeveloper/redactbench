import { describe, expect, it } from "vitest";

import { aggregateJournal } from "../src/aggregate.js";
import type { JournalEntry, JournalPayload } from "../src/journal.js";

function entry(sequence: number, payload: JournalPayload): JournalEntry {
  return {
    hash: String(sequence).padStart(64, "0"),
    payload,
    previousHash: sequence === 1 ? null : String(sequence - 1).padStart(64, "0"),
    schemaVersion: 1,
    sequence,
    timestamp: `2026-07-12T00:00:0${sequence}.000Z`
  };
}

function attempt(
  attemptId: string,
  modelId: string,
  taskId: "debug" | "security",
  score: number,
  costUsd: number | null
): JournalPayload {
  const category = taskId === "debug" ? "debugging" : "security";
  return {
    type: "attempt.completed",
    artifacts: {
      notes: null,
      patchHash: null,
      promptHash: "a".repeat(64),
      responseHash: "b".repeat(64)
    },
    imageIds: ["sha256:image"],
    report: {
      attemptId,
      taskId,
      taskTitle: taskId,
      category,
      modelId,
      provider: "fixture",
      providerModel: "fixture-v1",
      repeat: 1,
      startedAt: "2026-07-12T00:00:00.000Z",
      completedAt: "2026-07-12T00:00:01.000Z",
      status: score === 1 ? "passed" : "failed",
      score,
      metrics: {
        costUsd,
        durationMs: 1_000,
        inputTokens: 10,
        outputTokens: 20,
        outputTokensPerSecond: modelId === "known" ? 40 : null,
        ttftMs: modelId === "known" ? 250 : null
      },
      checks: []
    },
    taskWeight: taskId === "debug" ? 1 : 3
  };
}

describe("aggregateJournal", () => {
  it("builds category, cost and performance metrics from deduplicated attempts", () => {
    const started: JournalPayload = {
      type: "run.started",
      configHash: "c".repeat(64),
      run: {
        id: "run-demo",
        title: "Demo",
        suiteId: "demo",
        scorerVersion: "1.0.0",
        startedAt: "2026-07-12T00:00:00.000Z",
        repeatCount: 1,
        models: [
          { id: "known", label: "Known", model: "fixture-v1", provider: "fixture" },
          { id: "unknown", label: "Unknown", model: "fixture-v1", provider: "fixture" }
        ],
        tasks: [
          { category: "debugging", id: "debug", title: "debug", weight: 1 },
          { category: "security", id: "security", title: "security", weight: 3 }
        ]
      }
    };
    const entries = [
      entry(1, started),
      entry(2, attempt("known-debug", "known", "debug", 0, 1)),
      entry(3, attempt("known-debug", "known", "debug", 1, 1)),
      entry(4, attempt("known-security", "known", "security", 0.5, 3)),
      entry(5, attempt("unknown-debug", "unknown", "debug", 1, null)),
      entry(6, attempt("unknown-security", "unknown", "security", 1, null)),
      entry(7, {
        type: "run.completed",
        completedAt: "2026-07-12T00:00:07.000Z",
        runId: "run-demo"
      })
    ];

    const report = aggregateJournal(entries, "2026-07-12T00:00:08.000Z");
    const known = report.leaderboard.find((model) => model.modelId === "known");
    const unknown = report.leaderboard.find((model) => model.modelId === "unknown");

    expect(report.attempts).toHaveLength(4);
    expect(known).toMatchObject({
      score: 0.625,
      categories: { debugging: 1, security: 0.5 },
      metrics: {
        attemptCount: 2,
        avgTtftMs: 250,
        correctCount: 1,
        costPerCorrectUsd: 4,
        outputTokensPerSecond: 40,
        totalCostUsd: 4
      }
    });
    expect(unknown?.metrics).toMatchObject({
      avgTtftMs: null,
      costPerCorrectUsd: null,
      outputTokensPerSecond: null,
      totalCostUsd: null
    });
    expect(report.sandbox.imageIds).toEqual(["sha256:image"]);
  });
});
