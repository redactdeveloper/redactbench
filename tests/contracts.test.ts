import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { loadYamlConfig } from "../src/config.js";
import {
  ModelConfigFileSchema,
  ReportSchema,
  SuiteSchema,
  TaskSchema
} from "../src/contracts.js";
import { RedactBenchError } from "../src/errors.js";

const validCheck = {
  id: "edge-cases",
  argv: ["node", "/evaluator/check.mjs"],
  image: "node:22-alpine"
};

const validTask = {
  schemaVersion: 1,
  id: "debug-get-user",
  title: "Fix getUser",
  category: "debugging",
  description: "Resolve IDs independently from array indexes.",
  prompt: "Fix the bug without changing the public API.",
  checks: [validCheck]
};

describe("TaskSchema", () => {
  it("parses a minimal task and supplies bounded safe defaults", () => {
    const task = TaskSchema.parse(validTask);

    expect(task.workspace).toBe("workspace");
    expect(task.evaluator).toBe("evaluator");
    expect(task.response).toEqual({ kind: "patch", maxBytes: 262_144 });
    expect(task.checks[0]).toMatchObject({
      cwd: ".",
      maxOutputBytes: 65_536,
      timeoutMs: 30_000,
      weight: 1
    });
  });

  it.each([
    ["absolute workspace", { workspace: "/etc" }, "workspace"],
    ["escaping evaluator", { evaluator: "../hidden" }, "evaluator"],
    ["windows separator", { workspace: "foo\\bar" }, "workspace"],
    ["unknown category", { category: "magic" }, "category"]
  ])("rejects %s", (_label, override, issuePath) => {
    const result = TaskSchema.safeParse({ ...validTask, ...override });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path.join(".") === issuePath)).toBe(true);
    }
  });

  it("requires argv arrays instead of shell command strings", () => {
    const result = TaskSchema.safeParse({
      ...validTask,
      checks: [{ ...validCheck, argv: "node /evaluator/check.mjs" }]
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path.join(".")).toContain("checks.0.argv");
    }
  });

  it("rejects unbounded evaluator resources", () => {
    const result = TaskSchema.safeParse({
      ...validTask,
      checks: [
        {
          ...validCheck,
          maxOutputBytes: 10_000_000,
          timeoutMs: 3_600_000
        }
      ]
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      const paths = result.error.issues.map((issue) => issue.path.join("."));
      expect(paths).toContain("checks.0.timeoutMs");
      expect(paths).toContain("checks.0.maxOutputBytes");
    }
  });

  it("only allows recovery configuration on context-recovery tasks", () => {
    const result = TaskSchema.safeParse({
      ...validTask,
      contextRecovery: {
        enabled: true,
        phase1Prompt: "Implement the first safe slice."
      }
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues[0]?.path).toEqual(["contextRecovery"]);
    }
  });
});

describe("SuiteSchema", () => {
  it("rejects duplicate task manifests", () => {
    const result = SuiteSchema.safeParse({
      schemaVersion: 1,
      id: "demo",
      title: "Demo suite",
      tasks: [
        { manifest: "debug/task.yaml" },
        { manifest: "debug/task.yaml" }
      ]
    });

    expect(result.success).toBe(false);
  });
});

describe("ModelConfigFileSchema", () => {
  it("parses direct providers without accepting endpoint or key overrides", () => {
    const valid = ModelConfigFileSchema.parse({
      schemaVersion: 1,
      models: [
        {
          id: "openai-primary",
          label: "OpenAI Primary",
          provider: "openai",
          model: "gpt-example",
          maxOutputTokens: 4096,
          pricing: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 4
          }
        }
      ]
    });

    expect(valid.models[0]?.provider).toBe("openai");

    const unsafe = ModelConfigFileSchema.safeParse({
      schemaVersion: 1,
      models: [
        {
          ...valid.models[0],
          apiKey: "should-never-be-configurable",
          baseUrl: "http://127.0.0.1:1234"
        }
      ]
    });
    expect(unsafe.success).toBe(false);
  });

  it("rejects duplicate model IDs", () => {
    const model = {
      id: "fixture",
      label: "Fixture",
      provider: "fixture",
      model: "fixture-v1",
      fixtureFile: "fixtures/model.json"
    };

    expect(
      ModelConfigFileSchema.safeParse({
        schemaVersion: 1,
        models: [model, model]
      }).success
    ).toBe(false);
  });
});

describe("ReportSchema", () => {
  it("preserves missing performance metrics as null instead of zero", () => {
    const report = ReportSchema.parse({
      schemaVersion: 1,
      scorerVersion: "1.0.0",
      generatedAt: "2026-07-12T00:00:00.000Z",
      run: {
        id: "run-demo",
        title: "Demo",
        startedAt: "2026-07-12T00:00:00.000Z",
        completedAt: null,
        modelCount: 1,
        repeatCount: 1,
        taskCount: 1
      },
      leaderboard: [
        {
          modelId: "fixture",
          label: "Fixture",
          provider: "fixture",
          score: 1,
          categories: { debugging: 1 },
          metrics: {
            attemptCount: 1,
            avgTtftMs: null,
            correctCount: 1,
            costPerCorrectUsd: null,
            outputTokensPerSecond: null,
            totalCostUsd: null
          }
        }
      ],
      attempts: [],
      journalVerified: true,
      sandbox: {
        imageIds: [],
        kind: "docker",
        network: "none"
      }
    });

    expect(report.leaderboard[0]?.metrics.avgTtftMs).toBeNull();
    expect(report.leaderboard[0]?.metrics.totalCostUsd).toBeNull();
  });
});

describe("loadYamlConfig", () => {
  it("reports source and field paths with a stable CONFIG_INVALID code", async () => {
    const directory = await mkdtemp(join(tmpdir(), "redactbench-config-"));
    const file = join(directory, "suite.yaml");
    await writeFile(
      file,
      [
        "schemaVersion: 1",
        "id: demo",
        "title: Demo",
        "tasks:",
        "  - manifest: ../escape/task.yaml"
      ].join("\n")
    );

    await expect(loadYamlConfig(file, SuiteSchema)).rejects.toMatchObject({
      code: "CONFIG_INVALID"
    } satisfies Partial<RedactBenchError>);

    try {
      await loadYamlConfig(file, SuiteSchema);
    } catch (error) {
      expect(error).toBeInstanceOf(RedactBenchError);
      expect((error as Error).message).toContain("suite.yaml:tasks.0.manifest");
      expect((error as Error).message).not.toContain("ZodError");
    }
  });
});
