import { mkdir, mkdtemp, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadBenchmarkDefinition, loadSuiteDefinition } from "../src/definition.js";

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

  it("rejects a release suite without three independent tasks per category", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-release-coverage-"));
    const taskDirectory = join(root, "debug-task");
    await mkdir(join(taskDirectory, "workspace"), { recursive: true });
    await mkdir(join(taskDirectory, "evaluator"), { recursive: true });
    await writeFile(join(taskDirectory, "task.yaml"), [
      "schemaVersion: 1",
      "id: debug-one",
      "title: Debug one",
      "category: debugging",
      "description: Independent release task.",
      "prompt: Fix it.",
      "checks:",
      "  - id: check",
      "    image: node:22-alpine",
      "    argv: [node, /evaluator/check.mjs]"
    ].join("\n"));
    const suiteFile = join(root, "suite.yaml");
    await writeFile(suiteFile, [
      "schemaVersion: 1",
      "id: silver",
      "title: Silver",
      "purpose: release",
      "tasks:",
      "  - manifest: debug-task/task.yaml"
    ].join("\n"));

    await expect(loadSuiteDefinition(suiteFile)).rejects.toThrow(
      /release suite requires at least 3 tasks per category.*algorithms: 0.*debugging: 1/iu
    );
  });

  it("rejects release task manifests that share one real directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-release-shared-"));
    const taskDirectory = join(root, "shared-task");
    await mkdir(join(taskDirectory, "workspace"), { recursive: true });
    await mkdir(join(taskDirectory, "evaluator"), { recursive: true });
    const manifest = (id: string) => [
      "schemaVersion: 1",
      `id: ${id}`,
      `title: ${id}`,
      "category: debugging",
      "description: Must own an independent directory.",
      "prompt: Fix it.",
      "checks:",
      "  - id: check",
      "    image: node:22-alpine",
      "    argv: [node, /evaluator/check.mjs]"
    ].join("\n");
    await writeFile(join(taskDirectory, "one.yaml"), manifest("debug-one"));
    await writeFile(join(taskDirectory, "two.yaml"), manifest("debug-two"));
    const suiteFile = join(root, "suite.yaml");
    await writeFile(suiteFile, [
      "schemaVersion: 1",
      "id: silver",
      "title: Silver",
      "purpose: release",
      "tasks:",
      "  - manifest: shared-task/one.yaml",
      "  - manifest: shared-task/two.yaml"
    ].join("\n"));

    await expect(loadSuiteDefinition(suiteFile)).rejects.toThrow(
      /release tasks must use independent directories/iu
    );
  });
});
