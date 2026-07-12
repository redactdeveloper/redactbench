import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createHarnessAdapter } from "../src/harness/adapter.js";
import { HarnessDockerRuntimeSchema } from "../src/harness/docker.js";

const runtime = HarnessDockerRuntimeSchema.parse({
  schemaVersion: 1,
  execution: "docker",
  harness: "opencode",
  image: "redactbench/harness-opencode:local",
  argv: [
    "redactbench-harness",
    "--model",
    "{model}",
    "{modelArguments}",
    "--workspace",
    "{workspace}"
  ],
  promptTransport: "stdin",
  network: "redactbench-egress-openrouter"
});

describe("createHarnessAdapter", () => {
  it("runs a workspace agent in Docker and returns normalized metrics", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "redactbench-adapter-"));
    const run = vi.fn().mockResolvedValue({
      durationMs: 1_250,
      exitCode: 0,
      outputLimitExceeded: false,
      spawnError: null,
      stderr: "",
      stdout: JSON.stringify({
        schemaVersion: 1,
        text: "Implemented the fix and ran local checks.",
        providerRequestId: "thread-safe-id",
        ttftMs: 210,
        usage: {
          cachedInputTokens: 50,
          inputTokens: 500,
          outputTokens: 100
        }
      }),
      timedOut: false
    });
    const adapter = createHarnessAdapter({
      binding: {
        entrantId: "hy3-high-opencode",
        model: "openrouter/tencent/hy3",
        modelArguments: ["--variant", "high"],
        runtimeId: "opencode-openrouter"
      },
      environment: {},
      entrant: {
        displayName: "Hy3 High",
        execution: "docker",
        harness: "opencode",
        id: "hy3-high-opencode",
        order: 11,
        provider: "openrouter"
      },
      run,
      runtime,
      secretFiles: {}
    });

    try {
      const result = await adapter.generate({
        maxOutputTokens: 8_192,
        prompt: "Fix the repository.",
        requestId: "run:task:hy3:1:final",
        system: "Benchmark system prompt.",
        workspaceDirectory: workspace
      });

      expect(adapter.workspaceMode).toBe(true);
      expect(result).toMatchObject({
        model: "openrouter/tencent/hy3",
        provider: "openrouter",
        providerRequestId: "thread-safe-id",
        text: "Implemented the fix and ran local checks.",
        timing: {
          durationMs: 1_250,
          generationMs: 1_040,
          ttftMs: 210
        },
        usage: {
          cachedInputTokens: 50,
          inputTokens: 500,
          outputTokens: 100
        }
      });
      expect(result.timing.outputTokensPerSecond).toBeCloseTo(96.1538, 4);
      const [argv, options] = run.mock.calls[0] as [string[], { stdin?: string }];
      expect(argv[0]).toBe("docker");
      expect(argv.join(" ")).toContain("--variant high");
      expect(argv.join(" ")).not.toContain("Fix the repository");
      expect(options.stdin).toContain("Benchmark system prompt.");
      expect(options.stdin).toContain("Fix the repository.");
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });

  it("fails closed before Docker when a workspace is missing", async () => {
    const run = vi.fn();
    const adapter = createHarnessAdapter({
      binding: {
        entrantId: "hy3-high-opencode",
        model: "openrouter/tencent/hy3",
        modelArguments: [],
        runtimeId: "opencode-openrouter"
      },
      environment: {},
      entrant: {
        displayName: "Hy3 High",
        execution: "docker",
        harness: "opencode",
        id: "hy3-high-opencode",
        order: 11,
        provider: "openrouter"
      },
      run,
      runtime,
      secretFiles: {}
    });

    await expect(adapter.generate({
      maxOutputTokens: 8_192,
      prompt: "Fix it.",
      system: "System."
    })).rejects.toThrow(/workspace directory/u);
    expect(run).not.toHaveBeenCalled();
  });

  it("does not echo harness stderr when a container fails", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "redactbench-adapter-error-"));
    await mkdir(join(workspace, "nested"));
    const adapter = createHarnessAdapter({
      binding: {
        entrantId: "hy3-high-opencode",
        model: "openrouter/tencent/hy3",
        modelArguments: [],
        runtimeId: "opencode-openrouter"
      },
      environment: {},
      entrant: {
        displayName: "Hy3 High",
        execution: "docker",
        harness: "opencode",
        id: "hy3-high-opencode",
        order: 11,
        provider: "openrouter"
      },
      run: vi.fn().mockResolvedValue({
        durationMs: 10,
        exitCode: 1,
        outputLimitExceeded: false,
        spawnError: null,
        stderr: "sensitive provider response",
        stdout: "",
        timedOut: false
      }),
      runtime,
      secretFiles: {}
    });

    try {
      await expect(adapter.generate({
        maxOutputTokens: 8_192,
        prompt: "Fix it.",
        system: "System.",
        workspaceDirectory: workspace
      })).rejects.toThrow("harness container exited with code 1");
      await expect(adapter.generate({
        maxOutputTokens: 8_192,
        prompt: "Fix it.",
        system: "System.",
        workspaceDirectory: workspace
      })).rejects.not.toThrow(/sensitive provider response/u);
    } finally {
      await rm(workspace, { force: true, recursive: true });
    }
  });
});
