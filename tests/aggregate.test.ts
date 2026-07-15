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
  costUsd: number | null,
  repeat = 1
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
      repeat,
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
        concurrency: 3,
        seed: 42,
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
    expect(report.attempts[0]?.taskWeight).toBe(1);
    expect(report.run).toMatchObject({ concurrency: 3, seed: 42 });
    expect(known).toMatchObject({
      score: 0.625,
      categories: { debugging: 1, security: 0.5 },
      scoreStatistics: {
        confidence95: null,
        sampleCount: 1,
        standardDeviation: null,
        standardError: null
      },
      categoryStatistics: {
        debugging: { sampleCount: 1 },
        security: { sampleCount: 1 }
      },
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

  it("computes uncertainty from complete weighted repeats only", () => {
    const started: JournalPayload = {
      type: "run.started",
      configHash: "d".repeat(64),
      run: {
        id: "run-repeated",
        title: "Repeated",
        suiteId: "demo",
        scorerVersion: "1.1.0",
        startedAt: "2026-07-12T00:00:00.000Z",
        repeatCount: 4,
        models: [
          { id: "known", label: "Known", model: "fixture-v1", provider: "fixture" }
        ],
        tasks: [
          { category: "debugging", id: "debug", title: "debug", weight: 1 },
          { category: "security", id: "security", title: "security", weight: 3 }
        ]
      }
    };
    const entries = [
      entry(1, started),
      entry(2, attempt("known-debug-1", "known", "debug", 0.4, 0, 1)),
      entry(3, attempt("known-security-1", "known", "security", 0.4, 0, 1)),
      entry(4, attempt("known-debug-2", "known", "debug", 0.5, 0, 2)),
      entry(5, attempt("known-security-2", "known", "security", 0.5, 0, 2)),
      entry(6, attempt("known-debug-3", "known", "debug", 0.6, 0, 3)),
      entry(7, attempt("known-security-3", "known", "security", 0.6, 0, 3)),
      entry(8, attempt("known-debug-4", "known", "debug", 1, 0, 4))
    ];

    const report = aggregateJournal(entries, "2026-07-12T00:00:09.000Z");
    const model = report.leaderboard[0]!;

    expect(model.score).toBeCloseTo(0.5, 12);
    expect(model.scoreStatistics.sampleCount).toBe(3);
    expect(model.scoreStatistics.standardDeviation).toBeCloseTo(0.1, 12);
    expect(model.scoreStatistics.confidence95?.lower).toBeCloseTo(0.251567, 5);
    expect(model.scoreStatistics.confidence95?.upper).toBeCloseTo(0.748433, 5);
    expect(model.categoryStatistics.debugging?.sampleCount).toBe(4);
    expect(model.categoryStatistics.security?.sampleCount).toBe(3);
  });

  it("rejects attempt weights that disagree with the run definition", () => {
    const started: JournalPayload = {
      type: "run.started",
      configHash: "e".repeat(64),
      run: {
        id: "run-invalid-weight",
        title: "Invalid weight",
        suiteId: "demo",
        scorerVersion: "1.1.0",
        startedAt: "2026-07-12T00:00:00.000Z",
        repeatCount: 1,
        models: [
          { id: "known", label: "Known", model: "fixture-v1", provider: "fixture" }
        ],
        tasks: [{ category: "debugging", id: "debug", title: "debug", weight: 1 }]
      }
    };
    const mismatched = attempt("known-debug", "known", "debug", 1, 0);
    if (mismatched.type !== "attempt.completed") throw new Error("invalid fixture");
    mismatched.taskWeight = 3;

    expect(() => aggregateJournal([entry(1, started), entry(2, mismatched)])).toThrow(
      /task weight/i
    );
  });

  it("keeps model-output failures rankable but invalidates provider and infrastructure failures", () => {
    const started: JournalPayload = {
      type: "run.started",
      configHash: "f".repeat(64),
      run: {
        id: "run-validity",
        title: "Validity",
        suiteId: "demo",
        scorerVersion: "1.2.0",
        startedAt: "2026-07-12T00:00:00.000Z",
        repeatCount: 1,
        models: [
          { id: "known", label: "Known", model: "fixture-v1", provider: "fixture" }
        ],
        tasks: [
          { category: "debugging", id: "debug", title: "debug", weight: 1 },
          { category: "security", id: "security", title: "security", weight: 3 }
        ]
      }
    };
    const providerFailure = attempt("known-debug", "known", "debug", 0, null);
    const modelFailure = attempt("known-security", "known", "security", 0, null);
    if (providerFailure.type !== "attempt.completed" || modelFailure.type !== "attempt.completed") {
      throw new Error("invalid fixture");
    }
    providerFailure.report.status = "error";
    providerFailure.report.error = { code: "PROVIDER_ERROR", message: "temporary upstream failure" };
    modelFailure.report.status = "error";
    modelFailure.report.error = { code: "PATCH_REJECTED", message: "invalid model response" };
    modelFailure.report.checks = [{
      durationMs: 0,
      errorCode: "DOCKER_ERROR",
      exitCode: null,
      id: "docker-check",
      output: "",
      status: "error",
      weight: 1
    }];

    const report = aggregateJournal([
      entry(1, started),
      entry(2, providerFailure),
      entry(3, modelFailure),
      entry(4, {
        type: "run.completed",
        completedAt: "2026-07-12T00:00:04.000Z",
        runId: "run-validity"
      })
    ]);

    expect(report.validity).toEqual({
      infrastructureFailureCount: 1,
      modelOutputFailureCount: 1,
      providerFailureCount: 1,
      validForRanking: false
    });
    expect(report.leaderboard[0]?.score).toBe(0);
  });
});
