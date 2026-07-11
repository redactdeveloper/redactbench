import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { ModelConfigFileSchema, SuiteSchema, TaskSchema } from "../src/contracts.js";
import { Journal } from "../src/journal.js";
import type {
  GenerationRequest,
  ProviderAdapter,
  ProviderResult
} from "../src/providers/index.js";
import { runBenchmark } from "../src/run.js";
import type { SandboxRunner } from "../src/sandbox/docker.js";

function envelope(file: string, before: string, after: string, notes: string) {
  return [
    "<redactbench_patch>",
    `diff --git a/${file} b/${file}`,
    `--- a/${file}`,
    `+++ b/${file}`,
    "@@ -1 +1 @@",
    `-${before}`,
    `+${after}`,
    "</redactbench_patch>",
    "<redactbench_notes>",
    notes,
    "</redactbench_notes>"
  ].join("\n");
}

function result(text: string, requestId: string): ProviderResult {
  return {
    model: "provider-model",
    provider: "openai",
    providerRequestId: requestId,
    text,
    timing: {
      completedAt: "2026-07-12T00:00:01.000Z",
      durationMs: 500,
      generationMs: 400,
      outputTokensPerSecond: 25,
      startedAt: "2026-07-12T00:00:00.500Z",
      ttftMs: 100
    },
    usage: { cachedInputTokens: 0, inputTokens: 20, outputTokens: 10 }
  };
}

describe("context recovery checkpoint resume", () => {
  it("continues at phase 2 after a process interruption following the journal checkpoint", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-recovery-resume-"));
    const taskDirectory = join(root, "task");
    await mkdir(join(taskDirectory, "workspace"), { recursive: true });
    await mkdir(join(taskDirectory, "evaluator"), { recursive: true });
    await writeFile(join(taskDirectory, "workspace", "one.mjs"), "export const one = 0;\n");
    await writeFile(join(taskDirectory, "workspace", "two.mjs"), "export const two = 0;\n");
    const task = TaskSchema.parse({
      schemaVersion: 1,
      id: "recover-two-files",
      title: "Recover two files",
      category: "context-recovery",
      description: "Change one file in each stateless phase.",
      prompt: "Set both exported values to 1.",
      contextRecovery: {
        enabled: true,
        phase1Prompt: "Change the first file and leave notes.",
        phase2Prompt: "Recover and change the second file."
      },
      checks: [
        {
          argv: ["node", "/evaluator/check.mjs"],
          id: "check",
          image: "node:22-alpine"
        }
      ]
    });
    await writeFile(join(taskDirectory, "task.yaml"), JSON.stringify(task));
    const suite = SuiteSchema.parse({
      schemaVersion: 1,
      id: "recovery",
      title: "Recovery",
      tasks: [{ manifest: "task/task.yaml" }]
    });
    const models = ModelConfigFileSchema.parse({
      schemaVersion: 1,
      models: [
        {
          id: "model",
          label: "Model",
          model: "provider-model",
          provider: "openai"
        }
      ]
    });
    const phase1 = envelope(
      "one.mjs",
      "export const one = 0;",
      "export const one = 1;",
      "First file complete; second file remains."
    );
    const phase2 = envelope(
      "two.mjs",
      "export const two = 0;",
      "export const two = 1;",
      "Second file complete; first file preserved."
    );
    const requests: GenerationRequest[] = [];
    const createAdapter = (): ProviderAdapter => ({
      model: "provider-model",
      provider: "openai",
      async generate(request) {
        requests.push(request);
        return request.fixtureResponseKey?.endsWith(":phase1")
          ? result(phase1, "phase-1")
          : result(phase2, "phase-2");
      }
    });
    const sandbox: SandboxRunner = vi.fn(async (_check, context) => {
      expect(await readFile(join(context.workspaceDirectory, "one.mjs"), "utf8")).toContain(
        "one = 1"
      );
      expect(await readFile(join(context.workspaceDirectory, "two.mjs"), "utf8")).toContain(
        "two = 1"
      );
      return {
        durationMs: 1,
        exitCode: 0,
        imageId: "sha256:checkpoint-image",
        output: "passed",
        outputLimitExceeded: false,
        timedOut: false
      };
    });
    const journalFile = join(root, "run", "journal.jsonl");
    let interrupt = true;
    const common = {
      afterRecoveryPhase1() {
        if (interrupt) {
          interrupt = false;
          throw new Error("simulated process interruption");
        }
      },
      createAdapter,
      journalFile,
      modelConfigDirectory: root,
      models,
      repeatCount: 1,
      runId: "run-recovery",
      sandbox,
      suite,
      suiteDirectory: root
    };

    await expect(runBenchmark(common)).rejects.toThrow("simulated process interruption");
    const interruptedJournal = await Journal.open(journalFile);
    const checkpointEvent = interruptedJournal.entries.find(
      (entry) => entry.payload.type === "recovery.phase1.completed"
    );
    expect(checkpointEvent?.payload.type).toBe("recovery.phase1.completed");
    expect(requests.map((request) => request.fixtureResponseKey)).toEqual([
      "recover-two-files:phase1"
    ]);

    const report = await runBenchmark(common);

    expect(requests.map((request) => request.fixtureResponseKey)).toEqual([
      "recover-two-files:phase1",
      "recover-two-files:phase2"
    ]);
    expect(report.attempts[0]).toMatchObject({ score: 1, status: "passed" });
    expect(sandbox).toHaveBeenCalledOnce();
    const finalJournal = await Journal.open(journalFile);
    expect(
      finalJournal.entries.filter(
        (entry) => entry.payload.type === "recovery.phase1.completed"
      )
    ).toHaveLength(1);
    if (checkpointEvent?.payload.type === "recovery.phase1.completed") {
      const checkpointDirectory = resolve(
        dirname(journalFile),
        checkpointEvent.payload.checkpointPath
      );
      await expect(access(checkpointDirectory)).rejects.toThrow();
    }
  });
});
