import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ModelConfig } from "../src/contracts.js";
import { TaskSchema } from "../src/contracts.js";
import { runContextRecoveryAttempt } from "../src/context-recovery.js";
import type {
  GenerationRequest,
  ProviderAdapter,
  ProviderResult
} from "../src/providers/index.js";
import type { SandboxRunner } from "../src/sandbox/docker.js";

const phase1Patch = [
  "<redactbench_patch>",
  "diff --git a/parser.mjs b/parser.mjs",
  "--- a/parser.mjs",
  "+++ b/parser.mjs",
  "@@ -1 +1 @@",
  "-export const parsePort = (value) => Number(value);",
  "+export const parsePort = (value) => Number.parseInt(value, 10);",
  "</redactbench_patch>",
  "<redactbench_notes>",
  "Parser now uses explicit base 10. Formatter still needs the port range guard.",
  "</redactbench_notes>"
].join("\n");

const phase2Patch = [
  "<redactbench_patch>",
  "diff --git a/format.mjs b/format.mjs",
  "--- a/format.mjs",
  "+++ b/format.mjs",
  "@@ -1 +1,4 @@",
  "-export const formatPort = (port) => String(port);",
  "+export const formatPort = (port) => {",
  "+  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;",
  "+  return String(port);",
  "+};",
  "</redactbench_patch>",
  "<redactbench_notes>",
  "Finished the remaining formatter guard and preserved the parser change.",
  "</redactbench_notes>"
].join("\n");

function providerResult(text: string, phase: 1 | 2): ProviderResult {
  const startedAt = phase === 1 ? 0 : 1_000;
  const durationMs = phase === 1 ? 600 : 700;
  return {
    model: "provider-model-001",
    provider: "openai",
    providerRequestId: `response-phase-${phase}`,
    text,
    timing: {
      completedAt: new Date(startedAt + durationMs).toISOString(),
      durationMs,
      generationMs: durationMs - 100,
      outputTokensPerSecond: 20,
      startedAt: new Date(startedAt).toISOString(),
      ttftMs: 100
    },
    usage: {
      cachedInputTokens: 0,
      inputTokens: phase === 1 ? 100 : 150,
      outputTokens: phase === 1 ? 20 : 30
    }
  };
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "redactbench-recovery-"));
  await mkdir(join(root, "workspace"));
  await mkdir(join(root, "evaluator"));
  await writeFile(
    join(root, "workspace", "parser.mjs"),
    "export const parsePort = (value) => Number(value);\n"
  );
  await writeFile(
    join(root, "workspace", "format.mjs"),
    "export const formatPort = (port) => String(port);\n"
  );
  const task = TaskSchema.parse({
    schemaVersion: 1,
    id: "recover-port-utils",
    title: "Finish port utilities",
    category: "context-recovery",
    description: "Repair parsing and validation in a two-file utility.",
    prompt: "Make parsing explicit and reject ports outside 1..65535.",
    contextRecovery: {
      enabled: true,
      phase1Prompt: "Implement one coherent first slice, then leave precise notes.",
      phase2Prompt: "Recover the state and finish every remaining requirement."
    },
    checks: [
      {
        argv: ["node", "/evaluator/check.mjs"],
        id: "hidden-tests",
        image: "node:22-alpine"
      }
    ]
  });
  return { root, task };
}

const model = {
  id: "openai-primary",
  label: "OpenAI Primary",
  maxOutputTokens: 4_096,
  model: "provider-model",
  pricing: {
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 4
  },
  provider: "openai"
} satisfies Extract<ModelConfig, { provider: "openai" }>;

