import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { main } from "../src/cli.js";

function outputBuffer() {
  let value = "";
  return {
    stream: { write(chunk: string) { value += chunk; return true; } },
    value: () => value
  };
}

async function validConfiguration() {
  const root = await mkdtemp(join(tmpdir(), "redactbench-cli-"));
  const taskDirectory = join(root, "task");
  await mkdir(join(taskDirectory, "workspace"), { recursive: true });
  await mkdir(join(taskDirectory, "evaluator"), { recursive: true });
  await writeFile(
    join(taskDirectory, "task.yaml"),
    [
      "schemaVersion: 1",
      "id: debug",
      "title: Debug",
      "category: debugging",
      "description: Debug a fixture.",
      "prompt: Fix it.",
      "checks:",
      "  - id: check",
      "    image: node:22-alpine",
      "    argv: [node, /evaluator/check.mjs]"
    ].join("\n")
  );
  const suiteFile = join(root, "suite.yaml");
  await writeFile(
    suiteFile,
    [
      "schemaVersion: 1",
      "id: demo",
      "title: Demo",
      "tasks:",
      "  - manifest: task/task.yaml"
    ].join("\n")
  );
  const modelsFile = join(root, "models.yaml");
  await writeFile(
    join(root, "fixture.json"),
    JSON.stringify({ schemaVersion: 1, responses: {} })
  );
  await writeFile(
    modelsFile,
    [
      "schemaVersion: 1",
      "models:",
      "  - id: fixture",
      "    label: Fixture",
      "    provider: fixture",
      "    model: fixture-v1",
      "    fixtureFile: fixture.json"
    ].join("\n")
  );
  return { modelsFile, root, suiteFile };
}

describe("CLI", () => {
  it("shows help and version without touching configuration", async () => {
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    expect(await main(["--help"], { stderr: stderr.stream, stdout: stdout.stream })).toBe(0);
    expect(stdout.value()).toContain("redactbench validate");
    expect(stderr.value()).toBe("");

    const version = outputBuffer();
    expect(await main(["--version"], { stdout: version.stream })).toBe(0);
    expect(version.value()).toBe("0.1.0\n");
  });

  it("validates suite, task and model files without running Docker", async () => {
    const config = await validConfiguration();
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    const exitCode = await main(
      ["validate", "--suite", config.suiteFile, "--models", config.modelsFile],
      { stderr: stderr.stream, stdout: stdout.stream }
    );

    expect(exitCode).toBe(0);
    expect(stdout.value()).toContain("1 task · 1 model");
    expect(stderr.value()).toBe("");
  });

  it("returns a stable config exit code and a path-aware safe error", async () => {
    const config = await validConfiguration();
    await writeFile(
      config.suiteFile,
      [
        "schemaVersion: 1",
        "id: demo",
        "title: Demo",
        "tasks:",
        "  - manifest: ../outside/task.yaml"
      ].join("\n")
    );
    const stdout = outputBuffer();
    const stderr = outputBuffer();

    const exitCode = await main(
      ["validate", "--suite", config.suiteFile, "--models", config.modelsFile],
      { stderr: stderr.stream, stdout: stdout.stream }
    );

    expect(exitCode).toBe(2);
    expect(stdout.value()).toBe("");
    expect(stderr.value()).toContain("CONFIG_INVALID");
    expect(stderr.value()).toContain("suite.yaml:tasks.0.manifest");
    expect(stderr.value()).not.toContain("at main");
  });

  it("rejects unsafe concurrency before starting a run", async () => {
    const config = await validConfiguration();
    const stderr = outputBuffer();

    const exitCode = await main(
      [
        "run",
        "--suite",
        config.suiteFile,
        "--models",
        config.modelsFile,
        "--concurrency",
        "99"
      ],
      { stderr: stderr.stream }
    );

    expect(exitCode).toBe(2);
    expect(stderr.value()).toContain("concurrency must be between 1 and 8");
  });
});
