import { lstat, readFile, realpath, readdir } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

import { parse } from "yaml";

export type CorpusIndependenceIssueCode =
  | "MANIFEST_INVALID"
  | "PATH_ESCAPE"
  | "PROMPT_REUSE"
  | "REFERENCE_REUSE"
  | "SYMLINK"
  | "TASK_ID_REUSE"
  | "WORKSPACE_REUSE";

export interface CorpusIndependenceIssue {
  code: CorpusIndependenceIssueCode;
  message: string;
  path: string;
}

export interface CorpusIndependenceOptions {
  candidateDirectory: string;
  referenceDirectory: string;
}

interface TaskFingerprint {
  directory: string;
  id: string;
  manifest: string;
  prompt: string;
  workspace: string;
}

function isContained(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${sep}`) && child !== "..");
}

function normalizedText(value: string): string {
  return value.trim().replace(/\s+/gu, " ");
}

function isText(buffer: Buffer): boolean {
  return !buffer.includes(0);
}

function hasReferenceReuse(value: string, referenceDirectory: string): boolean {
  const normalized = value.replaceAll("\\", "/");
  const reference = referenceDirectory.replaceAll("\\", "/");
  return (
    normalized.includes("benchmarks/silver") ||
    /(?:^|[\s'"`])\.\.\/silver(?:\/|[\s'"`]|$)/u.test(normalized) ||
    normalized.includes(reference)
  );
}

async function collectFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectFiles(path));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }
  return files.sort();
}

async function workspaceFingerprint(directory: string): Promise<string> {
  const files = await collectFiles(directory);
  const parts: string[] = [];
  for (const file of files) {
    const buffer = await readFile(file);
    const content = isText(buffer)
      ? normalizedText(buffer.toString("utf8"))
      : buffer.toString("base64");
    parts.push(`${relative(directory, file).replaceAll("\\", "/")}\0${content}`);
  }
  return parts.join("\0");
}

async function collectTasks(directory: string): Promise<{
  issues: CorpusIndependenceIssue[];
  tasks: TaskFingerprint[];
}> {
  const issues: CorpusIndependenceIssue[] = [];
  const tasks: TaskFingerprint[] = [];
  const files = await collectFiles(directory);

  for (const manifest of files.filter((file) => file.endsWith(`${sep}task.yaml`))) {
    try {
      const parsed: unknown = parse(await readFile(manifest, "utf8"));
      if (typeof parsed !== "object" || parsed === null) {
        throw new Error("manifest must be an object");
      }
      const record = parsed as Record<string, unknown>;
      if (typeof record.id !== "string" || typeof record.prompt !== "string") {
        throw new Error("manifest requires string id and prompt fields");
      }
      const workspaceName = typeof record.workspace === "string" ? record.workspace : "workspace";
      const taskDirectory = resolve(manifest, "..");
      const workspaceDirectory = resolve(taskDirectory, workspaceName);
      tasks.push({
        directory: taskDirectory,
        id: record.id,
        manifest,
        prompt: normalizedText(record.prompt),
        workspace: await workspaceFingerprint(workspaceDirectory)
      });
    } catch (error) {
      issues.push({
        code: "MANIFEST_INVALID",
        message: error instanceof Error ? error.message : "invalid task manifest",
        path: manifest
      });
    }
  }

  return { issues, tasks };
}

async function auditCandidateTree(
  candidateDirectory: string,
  referenceDirectory: string
): Promise<CorpusIndependenceIssue[]> {
  const issues: CorpusIndependenceIssue[] = [];
  const root = await realpath(candidateDirectory);

  async function visit(directory: string): Promise<void> {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = resolve(directory, entry.name);
      const stats = await lstat(path);
      if (stats.isSymbolicLink()) {
        issues.push({ code: "SYMLINK", message: "corpus entries cannot be symlinks", path });
        const target = await realpath(path);
        if (!isContained(root, target)) {
          issues.push({ code: "PATH_ESCAPE", message: "symlink target escapes corpus", path });
        }
        continue;
      }

      const actualPath = await realpath(path);
      if (!isContained(root, actualPath)) {
        issues.push({ code: "PATH_ESCAPE", message: "entry escapes corpus", path });
        continue;
      }
      if (stats.isDirectory()) {
        await visit(path);
        continue;
      }
      if (stats.isFile()) {
        const buffer = await readFile(path);
        if (isText(buffer) && hasReferenceReuse(buffer.toString("utf8"), referenceDirectory)) {
          issues.push({
            code: "REFERENCE_REUSE",
            message: "file references the comparison corpus",
            path
          });
        }
      }
    }
  }

  await visit(root);
  return issues;
}

export async function auditCorpusIndependence(
  options: CorpusIndependenceOptions
): Promise<CorpusIndependenceIssue[]> {
  const candidateDirectory = await realpath(options.candidateDirectory);
  const referenceDirectory = await realpath(options.referenceDirectory);
  const issues = await auditCandidateTree(candidateDirectory, referenceDirectory);
  const [candidate, reference] = await Promise.all([
    collectTasks(candidateDirectory),
    collectTasks(referenceDirectory)
  ]);
  issues.push(...candidate.issues, ...reference.issues);

  const referenceIds = new Set(reference.tasks.map((task) => task.id));
  const referencePrompts = new Set(reference.tasks.map((task) => task.prompt));
  const referenceWorkspaces = new Set(reference.tasks.map((task) => task.workspace));
  const candidateIds = new Set<string>();

  for (const task of candidate.tasks) {
    if (candidateIds.has(task.id) || referenceIds.has(task.id)) {
      issues.push({
        code: "TASK_ID_REUSE",
        message: `task id is not unique to the candidate corpus: ${task.id}`,
        path: task.manifest
      });
    }
    candidateIds.add(task.id);
    if (referencePrompts.has(task.prompt)) {
      issues.push({
        code: "PROMPT_REUSE",
        message: "task prompt duplicates the comparison corpus",
        path: task.manifest
      });
    }
    if (referenceWorkspaces.has(task.workspace)) {
      issues.push({
        code: "WORKSPACE_REUSE",
        message: "task workspace duplicates the comparison corpus",
        path: task.directory
      });
    }
  }

  return issues.sort((left, right) =>
    left.path.localeCompare(right.path) || left.code.localeCompare(right.code)
  );
}