describe("runContextRecoveryAttempt", () => {
  it("uses two fresh workspace-harness calls and preserves phase-one edits", async () => {
    const testFixture = await fixture();
    const requests: GenerationRequest[] = [];
    const workspaceModel = {
      execution: "docker-harness",
      harness: "opencode",
      id: "hy3-high-opencode",
      label: "Hy3 High",
      maxOutputTokens: 8_192,
      model: "openrouter/tencent/hy3",
      provider: "openrouter"
    } satisfies ModelConfig;
    const adapter: ProviderAdapter = {
      model: workspaceModel.model,
      provider: "openrouter",
      workspaceMode: true,
      async generate(request) {
        requests.push(request);
        const workspace = request.workspaceDirectory!;
        if (requests.length === 1) {
          await writeFile(
            join(workspace, "parser.mjs"),
            "export const parsePort = (value) => Number.parseInt(value, 10);\n"
          );
          return {
            ...providerResult("Parser change is complete; formatter remains.", 1),
            model: workspaceModel.model,
            provider: "openrouter"
          };
        }
        expect(await readFile(join(workspace, "parser.mjs"), "utf8"))
          .toContain("Number.parseInt");
        await writeFile(
          join(workspace, "format.mjs"),
          [
            "export const formatPort = (port) => {",
            "  if (!Number.isInteger(port) || port < 1 || port > 65535) return null;",
            "  return String(port);",
            "};"
          ].join("\n") + "\n"
        );
        return {
          ...providerResult("Recovered phase one and finished the formatter.", 2),
          model: workspaceModel.model,
          provider: "openrouter"
        };
      }
    };
    const sandbox: SandboxRunner = vi.fn(async (_check, context) => {
      expect(await readFile(join(context.workspaceDirectory, "parser.mjs"), "utf8"))
        .toContain("Number.parseInt");
      expect(await readFile(join(context.workspaceDirectory, "format.mjs"), "utf8"))
        .toContain("65535");
      return {
        durationMs: 20,
        exitCode: 0,
        imageId: "sha256:recovery-image",
        output: "passed",
        outputLimitExceeded: false,
        timedOut: false
      };
    });

    const result = await runContextRecoveryAttempt({
      adapter,
      attemptId: "run:recover-port-utils:hy3-high-opencode:1",
      model: workspaceModel,
      repeat: 1,
      sandbox,
      task: testFixture.task,
      taskDirectory: testFixture.root
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]?.requestId).toMatch(/phase1$/u);
    expect(requests[1]?.requestId).toMatch(/phase2$/u);
    expect(requests[0]?.workspaceDirectory).toBe(requests[1]?.workspaceDirectory);
    expect(requests[1]?.prompt).toContain("Parser change is complete");
    expect(requests[1]?.prompt).toContain("Number.parseInt");
    expect(requests[1]?.prompt).not.toContain("<redactbench_patch>");
    expect(result.report).toMatchObject({
      provider: "openrouter",
      score: 1,
      status: "passed",
      contextRecovery: {
        duplicateEdits: 0,
        notesPreserved: true,
        rollbackDetected: false
      }
    });
    expect(result.artifacts.phase1ResponseHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(result.artifacts.phase2ResponseHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(await readFile(join(testFixture.root, "workspace", "parser.mjs"), "utf8"))
      .toContain("Number(value)");
  });

  it("performs two independent calls and recovers from repo, git and notes", async () => {
    const testFixture = await fixture();
    const requests: GenerationRequest[] = [];
    const adapter: ProviderAdapter = {
      model: "provider-model",
      provider: "openai",
      generate: vi.fn(async (request) => {
        requests.push(request);
        return requests.length === 1
          ? providerResult(phase1Patch, 1)
          : providerResult(phase2Patch, 2);
      })
    };
    let temporaryWorkspace = "";
    const sandbox: SandboxRunner = vi.fn(async (_check, context) => {
      temporaryWorkspace = context.workspaceDirectory;
      const parser = await readFile(join(context.workspaceDirectory, "parser.mjs"), "utf8");
      const formatter = await readFile(join(context.workspaceDirectory, "format.mjs"), "utf8");
      expect(parser).toContain("Number.parseInt");
      expect(formatter).toContain("65535");
      return {
        durationMs: 20,
        exitCode: 0,
        imageId: "sha256:recovery-image",
        output: "all recovery checks passed",
        outputLimitExceeded: false,
        timedOut: false
      };
    });
    const now = vi.fn().mockReturnValueOnce(Date.parse("2026-07-12T00:00:00.000Z")).mockReturnValueOnce(Date.parse("2026-07-12T00:00:03.000Z"));

    const result = await runContextRecoveryAttempt({
      adapter,
      attemptId: "run:recover-port-utils:openai-primary:1",
      model,
      now,
      repeat: 1,
      sandbox,
      task: testFixture.task,
      taskDirectory: testFixture.root
    });

    expect(adapter.generate).toHaveBeenCalledTimes(2);
    expect(requests[0]?.fixtureResponseKey).toBe("recover-port-utils:phase1");
    expect(requests[1]?.fixtureResponseKey).toBe("recover-port-utils:phase2");
    expect(requests[1]?.prompt).toContain("Parser now uses explicit base 10");
    expect(requests[1]?.prompt).toContain("redactbench: phase 1");
    expect(requests[1]?.prompt).toContain("Number.parseInt");
    expect(requests[1]?.prompt).not.toContain("return users[id]");
    expect(Object.keys(requests[1] ?? {})).not.toContain("previousResponseId");

    expect(result.report).toMatchObject({
      score: 1,
      status: "passed",
      contextRecovery: {
        checksPassed: 1,
        duplicateEdits: 0,
        notesPreserved: true,
        recoveryMs: 700,
        rollbackDetected: false
      },
      metrics: {
        costUsd: 0.00045,
        inputTokens: 250,
        outputTokens: 50
      }
    });
    expect(result.artifacts.phase1ResponseHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.artifacts.phase2ResponseHash).toMatch(/^[a-f0-9]{64}$/);

    const originalParser = await readFile(
      join(testFixture.root, "workspace", "parser.mjs"),
      "utf8"
    );
    expect(originalParser).toContain("Number(value)");
    await expect(access(temporaryWorkspace)).rejects.toThrow();
  });

  it("never runs hidden checks if phase 2 rolls back into an invalid patch", async () => {
    const testFixture = await fixture();
    const adapter: ProviderAdapter = {
      model: "provider-model",
      provider: "openai",
      generate: vi
        .fn()
        .mockResolvedValueOnce(providerResult(phase1Patch, 1))
        .mockResolvedValueOnce(
          providerResult(
            phase2Patch.replace("export const formatPort", "export const missing"),
            2
          )
        )
    };
    const sandbox = vi.fn<SandboxRunner>();

    const result = await runContextRecoveryAttempt({
      adapter,
      attemptId: "run:recover-port-utils:openai-primary:1",
      model,
      repeat: 1,
      sandbox,
      task: testFixture.task,
      taskDirectory: testFixture.root
    });

    expect(result.report).toMatchObject({
      error: { code: "PATCH_REJECTED" },
      score: 0,
      status: "error"
    });
    expect(sandbox).not.toHaveBeenCalled();
  });
});
