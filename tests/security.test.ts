import { describe, expect, it } from "vitest";

import { EvaluatorCheckSchema } from "../src/contracts.js";
import { runProcess } from "../src/process.js";
import { buildDockerArgs } from "../src/sandbox/docker.js";

describe("Docker sandbox arguments", () => {
  it("enforces isolation and passes malicious-looking argv without a shell", () => {
    const maliciousArgument = "$(touch /tmp/escaped)";
    const check = EvaluatorCheckSchema.parse({
      argv: ["node", "/evaluator/check.mjs", maliciousArgument],
      cwd: "src",
      id: "isolation",
      image: "node:22-alpine",
      timeoutMs: 5_000
    });

    const args = buildDockerArgs(
      check,
      {
        evaluatorDirectory: "/tmp/evaluator",
        workspaceDirectory: "/tmp/workspace"
      },
      "redactbench-test"
    );

    expect(args).toEqual(
      expect.arrayContaining([
        "--network",
        "none",
        "--read-only",
        "--cap-drop",
        "ALL",
        "--security-opt",
        "no-new-privileges",
        "--pids-limit",
        "128",
        "--memory",
        "512m",
        "--cpus",
        "1",
        "--user",
        "65532:65532",
        "--workdir",
        "/workspace/src"
      ])
    );
    expect(args.filter((argument) => argument === maliciousArgument)).toHaveLength(1);
    expect(args).not.toContain("sh");
    expect(args.join(" ")).not.toContain("OPENAI_API_KEY");

    const workspaceMount = args.find((argument) => argument.includes("dst=/workspace"));
    const evaluatorMount = args.find((argument) => argument.includes("dst=/evaluator"));
    expect(workspaceMount).not.toContain("readonly");
    expect(evaluatorMount).toContain("readonly");
  });
});

describe("runProcess", () => {
  it("terminates and marks output that exceeds the byte cap", async () => {
    const result = await runProcess(
      [process.execPath, "-e", "process.stdout.write('x'.repeat(4096))"],
      { maxOutputBytes: 128, timeoutMs: 5_000 }
    );

    expect(result.outputLimitExceeded).toBe(true);
    expect(Buffer.byteLength(result.stdout) + Buffer.byteLength(result.stderr)).toBeLessThanOrEqual(
      128
    );
  });
});
