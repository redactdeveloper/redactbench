import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import reportData from "../dashboard/public/report.json";
import {
  formatRunProgress,
  formatStartResult,
  startCommand
} from "../src/commands/start.js";
import { ReportSchema } from "../src/contracts.js";

const report = ReportSchema.parse(reportData);

describe("formatRunProgress", () => {
  it("renders resumable counts and sanitizes untrusted terminal labels", () => {
    expect(formatRunProgress({
      completedAttempts: 17,
      remainingAttempts: 71,
      resumed: true,
      runId: "target-run",
      totalAttempts: 88,
      type: "run.ready"
    })).toBe("Resuming target-run: 17/88 completed · 71 remaining\n");

    const output = formatRunProgress({
      attemptId: "target-run:task:model:1",
      completedAttempts: 18,
      modelId: "model",
      modelLabel: "Model\u200F\nInjected\u001B]8;;https://example.test\u0007",
      score: 0.75,
      status: "failed",
      taskId: "task",
      taskTitle: "Task\tTitle",
      totalAttempts: 88,
      type: "attempt.completed"
    });

    expect(output).toBe(
      "[18/88] FAILED 75.0% · Model Injected · Task Title\n"
    );
    expect([...output.slice(0, -1)].some((character) => {
      const code = character.codePointAt(0) ?? 0;
      return code <= 0x1f || (code >= 0x7f && code <= 0x9f);
    })).toBe(false);
  });

  it("sanitizes run identifiers, final leaderboard labels and output paths", () => {
    expect(formatRunProgress({
      completedAttempts: 88,
      runId: "target\u001B]8;;https://unsafe.test\u0007-run",
      totalAttempts: 88,
      type: "run.completed"
    })).toBe("Finished target-run: 88/88 attempts recorded\n");

    const unsafeReport = ReportSchema.parse({
      ...report,
      leaderboard: report.leaderboard.map((entry, index) =>
        index === 0
          ? {
              ...entry,
              label: "Fixture\u001B]8;;https://unsafe.test\u0007 Strong"
            }
          : entry
      )
    });
    const output = formatStartResult({
      dryRun: false,
      plan: {
        attemptCount: 88,
        concurrency: 1,
        entrantCount: 11,
        entrants: [],
        generationCount: 99,
        generationLimit: 100,
        generationReady: true,
        repeatCount: 1,
        runId: "target\u001B]8;;https://unsafe.test\u0007-run",
        seed: 20_260_712,
        suiteTitle: "Demo",
        taskCount: 8
      },
      report: unsafeReport,
      reportFile: "/tmp/report\u001B]8;;https://unsafe.test\u0007/index.html",
      runDirectory: "/tmp/run\nspoofed"
    });

    expect(output).toContain("Fixture Strong");
    expect(output).toContain("Run ID: target-run");
    expect(output).toContain("Static report: /tmp/report/index.html");
    expect(output).toContain("Run directory: /tmp/run spoofed");
    expect(output).not.toContain("unsafe.test");
  });
});

const options = {
  concurrency: 1,
  dryRun: true,
  env: {},
  fieldFile: "benchmarks/target-field.yaml",
  maxGenerations: 100,
  outDirectory: "runs",
  repeatCount: 1,
  runId: "target-dry-run",
  runtimesFile: "benchmarks/target-runtimes.yaml",
  seed: 20_260_712,
  suiteFile: "benchmarks/demo/suite.yaml"
} as const;

