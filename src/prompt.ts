import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { posix, resolve } from "node:path";

import type { Task } from "./contracts.js";
import { safeRelativePathSchema } from "./contracts.js";
import { RedactBenchError } from "./errors.js";

const DEFAULT_MAX_FILE_BYTES = 131_072;
const DEFAULT_MAX_TOTAL_BYTES = 1_048_576;
const DEFAULT_MAX_FILES = 2_000;

const IGNORED_DIRECTORIES = new Set([".git", ".redactbench", "node_modules"]);
const SECRET_FILENAMES = new Set([".npmrc", ".pypirc", "credentials.json"]);
const SECRET_EXTENSIONS = [".key", ".p12", ".pem", ".pfx"];

export interface SnapshotOptions {
  maxFileBytes?: number;
  maxFiles?: number;
  maxTotalBytes?: number;
}

interface TextSnapshotFile {
  bytes: number;
  content: string;
  kind: "text";
  path: string;
  sha256: string;
}

interface OmittedSnapshotFile {
  bytes: number;
  kind: "omitted";
  path: string;
  reason: "binary" | "total-limit" | "too-large";
  sha256: string;
}

export type SnapshotFile = OmittedSnapshotFile | TextSnapshotFile;

export interface WorkspaceSnapshot {
  files: SnapshotFile[];
  hash: string;
  text: string;
  totalBytes: number;
}

function isSecretFilename(filename: string): boolean {
  const lower = filename.toLowerCase();
  return (
    lower === ".env" ||
    lower.startsWith(".env.") ||
    SECRET_FILENAMES.has(lower) ||
    SECRET_EXTENSIONS.some((extension) => lower.endsWith(extension))
  );
}

function escapeAttribute(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
}

async function hashFile(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

async function collectFiles(
  directory: string,
  relativeDirectory: string,
  output: Array<{ absolutePath: string; path: string }>
): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true });
  entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

  for (const entry of entries) {
    if (entry.isSymbolicLink()) {
      continue;
    }

    const relativePath = relativeDirectory
      ? posix.join(relativeDirectory, entry.name)
      : entry.name;
    const absolutePath = resolve(directory, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name)) {
        await collectFiles(absolutePath, relativePath, output);
      }
      continue;
    }

    if (!entry.isFile() || isSecretFilename(entry.name)) {
      continue;
    }

    if (!safeRelativePathSchema().safeParse(relativePath).success) {
      throw new RedactBenchError(
        "CONFIG_INVALID",
        `workspace contains an unsupported path: ${relativePath}`
      );
    }

    output.push({ absolutePath, path: relativePath });
  }
}

function renderSnapshot(files: readonly SnapshotFile[], hash: string): string {
  const lines = [
    `<repository_snapshot sha256="${hash}" files="${files.length}">`
  ];

  for (const file of files) {
    const metadata = `path="${escapeAttribute(file.path)}" bytes="${file.bytes}" sha256="${file.sha256}"`;
    if (file.kind === "omitted") {
      lines.push(`<omitted_file ${metadata} reason="${file.reason}" />`);
    } else {
      lines.push(`<file ${metadata}>`, file.content, "</file>");
    }
  }

  lines.push("</repository_snapshot>");
  return lines.join("\n");
}

export async function snapshotWorkspace(
  workspaceDirectory: string,
  options: SnapshotOptions = {}
): Promise<WorkspaceSnapshot> {
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const discovered: Array<{ absolutePath: string; path: string }> = [];

  await collectFiles(resolve(workspaceDirectory), "", discovered);
  discovered.sort((left, right) => left.path.localeCompare(right.path, "en"));

  if (discovered.length > maxFiles) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      `workspace contains ${discovered.length} files; maximum is ${maxFiles}`
    );
  }

  const files: SnapshotFile[] = [];
  let totalBytes = 0;

  for (const discoveredFile of discovered) {
    const fileStat = await stat(discoveredFile.absolutePath);
    const bytes = fileStat.size;
    const sha256 = await hashFile(discoveredFile.absolutePath);

    if (bytes > maxFileBytes) {
      files.push({
        bytes,
        kind: "omitted",
        path: discoveredFile.path,
        reason: "too-large",
        sha256
      });
      continue;
    }

    const buffer = await readFile(discoveredFile.absolutePath);
    if (buffer.subarray(0, 8_192).includes(0)) {
      files.push({
        bytes,
        kind: "omitted",
        path: discoveredFile.path,
        reason: "binary",
        sha256
      });
      continue;
    }

    if (totalBytes + bytes > maxTotalBytes) {
      files.push({
        bytes,
        kind: "omitted",
        path: discoveredFile.path,
        reason: "total-limit",
        sha256
      });
      continue;
    }

    totalBytes += bytes;
    files.push({
      bytes,
      content: buffer.toString("utf8"),
      kind: "text",
      path: discoveredFile.path,
      sha256
    });
  }

  const canonical = JSON.stringify(files);
  const hash = createHash("sha256").update(canonical).digest("hex");
  return {
    files,
    hash,
    text: renderSnapshot(files, hash),
    totalBytes
  };
}

function responseContract(
  task: Task,
  responseMode: "envelope" | "workspace"
): string {
  if (responseMode === "workspace") {
    return task.response.kind === "text"
      ? [
          "Do not modify repository files for this reasoning task.",
          "Return only the final answer as plain text with the requested evidence."
        ].join("\n")
      : [
          "Inspect and edit the mounted repository directly.",
          "Run useful local checks when available, but never claim hidden checks passed.",
          "In the final message, concisely state what changed and what you verified.",
          "Do not print a patch envelope; filesystem changes are the submitted solution."
        ].join("\n");
  }

  if (task.response.kind === "text") {
    return [
      "Return only the final answer as plain text.",
      "Do not claim success without giving the requested evidence."
    ].join("\n");
  }

  return [
    "Return exactly one response envelope and no prose outside it:",
    "<redactbench_patch>",
    "A unified git diff rooted at the repository (a/ and b/ paths).",
    "</redactbench_patch>",
    "<redactbench_notes>",
    "Concise notes describing what changed, what remains, and verification advice.",
    "</redactbench_notes>",
    "Do not include binary patches, symlinks, absolute paths, or parent-directory paths."
  ].join("\n");
}

export function buildTaskPrompt(
  task: Task,
  snapshot: WorkspaceSnapshot,
  responseMode: "envelope" | "workspace" = "envelope"
): string {
  return [
    `Task: ${task.title}`,
    `Category: ${task.category}`,
    "",
    task.description,
    "",
    "User request:",
    task.prompt,
    "",
    "Repository snapshot (the evaluator is intentionally not included):",
    snapshot.text,
    "",
    "Response contract:",
    responseContract(task, responseMode)
  ].join("\n");
}
