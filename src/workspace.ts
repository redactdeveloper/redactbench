import { cp, chmod, mkdir, mkdtemp, readdir, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";

import { RedactBenchError } from "./errors.js";

export interface IsolatedWorkspace {
  cleanup(): Promise<void>;
  directory: string;
  root: string;
}

export function resolveContainedPath(baseDirectory: string, relativePath: string): string {
  const base = resolve(baseDirectory);
  const candidate = resolve(base, relativePath);
  if (candidate !== base && !candidate.startsWith(`${base}${sep}`)) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      `path escapes its task directory: ${relativePath}`
    );
  }
  return candidate;
}

export async function resolveContainedRealPath(
  baseDirectory: string,
  relativePath: string
): Promise<string> {
  const candidate = resolveContainedPath(baseDirectory, relativePath);
  try {
    const [base, resolvedCandidate] = await Promise.all([
      realpath(resolve(baseDirectory)),
      realpath(candidate)
    ]);
    if (
      resolvedCandidate !== base &&
      !resolvedCandidate.startsWith(`${base}${sep}`)
    ) {
      throw new RedactBenchError(
        "CONFIG_INVALID",
        `resolved path escapes its project directory: ${relativePath}`
      );
    }
    return resolvedCandidate;
  } catch (error) {
    if (error instanceof RedactBenchError) {
      throw error;
    }
    throw new RedactBenchError(
      "CONFIG_INVALID",
      `path could not be resolved inside its project directory: ${relativePath}`,
      [],
      error
    );
  }
}

async function assertCopyableTree(directory: string, relative = ""): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const entryRelative = relative ? `${relative}/${entry.name}` : entry.name;
    const entryPath = resolve(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new RedactBenchError(
        "CONFIG_INVALID",
        `workspace symlinks are not allowed: ${entryRelative}`
      );
    }
    if (entry.isDirectory()) {
      await assertCopyableTree(entryPath, entryRelative);
    } else if (!entry.isFile()) {
      throw new RedactBenchError(
        "CONFIG_INVALID",
        `workspace contains an unsupported file type: ${entryRelative}`
      );
    }
  }
}

async function makeWritableForSandbox(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  await chmod(directory, 0o777);
  for (const entry of entries) {
    const entryPath = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      await makeWritableForSandbox(entryPath);
    } else if (entry.isFile()) {
      const fileStat = await stat(entryPath);
      const executable = (fileStat.mode & 0o111) !== 0;
      await chmod(entryPath, executable ? 0o777 : 0o666);
    }
  }
}

export async function createIsolatedWorkspace(
  sourceDirectory: string
): Promise<IsolatedWorkspace> {
  await assertCopyableTree(sourceDirectory);
  const root = await mkdtemp(resolve(tmpdir(), "redactbench-workspace-"));
  const directory = resolve(root, "workspace");

  try {
    await cp(sourceDirectory, directory, {
      errorOnExist: true,
      force: false,
      recursive: true
    });
    await mkdir(resolve(directory, ".redactbench"), { recursive: true });
    await makeWritableForSandbox(directory);
  } catch (error) {
    await rm(root, { force: true, recursive: true });
    if (error instanceof RedactBenchError) {
      throw error;
    }
    throw new RedactBenchError(
      "ATTEMPT_ERROR",
      "could not create an isolated workspace",
      [],
      error
    );
  }

  return {
    async cleanup() {
      await rm(root, { force: true, recursive: true });
    },
    directory,
    root
  };
}
