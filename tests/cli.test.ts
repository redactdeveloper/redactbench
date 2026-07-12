import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { describe, expect, it, vi } from "vitest";

import reportData from "../dashboard/public/report.json";
import { isMainModule, main } from "../src/cli.js";
import type { StartCommandOptions } from "../src/commands/start.js";
import { ReportSchema } from "../src/contracts.js";

const report = ReportSchema.parse(reportData);

function outputBuffer() {
  let value = "";
  return {
    stream: { write(chunk: string) { value += chunk; return true; } },
    value: () => value
  };
}

async function validConfiguration() {
  const root = await mkdtemp(join(tmpdir(), "redactbench-cli-"));
  const taskDirectory = join(root, "task");
  await mkdir(join(taskDirectory, "workspace"), { recursive: true });
  await mkdir(join(taskDirectory, "evaluator"), { recursive: true });
  await writeFile(
    join(taskDirectory, "task.yaml"),
    [
      "schemaVersion: 1",
      "id: debug",
      "title: Debug",
      "category: debugging",
      "description: Debug a fixture.",
      "prompt: Fix it.",
      "checks:",
      "  - id: check",
      "    image: node:22-alpine",
      "    argv: [node, /evaluator/check.mjs]"
    ].join("\n")
  );
  const suiteFile = join(root, "suite.yaml");
  await writeFile(
    suiteFile,
    [
      "schemaVersion: 1",
      "id: demo",
      "title: Demo",
      "tasks:",
      "  - manifest: task/task.yaml"
    ].join("\n")
  );
  const modelsFile = join(root, "models.yaml");
  await writeFile(
    join(root, "fixture.json"),
    JSON.stringify({ schemaVersion: 1, responses: {} })
  );
  await writeFile(
    modelsFile,
    [
      "schemaVersion: 1",
      "models:",
      "  - id: fixture",
      "    label: Fixture",
      "    provider: fixture",
      "    model: fixture-v1",
      "    fixtureFile: fixture.json"
    ].join("\n")
  );
  return { modelsFile, root, suiteFile };
}

describe("CLI", () => {
  it("recognizes a package-bin symlink as the main module", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-bin-link-"));
    const entrypoint = join(root, "redactbench");
    const target = resolve("src/cli.ts");
    try {
      await symlink(target, entrypoint);
      expect(isMainModule(pathToFileURL(target).href, entrypoint)).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("shows help and version without touching configuration", async () => {
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    expect(await main(["--help"], { stderr: stderr.stream, stdout: stdout.stream })).toBe(0);
    expect(stdout.value()).toContain("redactbench validate");
    expect(stdout.value()).toContain("redactbench start");
    expect(stderr.value()).toBe("");

    const version = outputBuffer();
    expect(await main(["--version"], { stdout: version.stream })).toBe(0);
    expect(version.value()).toBe("0.3.0\n");
  });

  it("parses start dry-run defaults and prints the no-request guarantee", async () => {
    const stdout = outputBuffer();
    const start = vi.fn().mockResolvedValue({
      dryRun: true,
      credentials: { checks: [], ready: true },
      images: [],
      networks: [],
      plan: {
        attemptCount: 88,
        concurrency: 1,
        entrantCount: 11,
        entrants: [],
        repeatCount: 1,
        runId: "run-test",
        seed: 20_260_712,
        suiteTitle: "Demo",
        taskCount: 8
      }
    });

    expect(await main(["start", "--dry-run"], {
      now: () => Date.parse("2026-07-12T00:00:00.000Z"),
      start,
      stdout: stdout.stream
    })).toBe(0);

    expect(start).toHaveBeenCalledWith(expect.objectContaining({
      concurrency: 1,
      dryRun: true,
      fieldFile: "benchmarks/target-field.yaml",
      repeatCount: 1,
      runtimesFile: "benchmarks/target-runtimes.yaml",
      seed: 20_260_712,
      suiteFile: "benchmarks/demo/suite.yaml"
    }));
    expect(stdout.value()).toContain("No model or API requests were sent");
    expect(start.mock.calls[0]?.[0].onProgress).toBeUndefined();
  });

  it("streams sanitized progress for a real start invocation", async () => {
    const stdout = outputBuffer();
    const start = vi.fn(async (options: StartCommandOptions) => {
      await options.onProgress?.({
        completedAttempts: 0,
        remainingAttempts: 88,
        resumed: false,
        runId: options.runId,
        totalAttempts: 88,
        type: "run.ready"
      });
      await options.onProgress?.({
        attemptId: `${options.runId}:task:model:1`,
        completedAttempts: 1,
        modelId: "model",
        modelLabel: "Model\u001B]8;;https://unsafe.test\u0007",
        score: 1,
        status: "passed",
        taskId: "task",
        taskTitle: "Task\nTitle",
        totalAttempts: 88,
        type: "attempt.completed"
      });
      await options.onProgress?.({
        completedAttempts: 88,
        runId: options.runId,
        totalAttempts: 88,
        type: "run.completed"
      });
      return {
        dryRun: false as const,
        plan: {
          attemptCount: 88,
          concurrency: 1,
          entrantCount: 11,
          entrants: [],
          repeatCount: 1,
          runId: options.runId,
          seed: 20_260_712,
          suiteTitle: "Demo",
          taskCount: 8
        },
        report,
        reportFile: "/tmp/report/index.html",
        runDirectory: "/tmp/run"
      };
    });

    expect(await main(["start", "--run-id", "target-run"], {
      start,
      stdout: stdout.stream
    })).toBe(0);

    expect(stdout.value()).toContain(
      "Starting target-run: 0/88 completed · 88 remaining\n"
    );
    expect(stdout.value()).toContain(
      "[1/88] PASSED 100.0% · Model · Task Title\n"
    );
    expect(stdout.value()).toContain(
      "Finished target-run: 88/88 attempts recorded\n"
    );
    expect(stdout.value()).not.toContain("unsafe.test");
  });

  it("validates suite, task and model files without running Docker", async () => {
    const config = await validConfiguration();
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    const exitCode = await main(
      ["validate", "--suite", config.suiteFile, "--models", config.modelsFile],
      { stderr: stderr.stream, stdout: stdout.stream }
    );

    expect(exitCode).toBe(0);
    expect(stdout.value()).toContain("1 task · 1 model");
    expect(stderr.value()).toBe("");
  });

  it("returns a stable config exit code and a path-aware safe error", async () => {
    const config = await validConfiguration();
    await writeFile(
      config.suiteFile,
      [
        "schemaVersion: 1",
        "id: demo",
        "title: Demo",
        "tasks:",
        "  - manifest: ../outside/task.yaml"
      ].join("\n")
    );
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    const exitCode = await main(
      ["validate", "--suite", config.suiteFile, "--models", config.modelsFile],
      { stderr: stderr.stream, stdout: stdout.stream }
    );

    expect(exitCode).toBe(2);
    expect(stdout.value()).toBe("");
    expect(stderr.value()).toContain("CONFIG_INVALID");
    expect(stderr.value()).toContain("suite.yaml:tasks.0.manifest");
    expect(stderr.value()).not.toContain("at main");
  });

  it("rejects unsafe concurrency before starting a run", async () => {
    const config = await validConfiguration();
    const stderr = outputBuffer();

    const exitCode = await main(
      [
        "run",
        "--suite",
        config.suiteFile,
        "--models",
        config.modelsFile,
        "--concurrency",
        "99"
      ],
      { stderr: stderr.stream }
    );

    expect(exitCode).toBe(2);
    expect(stderr.value()).toContain("concurrency must be between 1 and 8");
  });
});
