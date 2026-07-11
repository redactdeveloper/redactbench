import { createHash } from "node:crypto";

import { RedactBenchError } from "./errors.js";
import { runProcess } from "./process.js";

const GIT_OUTPUT_LIMIT = 65_536;
const GIT_TIMEOUT_MS = 30_000;

function safeGitMessage(stdout: string, stderr: string): string {
  const message = `${stdout}\n${stderr}`.replaceAll(/\s+/gu, " ").trim();
  return message.slice(0, 2_048) || "git rejected the patch";
}

async function gitApply(
  workspaceDirectory: string,
  patch: string,
  checkOnly: boolean
): Promise<void> {
  const argv: [string, ...string[]] = [
    "git",
    "apply",
    ...(checkOnly ? ["--check"] : []),
    "--recount",
    "--whitespace=nowarn",
    "-"
  ];
  const result = await runProcess(argv, {
    cwd: workspaceDirectory,
    maxOutputBytes: GIT_OUTPUT_LIMIT,
    stdin: patch,
    timeoutMs: GIT_TIMEOUT_MS
  });

  if (
    result.spawnError ||
    result.timedOut ||
    result.outputLimitExceeded ||
    result.exitCode !== 0
  ) {
    throw new RedactBenchError(
      "PATCH_REJECTED",
      safeGitMessage(result.stdout, result.stderr)
    );
  }
}

export async function applyPatch(
  workspaceDirectory: string,
  patch: string
): Promise<string> {
  const normalizedPatch = patch.endsWith("\n") ? patch : `${patch}\n`;
  await gitApply(workspaceDirectory, normalizedPatch, true);
  await gitApply(workspaceDirectory, normalizedPatch, false);
  return createHash("sha256").update(normalizedPatch).digest("hex");
}
