import { createHash } from "node:crypto";

import type { Task } from "./contracts.js";
import { safeRelativePathSchema } from "./contracts.js";
import { RedactBenchError } from "./errors.js";

interface ParsedPatchResponse {
  kind: "patch";
  notes: string;
  patch: string;
  rawHash: string;
}

interface ParsedTextResponse {
  answer: string;
  kind: "text";
  rawHash: string;
}

export type ParsedModelResponse = ParsedPatchResponse | ParsedTextResponse;

function reject(message: string): never {
  throw new RedactBenchError("PATCH_REJECTED", message);
}

function validateRelativePatchPath(value: string, expectedPrefix: "a/" | "b/"): void {
  if (value === "/dev/null") {
    return;
  }

  if (!value.startsWith(expectedPrefix)) {
    reject(`patch path must begin with ${expectedPrefix}`);
  }

  const relativePath = value.slice(2);
  if (!safeRelativePathSchema().safeParse(relativePath).success) {
    reject(`unsafe patch path: ${value}`);
  }
}

function validateDiffHeader(line: string): void {
  const prefix = "diff --git a/";
  if (!line.startsWith(prefix)) {
    reject("patch must use git diff headers rooted at a/ and b/");
  }

  const separatorIndex = line.lastIndexOf(" b/");
  if (separatorIndex <= prefix.length) {
    reject("patch has a malformed git diff header");
  }

  const source = `a/${line.slice(prefix.length, separatorIndex)}`;
  const destination = line.slice(separatorIndex + 1);
  validateRelativePatchPath(source, "a/");
  validateRelativePatchPath(destination, "b/");
}

function validateUnifiedDiff(patch: string): void {
  if (patch.includes("\0")) {
    reject("patch contains a NUL byte");
  }
  if (/^GIT binary patch$/mu.test(patch) || /^Binary files /mu.test(patch)) {
    reject("binary patches are not allowed");
  }
  if (/^(?:new file mode|old mode) 120000$/mu.test(patch)) {
    reject("symlink patches are not allowed");
  }
  if (/^(?:rename|copy) (?:from|to) /mu.test(patch)) {
    reject("rename and copy patches are not supported in schema v1");
  }

  const lines = patch.split("\n");
  let diffCount = 0;
  let sourceCount = 0;
  let destinationCount = 0;
  let hunkCount = 0;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      validateDiffHeader(line);
      diffCount += 1;
    } else if (line.startsWith("--- ")) {
      validateRelativePatchPath(line.slice(4).split("\t", 1)[0] ?? "", "a/");
      sourceCount += 1;
    } else if (line.startsWith("+++ ")) {
      validateRelativePatchPath(line.slice(4).split("\t", 1)[0] ?? "", "b/");
      destinationCount += 1;
    } else if (line.startsWith("@@ ")) {
      hunkCount += 1;
    }
  }

  if (diffCount === 0 || sourceCount !== diffCount || destinationCount !== diffCount) {
    reject("patch must contain complete diff, source, and destination headers");
  }
  if (hunkCount === 0) {
    reject("patch must contain at least one text hunk");
  }
}

export function parseModelResponse(
  rawResponse: string,
  responseConfig: Task["response"]
): ParsedModelResponse {
  const bytes = Buffer.byteLength(rawResponse, "utf8");
  if (bytes > responseConfig.maxBytes) {
    reject(`model output exceeds the ${responseConfig.maxBytes}-byte limit`);
  }

  const rawHash = createHash("sha256").update(rawResponse).digest("hex");
  if (responseConfig.kind === "text") {
    const answer = rawResponse.trim();
    if (answer.length === 0) {
      reject("model output is empty");
    }
    return { answer, kind: "text", rawHash };
  }

  const normalized = rawResponse.replaceAll("\r\n", "\n");
  const envelopeTags = [
    "<redactbench_patch>",
    "</redactbench_patch>",
    "<redactbench_notes>",
    "</redactbench_notes>"
  ];
  if (envelopeTags.some((tag) => normalized.split(tag).length !== 2)) {
    reject("patch tasks require exactly one response envelope and no outside prose");
  }

  const match = /^\s*<redactbench_patch>\n([\s\S]+?)\n<\/redactbench_patch>\n<redactbench_notes>\n([\s\S]+?)\n<\/redactbench_notes>\s*$/u.exec(
    normalized
  );
  if (!match) {
    reject("patch tasks require exactly one response envelope and no outside prose");
  }

  const patch = match[1]?.trim();
  const notes = match[2]?.trim();
  if (!patch || !notes) {
    reject("patch and notes must both be non-empty");
  }
  if (Buffer.byteLength(notes, "utf8") > 32_768) {
    reject("notes exceed the 32768-byte limit");
  }

  validateUnifiedDiff(patch);
  return { kind: "patch", notes, patch, rawHash };
}