describe("startCommand", () => {
  it("produces a complete target plan without staging credentials or running models", async () => {
    const runBenchmark = vi.fn();
    const stageCredentials = vi.fn();
    const result = await startCommand(options, {
      ensureImages: vi.fn().mockResolvedValue([
        {
          harness: "codex",
          image: "redactbench/harness-codex:0.144.1-rb0.3.0",
          imageId: null,
          status: "build-required"
        }
      ]),
      ensureNetworks: vi.fn().mockResolvedValue([
        { name: "redactbench-egress-openai", status: "create-required" }
      ]),
      inspectCredentials: vi.fn().mockResolvedValue({
        checks: [
          { kind: "secret-file", name: "REDACTBENCH_ZAI_KEY_FILE", path: null, ready: false }
        ],
        ready: false
      }),
      preflightDocker: vi.fn().mockResolvedValue(undefined),
      runBenchmark,
      stageCredentials
    });

    expect(result.dryRun).toBe(true);
    expect(result.plan).toMatchObject({
      attemptCount: 88,
      concurrency: 1,
      entrantCount: 11,
      generationCount: 99,
      generationLimit: 100,
      generationReady: true,
      repeatCount: 1,
      taskCount: 8
    });
    expect(result.plan.entrants[3]).toMatchObject({
      label: "GPT-5.5 xHigh",
      model: "gpt-5.5",
      modelArguments: ["-c", "model_reasoning_effort=\"xhigh\""]
    });
    expect(runBenchmark).not.toHaveBeenCalled();
    expect(stageCredentials).not.toHaveBeenCalled();
    expect(formatStartResult(result)).toContain("No model or API requests were sent");
    expect(formatStartResult(result)).toContain("Generation budget: 99/100 · READY");
  });

  it("reports a blocked generation envelope in dry-run without model calls", async () => {
    const runBenchmark = vi.fn();
    const result = await startCommand(
      { ...options, maxGenerations: 50 },
      {
        ensureImages: vi.fn().mockResolvedValue([]),
        ensureNetworks: vi.fn().mockResolvedValue([]),
        inspectCredentials: vi.fn().mockResolvedValue({ checks: [], ready: true }),
        preflightDocker: vi.fn().mockResolvedValue(undefined),
        runBenchmark
      }
    );

    expect(result.plan.generationReady).toBe(false);
    expect(formatStartResult(result)).toContain(
      "Generation budget: 99/50 · BLOCKED"
    );
    expect(runBenchmark).not.toHaveBeenCalled();
  });

  it("runs, packages and summarizes the benchmark after every preflight passes", async () => {
    const outDirectory = await mkdtemp(join(tmpdir(), "redactbench-start-"));
    const cleanup = vi.fn().mockResolvedValue(undefined);
    const onProgress = vi.fn();
    const runBenchmark = vi.fn(async (input) => {
      expect(input.models.models).toHaveLength(11);
      expect(input.repeatCount).toBe(1);
      expect(input.createAdapter?.(input.models.models[0]!).workspaceMode).toBe(true);
      await input.onProgress?.({
        completedAttempts: 0,
        remainingAttempts: 88,
        resumed: false,
        runId: "target-dry-run",
        totalAttempts: 88,
        type: "run.ready"
      });
      return report;
    });
    const packageReport = vi.fn(async (_journal, output) => ({
      file: join(output, "report.json"),
      report
    }));

    try {
      const result = await startCommand(
        { ...options, dryRun: false, onProgress, outDirectory },
        {
          ensureImages: vi.fn().mockResolvedValue([
            {
              harness: "codex",
              image: "redactbench/harness-codex:0.144.1-rb0.3.0",
              imageId: `sha256:${"a".repeat(64)}`,
              status: "ready"
            }
          ]),
          ensureNetworks: vi.fn().mockResolvedValue([
            { name: "redactbench-egress-openai", status: "ready" }
          ]),
          inspectCredentials: vi.fn().mockResolvedValue({ checks: [], ready: true }),
          packageReport,
          preflightDocker: vi.fn().mockResolvedValue(undefined),
          runBenchmark,
          stageCredentials: vi.fn().mockResolvedValue({
            cleanup,
            environment: {},
            secretFiles: {}
          })
        }
      );

      expect(result.dryRun).toBe(false);
      if (result.dryRun) throw new Error("expected completed start result");
      expect(runBenchmark).toHaveBeenCalledOnce();
      expect(onProgress).toHaveBeenCalledWith(expect.objectContaining({
        totalAttempts: 88,
        type: "run.ready"
      }));
      expect(packageReport).toHaveBeenCalledOnce();
      expect(cleanup).toHaveBeenCalledOnce();
      expect(JSON.parse(await readFile(join(result.runDirectory, "run.json"), "utf8")))
        .toEqual(report);
      const output = formatStartResult(result);
      expect(output).toContain("Fixture Strong");
      expect(output).toContain("100.0%");
      expect(output).toContain("Static report:");
      expect(result.reportFile).toBe(join(result.runDirectory, "report", "index.html"));
    } finally {
      await rm(outDirectory, { force: true, recursive: true });
    }
  });

  it("fails before image builds and model calls when credentials are not ready", async () => {
    const ensureImages = vi.fn();
    const runBenchmark = vi.fn();

    await expect(startCommand(
      { ...options, dryRun: false },
      {
        ensureImages,
        ensureNetworks: vi.fn(),
        inspectCredentials: vi.fn().mockResolvedValue({
          checks: [
            { kind: "secret-file", name: "REDACTBENCH_ZAI_KEY_FILE", path: null, ready: false }
          ],
          ready: false
        }),
        preflightDocker: vi.fn().mockResolvedValue(undefined),
        runBenchmark
      }
    )).rejects.toThrow(/REDACTBENCH_ZAI_KEY_FILE/u);
    expect(ensureImages).not.toHaveBeenCalled();
    expect(runBenchmark).not.toHaveBeenCalled();
  });

  it("blocks an over-budget run before Docker preflight or credential checks", async () => {
    const inspectCredentials = vi.fn();
    const preflightDocker = vi.fn();
    const runBenchmark = vi.fn();

    await expect(startCommand(
      {
        ...options,
        dryRun: false,
        maxGenerations: 100,
        repeatCount: 2
      },
      { inspectCredentials, preflightDocker, runBenchmark }
    )).rejects.toThrow(/planned 198 generations exceed the configured limit 100/u);

    expect(preflightDocker).not.toHaveBeenCalled();
    expect(inspectCredentials).not.toHaveBeenCalled();
    expect(runBenchmark).not.toHaveBeenCalled();
  });
});
