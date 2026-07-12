import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadBenchmarkDefinition } from "../src/definition.js";

describe("benchmark definition containment", () => {
  it("rejects a task manifest reached through a symlink outside the suite", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-definition-"));
    const suiteDirectory = join(root, "suite");
    const outsideTask = join(root, "outside-task");
    await mkdir(join(outsideTask, "workspace"), { recursive: true });
    await mkdir(join(outsideTask, "evaluator"), { recursive: true });
    await mkdir(suiteDirectory);
    await writeFile(
      join(outsideTask, "task.yaml"),
      [
        "schemaVersion: 1",
        "id: escaped-task",
        "title: Escaped task",
        "category: debugging",
        "description: Must remain contained.",
        "prompt: Fix it.",
        "checks:",
        "  - id: check",
        "    image: node:22-alpine",
        "    argv: [node, /evaluator/check.mjs]"
      ].join("\n")
    );
    await symlink(outsideTask, join(suiteDirectory, "linked-task"), "dir");
    const suiteFile = join(suiteDirectory, "suite.yaml");
    await writeFile(
      suiteFile,
      [
        "schemaVersion: 1",
        "id: suite",
        "title: Suite",
        "tasks:",
        "  - manifest: linked-task/task.yaml"
      ].join("\n")
    );
    const modelsFile = join(root, "models.yaml");
    await writeFile(
      modelsFile,
      [
        "schemaVersion: 1",
        "models:",
        "  - id: direct",
        "    label: Direct",
        "    provider: openai",
        "    model: model-snapshot"
      ].join("\n")
    );

    await expect(loadBenchmarkDefinition(suiteFile, modelsFile)).rejects.toMatchObject({
      code: "CONFIG_INVALID"
    });
  });
});
