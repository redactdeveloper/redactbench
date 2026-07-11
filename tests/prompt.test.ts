import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { buildTaskPrompt, snapshotWorkspace } from "../src/prompt.js";
import { TaskSchema } from "../src/contracts.js";

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), "redactbench-prompt-"));
  const workspace = join(root, "workspace");
  const evaluator = join(root, "evaluator");
  await mkdir(join(workspace, "src"), { recursive: true });
  await mkdir(evaluator, { recursive: true });
  await writeFile(join(workspace, "z-last.txt"), "last\n");
  await writeFile(join(workspace, "src", "a-first.js"), "export const value = 1;\n");
  await writeFile(join(workspace, ".env"), "OPENAI_API_KEY=never-leak\n");
  await writeFile(join(workspace, "private.pem"), "PRIVATE-KEY-CONTENT\n");
  await writeFile(join(workspace, "large.txt"), "TOO-LARGE-SECRET".repeat(100));
  await writeFile(join(workspace, "binary.bin"), Buffer.from([0, 1, 2, 3]));
  await writeFile(join(evaluator, "hidden.mjs"), "HIDDEN-EVALUATOR-CONTENT\n");
  await symlink(join(evaluator, "hidden.mjs"), join(workspace, "hidden-link"));
  return { root, workspace };
}

describe("snapshotWorkspace", () => {
  it("is deterministic, ordered, and excludes secrets, symlinks, binaries and oversized content", async () => {
    const { workspace } = await createWorkspace();

    const first = await snapshotWorkspace(workspace, {
      maxFileBytes: 128,
      maxTotalBytes: 1_024
    });
    const second = await snapshotWorkspace(workspace, {
      maxFileBytes: 128,
      maxTotalBytes: 1_024
    });

    expect(first.hash).toBe(second.hash);
    expect(first.text).toBe(second.text);
    expect(first.files.map((file) => file.path)).toEqual([
      "binary.bin",
      "large.txt",
      "src/a-first.js",
      "z-last.txt"
    ]);
    expect(first.text.indexOf("src/a-first.js")).toBeLessThan(
      first.text.indexOf("z-last.txt")
    );
    expect(first.text).toContain('reason="binary"');
    expect(first.text).toContain('reason="too-large"');
    expect(first.text).not.toContain("never-leak");
    expect(first.text).not.toContain(".env");
    expect(first.text).not.toContain("PRIVATE-KEY-CONTENT");
    expect(first.text).not.toContain("HIDDEN-EVALUATOR-CONTENT");
    expect(first.text).not.toContain("TOO-LARGE-SECRET");
  });

  it("changes the snapshot hash when visible source changes", async () => {
    const { workspace } = await createWorkspace();
    const before = await snapshotWorkspace(workspace);

    await writeFile(join(workspace, "src", "a-first.js"), "export const value = 2;\n");
    const after = await snapshotWorkspace(workspace);

    expect(after.hash).not.toBe(before.hash);
  });
});

describe("buildTaskPrompt", () => {
  it("binds the task, snapshot hash and strict response contract", async () => {
    const { workspace } = await createWorkspace();
    const snapshot = await snapshotWorkspace(workspace, { maxFileBytes: 128 });
    const task = TaskSchema.parse({
      schemaVersion: 1,
      id: "debug-get-user",
      title: "Fix getUser",
      category: "debugging",
      description: "Resolve user IDs independently from array indexes.",
      prompt: "Fix getUser without changing its public name.",
      checks: [
        {
          id: "hidden-tests",
          argv: ["node", "/evaluator/check.mjs"],
          image: "node:22-alpine"
        }
      ]
    });

    const prompt = buildTaskPrompt(task, snapshot);

    expect(prompt).toContain(task.prompt);
    expect(prompt).toContain(snapshot.hash);
    expect(prompt).toContain("<redactbench_patch>");
    expect(prompt).toContain("<redactbench_notes>");
    expect(prompt).not.toContain("hidden-tests");
  });
});
