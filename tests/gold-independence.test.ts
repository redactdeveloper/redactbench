import { mkdtemp, mkdir, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  auditCorpusIndependence,
  type CorpusIndependenceIssue
} from "../src/corpus-independence.js";

const temporaryDirectories: string[] = [];

async function createCorpusRoot(): Promise<{
  candidate: string;
  reference: string;
  root: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "redactbench-corpus-"));
  temporaryDirectories.push(root);
  const candidate = join(root, "gold");
  const reference = join(root, "silver");
  await Promise.all([
    mkdir(candidate, { recursive: true }),
    mkdir(reference, { recursive: true })
  ]);
  return { candidate, reference, root };
}

async function addTask(
  corpus: string,
  directoryName: string,
  options: { id: string; prompt: string; source: string }
): Promise<void> {
  const taskDirectory = join(corpus, directoryName);
  await mkdir(join(taskDirectory, "workspace"), { recursive: true });
  await writeFile(
    join(taskDirectory, "task.yaml"),
    [
      "schemaVersion: 1",
      `id: ${options.id}`,
      `prompt: ${JSON.stringify(options.prompt)}`,
      "workspace: workspace"
    ].join("\n")
  );
  await writeFile(join(taskDirectory, "workspace", "source.mjs"), options.source);
}

function issueCodes(issues: readonly CorpusIndependenceIssue[]): string[] {
  return issues.map((issue) => issue.code);
}

afterEach(async () => {
  const { rm } = await import("node:fs/promises");
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true })
    )
  );
});

describe("Gold corpus independence", () => {
  it("accepts a physically and semantically independent corpus", async () => {
    const { candidate, reference } = await createCorpusRoot();
    await addTask(reference, "old-task", {
      id: "silver-old-task",
      prompt: "Repair the legacy counter.",
      source: "export const legacyCounter = 1;\n"
    });
    await addTask(candidate, "new-task", {
      id: "gold-new-task",
      prompt: "Recover an interrupted import without skipping records.",
      source: "export async function resumeImport() { return 'pending'; }\n"
    });

    await expect(
      auditCorpusIndependence({ candidateDirectory: candidate, referenceDirectory: reference })
    ).resolves.toEqual([]);
  });

  it("rejects symlinks, path escapes, and textual references to Silver", async () => {
    const { candidate, reference, root } = await createCorpusRoot();
    await addTask(reference, "old-task", {
      id: "silver-old-task",
      prompt: "Repair the legacy counter.",
      source: "export const legacyCounter = 1;\n"
    });
    await addTask(candidate, "new-task", {
      id: "gold-new-task",
      prompt: "Repair a new importer.",
      source: "import '../../../benchmarks/silver/old-task/workspace/source.mjs';\n"
    });
    await writeFile(join(root, "outside.txt"), "outside\n");
    await symlink(join(root, "outside.txt"), join(candidate, "outside-link.txt"));

    const issues = await auditCorpusIndependence({
      candidateDirectory: candidate,
      referenceDirectory: reference
    });

    expect(issueCodes(issues)).toContain("SYMLINK");
    expect(issueCodes(issues)).toContain("PATH_ESCAPE");
    expect(issueCodes(issues)).toContain("REFERENCE_REUSE");
  });

  it("rejects reused task IDs and normalized prompts", async () => {
    const { candidate, reference } = await createCorpusRoot();
    await addTask(reference, "old-task", {
      id: "shared-task",
      prompt: "Repair the legacy counter without changing its API.",
      source: "export const legacyCounter = 1;\n"
    });
    await addTask(candidate, "new-task", {
      id: "shared-task",
      prompt: "  Repair the legacy counter\nwithout changing its API.  ",
      source: "export const newCounter = 2;\n"
    });

    const issues = await auditCorpusIndependence({
      candidateDirectory: candidate,
      referenceDirectory: reference
    });

    expect(issueCodes(issues)).toContain("TASK_ID_REUSE");
    expect(issueCodes(issues)).toContain("PROMPT_REUSE");
  });

  it("rejects a copied normalized workspace", async () => {
    const { candidate, reference } = await createCorpusRoot();
    await addTask(reference, "old-task", {
      id: "silver-old-task",
      prompt: "Repair the legacy counter.",
      source: "export const value = {\n  status: 'broken'\n};\n"
    });
    await addTask(candidate, "new-task", {
      id: "gold-new-task",
      prompt: "Repair the new importer.",
      source: " export const value = { status: 'broken' }; "
    });

    const issues = await auditCorpusIndependence({
      candidateDirectory: candidate,
      referenceDirectory: reference
    });

    expect(issueCodes(issues)).toContain("WORKSPACE_REUSE");
  });
});
