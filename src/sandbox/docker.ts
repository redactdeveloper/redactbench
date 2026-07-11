import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

import type { EvaluatorCheck } from "../contracts.js";
import { runProcess } from "../process.js";

export interface SandboxContext {
  evaluatorDirectory: string;
  workspaceDirectory: string;
}

export interface SandboxExecution {
  durationMs: number;
  errorCode?: string;
  exitCode: number | null;
  imageId: string | null;
  output: string;
  outputLimitExceeded: boolean;
  timedOut: boolean;
}

export type SandboxRunner = (
  check: EvaluatorCheck,
  context: SandboxContext
) => Promise<SandboxExecution>;

function combineOutput(stdout: string, stderr: string, maxBytes: number): string {
  const separator = stdout && stderr ? "\n" : "";
  const combined = Buffer.from(`${stdout}${separator}${stderr}`, "utf8");
  return combined.subarray(0, maxBytes).toString("utf8");
}

export function buildDockerArgs(
  check: EvaluatorCheck,
  context: SandboxContext,
  containerName: string
): string[] {
  const workspaceDirectory = resolve(context.workspaceDirectory);
  const evaluatorDirectory = resolve(context.evaluatorDirectory);
  const workdir = check.cwd === "." ? "/workspace" : `/workspace/${check.cwd}`;

  return [
    "run",
    "--rm",
    "--name",
    containerName,
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
    workdir,
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=64m",
    "--env",
    "CI=1",
    "--env",
    "HOME=/tmp",
    "--env",
    "REDACTBENCH_RESPONSE_FILE=/workspace/.redactbench/response.txt",
    "--mount",
    `type=bind,src=${workspaceDirectory},dst=/workspace`,
    "--mount",
    `type=bind,src=${evaluatorDirectory},dst=/evaluator,readonly`,
    check.image,
    ...check.argv
  ];
}

async function inspectImageId(image: string): Promise<string | null> {
  const result = await runProcess(
    ["docker", "image", "inspect", "--format={{.Id}}", image],
    { maxOutputBytes: 4_096, timeoutMs: 10_000 }
  );
  if (result.exitCode !== 0 || result.spawnError) {
    return null;
  }
  const imageId = result.stdout.trim();
  return imageId.startsWith("sha256:") ? imageId : null;
}

export const runDockerCheck: SandboxRunner = async (check, context) => {
  const containerName = `redactbench-${randomUUID()}`;
  const killContainer = async () => {
    await runProcess(["docker", "kill", containerName], {
      maxOutputBytes: 4_096,
      timeoutMs: 5_000
    });
  };
  const result = await runProcess(
    ["docker", ...buildDockerArgs(check, context, containerName)],
    {
      maxOutputBytes: check.maxOutputBytes,
      onTerminate: killContainer,
      timeoutMs: check.timeoutMs
    }
  );
  const imageId = await inspectImageId(check.image);
  const output = combineOutput(result.stdout, result.stderr, check.maxOutputBytes);

  if (result.spawnError) {
    return {
      durationMs: result.durationMs,
      errorCode: "DOCKER_UNAVAILABLE",
      exitCode: null,
      imageId,
      output: "Docker could not be started",
      outputLimitExceeded: false,
      timedOut: false
    };
  }

  if (result.outputLimitExceeded) {
    return {
      durationMs: result.durationMs,
      errorCode: "OUTPUT_LIMIT",
      exitCode: result.exitCode,
      imageId,
      output,
      outputLimitExceeded: true,
      timedOut: false
    };
  }

  if (result.exitCode === 125) {
    return {
      durationMs: result.durationMs,
      errorCode: "DOCKER_ERROR",
      exitCode: result.exitCode,
      imageId,
      output,
      outputLimitExceeded: false,
      timedOut: result.timedOut
    };
  }

  return {
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    imageId,
    output,
    outputLimitExceeded: false,
    timedOut: result.timedOut
  };
};
