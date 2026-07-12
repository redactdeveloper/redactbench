import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHarnessDockerArgs,
  HarnessDockerRuntimeSchema
} from "../src/harness/docker.js";
import { runProcess } from "../src/process.js";

describe("Docker harness integration", () => {
  it("runs in a dedicated container with only its writable workspace", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-harness-dryrun-"));
    const workspaceDirectory = join(root, "workspace");
    const promptFile = join(root, "prompt.txt");
    const network = `redactbench-egress-dryrun-${process.pid}`;
    await mkdir(workspaceDirectory);
    await chmod(workspaceDirectory, 0o777);
    await writeFile(promptFile, "dry-run prompt\n", { mode: 0o644 });

    const createNetwork = await runProcess(
      ["docker", "network", "create", "--driver", "bridge", network],
      { maxOutputBytes: 4_096, timeoutMs: 10_000 }
    );
    expect(createNetwork.stderr, createNetwork.stdout).toBe("");
    expect(createNetwork.exitCode).toBe(0);

    try {
      const runtime = HarnessDockerRuntimeSchema.parse({
        schemaVersion: 1,
        execution: "docker",
        harness: "opencode",
        image: "node:22-alpine",
        argv: [
          "node",
          "-e",
          "const fs=require('fs');fs.writeFileSync('/workspace/container.txt',process.argv[1]);console.log(process.argv[1],fs.existsSync('/evaluator'))",
          "{model}"
        ],
        promptTransport: "stdin",
        network
      });
      const args = await buildHarnessDockerArgs(runtime, {
        containerName: `redactbench-harness-dryrun-${process.pid}`,
        environment: {},
        model: "dry-model",
        promptFile,
        secretFiles: {},
        workspaceDirectory
      });
      const result = await runProcess(["docker", ...args], {
        maxOutputBytes: runtime.maxOutputBytes,
        stdin: "dry-run prompt\n",
        timeoutMs: runtime.timeoutMs
      });

      expect(result.stderr, result.stdout).toBe("");
      expect(result).toMatchObject({
        exitCode: 0,
        outputLimitExceeded: false,
        timedOut: false
      });
      expect(result.stdout.trim()).toBe("dry-model false");
      expect(await readFile(join(workspaceDirectory, "container.txt"), "utf8")).toBe(
        "dry-model"
      );
    } finally {
      await runProcess(["docker", "network", "rm", network], {
        maxOutputBytes: 4_096,
        timeoutMs: 10_000
      });
      await rm(root, { force: true, recursive: true });
    }
  }, 60_000);
});
