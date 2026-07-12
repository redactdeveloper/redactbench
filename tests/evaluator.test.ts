import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { EvaluatorCheckSchema } from "../src/contracts.js";
import { evaluateChecks } from "../src/evaluator.js";
import type { SandboxRunner } from "../src/sandbox/docker.js";

const checks = [
  EvaluatorCheckSchema.parse({
    argv: ["node", "/evaluator/one.mjs"],
    id: "one",
    image: "node:22-alpine",
    weight: 1
  }),
  EvaluatorCheckSchema.parse({
    argv: ["node", "/evaluator/two.mjs"],
    id: "two",
    image: "node:22-alpine",
    weight: 2
  }),
  EvaluatorCheckSchema.parse({
    argv: ["node", "/evaluator/three.mjs"],
    id: "three",
    image: "node:22-alpine",
    weight: 1
  })
];

async function temporaryContext() {
  const root = await mkdtemp(join(tmpdir(), "redactbench-evaluator-"));
  const evaluatorDirectory = join(root, "evaluator");
  const workspaceDirectory = join(root, "workspace");
  await Promise.all([
    mkdir(evaluatorDirectory, { recursive: true }),
    mkdir(workspaceDirectory, { recursive: true })
  ]);
  return {
    evaluatorDirectory,
    workspaceDirectory,
    cleanup: () => rm(root, { force: true, recursive: true })
  };
}

describe("evaluateChecks", () => {
  it("calculates a deterministic weighted partial score and preserves statuses", async () => {
    const context = await temporaryContext();
    const sandbox = vi
      .fn<SandboxRunner>()
      .mockResolvedValueOnce({
        durationMs: 10,
        exitCode: 0,
        imageId: "sha256:image",
        output: "ok",
        outputLimitExceeded: false,
        timedOut: false
      })
      .mockResolvedValueOnce({
        durationMs: 20,
        exitCode: 1,
        imageId: "sha256:image",
        output: "assertion failed",
        outputLimitExceeded: false,
        timedOut: false
      })
      .mockResolvedValueOnce({
        durationMs: 30,
        exitCode: null,
        imageId: "sha256:image",
        output: "timed out",
        outputLimitExceeded: false,
        timedOut: true
      });

    const result = await evaluateChecks(checks, context, sandbox);

    expect(result.score).toBe(0.25);
    expect(result.checks.map((check) => check.status)).toEqual([
      "passed",
      "failed",
      "timeout"
    ]);
    expect(result.imageIds).toEqual(["sha256:image"]);
    expect(sandbox).toHaveBeenCalledTimes(3);
    await context.cleanup();
  });

  it("maps sandbox infrastructure and output-limit failures to error", async () => {
    const context = await temporaryContext();
    const sandbox = vi.fn<SandboxRunner>().mockResolvedValue({
      durationMs: 5,
      errorCode: "OUTPUT_LIMIT",
      exitCode: null,
      imageId: null,
      output: "truncated",
      outputLimitExceeded: true,
      timedOut: false
    });

    const result = await evaluateChecks([checks[0]!], context, sandbox);

    expect(result.score).toBe(0);
    expect(result.checks[0]).toMatchObject({
      errorCode: "OUTPUT_LIMIT",
      status: "error"
    });
    await context.cleanup();
  });

  it("gives every check a fresh workspace and preserves the evaluated state", async () => {
    const context = await temporaryContext();
    await writeFile(join(context.workspaceDirectory, "baseline.txt"), "original\n");
    const mutationFile = "check-mutation.txt";
    const sandbox: SandboxRunner = async (check, checkContext) => {
      const baseline = await readFile(
        join(checkContext.workspaceDirectory, "baseline.txt"),
        "utf8"
      );
      let mutationVisible = true;
      try {
        await access(join(checkContext.workspaceDirectory, mutationFile));
      } catch {
        mutationVisible = false;
      }
      if (check.id === "one") {
        await writeFile(join(checkContext.workspaceDirectory, mutationFile), "mutated\n");
      }
      return {
        durationMs: 1,
        exitCode: baseline === "original\n" && !mutationVisible ? 0 : 1,
        imageId: "sha256:image",
        output: "",
        outputLimitExceeded: false,
        timedOut: false
      };
    };

    const result = await evaluateChecks(checks.slice(0, 2), context, sandbox);

    expect(result.checks.map((check) => check.status)).toEqual(["passed", "passed"]);
    await expect(
      access(join(context.workspaceDirectory, mutationFile))
    ).rejects.toMatchObject({ code: "ENOENT" });
    expect(await readFile(join(context.workspaceDirectory, "baseline.txt"), "utf8")).toBe(
      "original\n"
    );
    await context.cleanup();
  });

  it("maps workspace setup and cleanup failures to check errors", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-evaluator-missing-"));
    const setupFailure = await evaluateChecks(
      [checks[0]!],
      {
        evaluatorDirectory: root,
        workspaceDirectory: join(root, "missing-workspace")
      },
      vi.fn<SandboxRunner>()
    );

    expect(setupFailure.checks[0]).toMatchObject({
      errorCode: "SANDBOX_ERROR",
      status: "error"
    });

    const context = await temporaryContext();
    const cleanupFailure = await evaluateChecks(
      [checks[0]!],
      context,
      vi.fn<SandboxRunner>().mockResolvedValue({
        durationMs: 1,
        exitCode: 0,
        imageId: "sha256:image",
        output: "ok",
        outputLimitExceeded: false,
        timedOut: false
      }),
      async () => ({
        cleanup: async () => {
          throw new Error("cleanup failed");
        },
        directory: context.workspaceDirectory,
        root: context.workspaceDirectory
      })
    );

    expect(cleanupFailure.checks[0]).toMatchObject({
      errorCode: "SANDBOX_ERROR",
      status: "error"
    });
    await Promise.all([rm(root, { force: true, recursive: true }), context.cleanup()]);
  });
});
