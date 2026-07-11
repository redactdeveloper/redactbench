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

describe("evaluateChecks", () => {
  it("calculates a deterministic weighted partial score and preserves statuses", async () => {
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

    const result = await evaluateChecks(
      checks,
      { evaluatorDirectory: "/tmp/evaluator", workspaceDirectory: "/tmp/workspace" },
      sandbox
    );

    expect(result.score).toBe(0.25);
    expect(result.checks.map((check) => check.status)).toEqual([
      "passed",
      "failed",
      "timeout"
    ]);
    expect(result.imageIds).toEqual(["sha256:image"]);
    expect(sandbox).toHaveBeenCalledTimes(3);
  });

  it("maps sandbox infrastructure and output-limit failures to error", async () => {
    const sandbox = vi.fn<SandboxRunner>().mockResolvedValue({
      durationMs: 5,
      errorCode: "OUTPUT_LIMIT",
      exitCode: null,
      imageId: null,
      output: "truncated",
      outputLimitExceeded: true,
      timedOut: false
    });

    const result = await evaluateChecks(
      [checks[0]!],
      { evaluatorDirectory: "/tmp/evaluator", workspaceDirectory: "/tmp/workspace" },
      sandbox
    );

    expect(result.score).toBe(0);
    expect(result.checks[0]).toMatchObject({
      errorCode: "OUTPUT_LIMIT",
      status: "error"
    });
  });
});
