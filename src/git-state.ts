import { resolve } from "node:path";

import { RedactBenchError } from "./errors.js";
import { runProcess } from "./process.js";

const GIT_TIMEOUT_MS = 30_000;
const GIT_OUTPUT_LIMIT = 65_536;

interface GitCommandResult {
  stderr: string;
  stdout: string;
}

function gitArguments(workspaceDirectory: string, args: readonly string[]): [string, ...string[]] {
  const gitDirectory = resolve(workspaceDirectory, ".redactbench", "git");
  return [
    "git",
    `--git-dir=${gitDirectory}`,
    `--work-tree=${resolve(workspaceDirectory)}`,
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "commit.gpgSign=false",
    ...args
  ];
}

async function runGit(
  workspaceDirectory: string,
  args: readonly string[]
): Promise<GitCommandResult> {
  const result = await runProcess(gitArguments(workspaceDirectory, args), {
    cwd: workspaceDirectory,
    maxOutputBytes: GIT_OUTPUT_LIMIT,
    timeoutMs: GIT_TIMEOUT_MS
  });
  if (
    result.spawnError ||
    result.timedOut ||
    result.outputLimitExceeded ||
    result.exitCode !== 0
  ) {
    const detail = `${result.stdout}\n${result.stderr}`.replaceAll(/\s+/gu, " ").trim();
    throw new RedactBenchError(
      "ATTEMPT_ERROR",
      `recovery Git operation failed${detail ? `: ${detail.slice(0, 2_048)}` : ""}`
    );
  }
  return { stderr: result.stderr, stdout: result.stdout };
}

async function stageAndCommit(
  workspaceDirectory: string,
  message: string
): Promise<string> {
  await runGit(workspaceDirectory, [
    "add",
    "-A",
    "--",
    ".",
    ":(exclude).git",
    ":(exclude).redactbench"
  ]);
  await runGit(workspaceDirectory, [
    "-c",
    "user.name=RedactBench",
    "-c",
    "user.email=redactbench@localhost",
    "commit",
    "--quiet",
    "--allow-empty",
    "--no-gpg-sign",
    "-m",
    message
  ]);
  return (await runGit(workspaceDirectory, ["rev-parse", "HEAD"])).stdout.trim();
}

export async function initializeRecoveryGit(
  workspaceDirectory: string
): Promise<string> {
  await runGit(workspaceDirectory, ["init", "--quiet"]);
  return await stageAndCommit(workspaceDirectory, "redactbench: baseline");
}

export async function commitRecoveryPhase(
  workspaceDirectory: string,
  phase: 1 | 2
): Promise<string> {
  return await stageAndCommit(workspaceDirectory, `redactbench: phase ${phase}`);
}

export async function currentRecoveryCommit(workspaceDirectory: string): Promise<string> {
  return (await runGit(workspaceDirectory, ["rev-parse", "HEAD"])).stdout.trim();
}

export async function recoveryGitSummary(workspaceDirectory: string): Promise<string> {
  const log = await runGit(workspaceDirectory, [
    "log",
    "--oneline",
    "--max-count=8"
  ]);
  const status = await runGit(workspaceDirectory, ["status", "--short"]);
  return [
    "Git log:",
    log.stdout.trim() || "(empty)",
    "",
    "Working tree:",
    status.stdout.trim() || "clean"
  ].join("\n");
}
