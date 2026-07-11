import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ModelConfig } from "../src/contracts.js";
import { TaskSchema } from "../src/contracts.js";
import { runAttempt } from "../src/attempt.js";
import type { ProviderAdapter } from "../src/providers/index.js";
import type { SandboxRunner } from "../src/sandbox/docker.js";

const patchEnvelope = [
  "<redactbench_patch>",
  "diff --git a/users.mjs b/users.mjs",
  "index 1111111..2222222 100644",
  "--- a/users.mjs",
  "+++ b/users.mjs",
  "@@ -1,3 +1,3 @@",
  " export function getUser(users, id) {",
  "-  return users[id];",
  "+  return users.find((user) => user.id === id);",
  " }",
  "</redactbench_patch>",
  "<redactbench_notes>",
  "Lookup now uses the user ID. Hidden checks remain to be run.",
  "</redactbench_notes>"
].join("\n");

async function taskDirectory(responseKind: "patch" | "text" = "patch") {
  const root = await mkdtemp(join(tmpdir(), "redactbench-attempt-"));
  await mkdir(join(root, "workspace"));
  await mkdir(join(root, "evaluator"));
  await writeFile(
    join(root, "workspace", "users.mjs"),
    [
      "export function getUser(users, id) {",
      "  return users[id];",
      "}"
    ].join("\n") + "\n"
  );
  await writeFile(join(root, "evaluator", "hidden.txt"), "must-not-enter-prompt");
  const task = TaskSchema.parse({
    schemaVersion: 1,
    id: responseKind === "patch" ? "debug-get-user" : "false-premise",
    title: responseKind === "patch" ? "Fix getUser" : "Reject a false premise",
    category: responseKind === "patch" ? "debugging" : "hallucination",
    description: "A deterministic attempt fixture.",
    prompt: responseKind === "patch" ? "Fix getUser." : "Explain why 2 + 2 = 5.",
    response: { kind: responseKind },
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

function provider(text: string): ProviderAdapter {
  return {
    model: "provider-model-001",
    provider: "openai",
    generate: vi.fn().mockResolvedValue({
      model: "provider-model-001",
      provider: "openai",
      providerRequestId: "resp_123",
      text,
      timing: {
        completedAt: "2026-07-12T00:00:01.000Z",
        durationMs: 1_000,
        generationMs: 750,
        outputTokensPerSecond: 16,
        startedAt: "2026-07-12T00:00:00.000Z",
        ttftMs: 250
      },
      usage: {
        cachedInputTokens: 20,
        inputTokens: 100,
        outputTokens: 12
      }
    })
  };
}

const model = {
  id: "openai-primary",
  label: "OpenAI Primary",
  maxOutputTokens: 4_096,
  model: "provider-model",
  pricing: {
    cachedInputUsdPerMillion: 0.5,
    inputUsdPerMillion: 1,
    outputUsdPerMillion: 4
  },
  provider: "openai"
} satisfies Extract<ModelConfig, { provider: "openai" }>;

describe("runAttempt", () => {
  it("applies a validated patch only to a temporary workspace and evaluates it", async () => {
    const fixture = await taskDirectory();
    let temporaryWorkspace = "";
    const sandbox: SandboxRunner = vi.fn(async (_check, context) => {
      temporaryWorkspace = context.workspaceDirectory;
      const source = await readFile(join(context.workspaceDirectory, "users.mjs"), "utf8");
      expect(source).toContain("users.find");
      expect(source).not.toContain("users[id]");
      return {
        durationMs: 20,
        exitCode: 0,
        imageId: "sha256:test-image",
        output: "4 / 4 passed",
        outputLimitExceeded: false,
        timedOut: false
      };
    });
    const adapter = provider(patchEnvelope);
    const now = vi.fn().mockReturnValueOnce(Date.parse("2026-07-12T00:00:00.000Z")).mockReturnValueOnce(Date.parse("2026-07-12T00:00:02.000Z"));

    const result = await runAttempt({
      adapter,
      attemptId: "run:debug-get-user:openai-primary:1",
      model,
      now,
      repeat: 1,
      sandbox,
      task: fixture.task,
      taskDirectory: fixture.root
    });

    expect(result.report, JSON.stringify(result.report, null, 2)).toMatchObject({
      score: 1,
      status: "passed",
      metrics: {
        costUsd: 0.000138,
        inputTokens: 100,
        outputTokens: 12,
        ttftMs: 250
      }
    });
    expect(result.artifacts.notes).toContain("Lookup now uses");
    expect(result.artifacts.patchHash).toMatch(/^[a-f0-9]{64}$/);
    expect(result.imageIds).toEqual(["sha256:test-image"]);

    const original = await readFile(join(fixture.root, "workspace", "users.mjs"), "utf8");
    expect(original).toContain("users[id]");
    await expect(access(temporaryWorkspace)).rejects.toThrow();

    expect(adapter.generate).toHaveBeenCalledOnce();
    const generationRequest = vi.mocked(adapter.generate).mock.calls[0]?.[0];
    expect(generationRequest?.fixtureResponseKey).toBe("debug-get-user:final");
    expect(generationRequest?.prompt).not.toContain("must-not-enter-prompt");
  });

  it("writes text answers as evaluator data without treating them as code", async () => {
    const fixture = await taskDirectory("text");
    const sandbox: SandboxRunner = vi.fn(async (_check, context) => {
      const answer = await readFile(
        join(context.workspaceDirectory, ".redactbench", "response.txt"),
        "utf8"
      );
      expect(answer).toBe("The premise is false: 2 + 2 = 4.");
      return {
        durationMs: 5,
        exitCode: 0,
        imageId: "sha256:test-image",
        output: "answer accepted",
        outputLimitExceeded: false,
        timedOut: false
      };
    });

    const result = await runAttempt({
      adapter: provider("The premise is false: 2 + 2 = 4."),
      attemptId: "run:false-premise:openai-primary:1",
      model,
      repeat: 1,
      sandbox,
      task: fixture.task,
      taskDirectory: fixture.root
    });

    expect(result.report.status).toBe("passed");
    expect(result.artifacts.patchHash).toBeNull();
  });

  it("does not invoke the sandbox when git rejects a patch", async () => {
    const fixture = await taskDirectory();
    const invalidPatch = patchEnvelope.replace("return users[id];", "return missing;");
    const sandbox = vi.fn<SandboxRunner>();

    const result = await runAttempt({
      adapter: provider(invalidPatch),
      attemptId: "run:debug-get-user:openai-primary:1",
      model,
      repeat: 1,
      sandbox,
      task: fixture.task,
      taskDirectory: fixture.root
    });

    expect(result.report).toMatchObject({
      error: { code: "PATCH_REJECTED" },
      score: 0,
      status: "error"
    });
    expect(sandbox).not.toHaveBeenCalled();
  });
});
