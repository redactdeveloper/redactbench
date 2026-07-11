import { createHash } from "node:crypto";
import { dirname, resolve } from "node:path";

import type { AttemptOutcome, RunAttemptInput } from "./attempt.js";
import { runAttempt } from "./attempt.js";
import { aggregateJournal } from "./aggregate.js";
import { loadYamlConfig } from "./config.js";
import type {
  ModelConfig,
  ModelConfigFile,
  Report,
  Suite,
  Task
} from "./contracts.js";
import { TaskSchema } from "./contracts.js";
import { RedactBenchError } from "./errors.js";
import { completedAttemptIds, Journal } from "./journal.js";
import { createProviderAdapter, type ProviderAdapter } from "./providers/index.js";
import { stableStringify } from "./stable-json.js";
import { resolveContainedPath } from "./workspace.js";

interface TaskBundle {
  directory: string;
  task: Task;
  weight: number;
}

type AttemptExecutor = (input: RunAttemptInput) => Promise<AttemptOutcome>;

export interface RunBenchmarkInput {
  createAdapter?: (model: ModelConfig) => ProviderAdapter;
  executeAttempt?: AttemptExecutor;
  journalFile: string;
  modelConfigDirectory: string;
  models: ModelConfigFile;
  now?: () => number;
  repeatCount: number;
  runId: string;
  suite: Suite;
  suiteDirectory: string;
}

async function loadTasks(suite: Suite, suiteDirectory: string): Promise<TaskBundle[]> {
  const bundles: TaskBundle[] = [];
  const ids = new Set<string>();
  for (const suiteTask of suite.tasks) {
    const manifest = resolveContainedPath(suiteDirectory, suiteTask.manifest);
    const task = await loadYamlConfig(manifest, TaskSchema);
    if (ids.has(task.id)) {
      throw new RedactBenchError(
        "CONFIG_INVALID",
        `suite contains duplicate task id: ${task.id}`
      );
    }
    ids.add(task.id);
    bundles.push({ directory: dirname(manifest), task, weight: suiteTask.weight });
  }
  return bundles;
}

function configurationHash(
  suite: Suite,
  tasks: readonly TaskBundle[],
  models: ModelConfigFile,
  repeatCount: number
): string {
  return createHash("sha256")
    .update(
      stableStringify({
        models,
        repeatCount,
        suite,
        tasks: tasks.map((bundle) => ({ task: bundle.task, weight: bundle.weight }))
      })
    )
    .digest("hex");
}

export async function runBenchmark(input: RunBenchmarkInput): Promise<Report> {
  if (!Number.isInteger(input.repeatCount) || input.repeatCount < 1 || input.repeatCount > 100) {
    throw new RedactBenchError("CONFIG_INVALID", "repeatCount must be between 1 and 100");
  }

  const now = input.now ?? Date.now;
  const tasks = await loadTasks(input.suite, resolve(input.suiteDirectory));
  const configHash = configurationHash(
    input.suite,
    tasks,
    input.models,
    input.repeatCount
  );
  const journal = await Journal.open(input.journalFile);
  const existingStarts = journal.entries.filter(
    (entry) => entry.payload.type === "run.started"
  );

  if (existingStarts.length === 0) {
    await journal.append({
      type: "run.started",
      configHash,
      run: {
        id: input.runId,
        title: input.suite.title,
        suiteId: input.suite.id,
        scorerVersion: input.suite.scorerVersion,
        startedAt: new Date(now()).toISOString(),
        repeatCount: input.repeatCount,
        models: input.models.models.map((model) => ({
          id: model.id,
          label: model.label,
          model: model.model,
          provider: model.provider
        })),
        tasks: tasks.map((bundle) => ({
          category: bundle.task.category,
          id: bundle.task.id,
          title: bundle.task.title,
          weight: bundle.weight
        }))
      }
    });
  } else {
    const start = existingStarts[0];
    if (
      existingStarts.length !== 1 ||
      start?.payload.type !== "run.started" ||
      start.payload.configHash !== configHash ||
      start.payload.run.id !== input.runId
    ) {
      throw new RedactBenchError(
        "JOURNAL_INVALID",
        "resume configuration does not match the existing run"
      );
    }
  }

  const completed = completedAttemptIds(journal.entries);
  const expectedAttemptIds = new Set<string>();
  for (const bundle of tasks) {
    for (const model of input.models.models) {
      for (let repeat = 1; repeat <= input.repeatCount; repeat += 1) {
        expectedAttemptIds.add(`${input.runId}:${bundle.task.id}:${model.id}:${repeat}`);
      }
    }
  }
  const alreadyMarkedComplete = journal.entries.some(
    (entry) => entry.payload.type === "run.completed"
  );
  if (
    alreadyMarkedComplete &&
    [...expectedAttemptIds].some((attemptId) => !completed.has(attemptId))
  ) {
    throw new RedactBenchError(
      "JOURNAL_INVALID",
      "run.completed exists before every expected attempt is recorded"
    );
  }

  const executeAttempt = input.executeAttempt ?? runAttempt;
  const adapterFactory =
    input.createAdapter ??
    ((model: ModelConfig) =>
      createProviderAdapter(model, {
        fixtureBaseDirectory: resolve(input.modelConfigDirectory)
      }));
  const adapters = new Map<string, ProviderAdapter>();

  for (const bundle of tasks) {
    for (const model of input.models.models) {
      for (let repeat = 1; repeat <= input.repeatCount; repeat += 1) {
        const attemptId = `${input.runId}:${bundle.task.id}:${model.id}:${repeat}`;
        if (completed.has(attemptId)) {
          continue;
        }
        let adapter = adapters.get(model.id);
        if (!adapter) {
          adapter = adapterFactory(model);
          adapters.set(model.id, adapter);
        }
        const outcome = await executeAttempt({
          adapter,
          attemptId,
          model,
          repeat,
          task: bundle.task,
          taskDirectory: bundle.directory
        });
        if (outcome.report.attemptId !== attemptId) {
          throw new RedactBenchError(
            "JOURNAL_INVALID",
            `attempt returned an unexpected id: ${outcome.report.attemptId}`
          );
        }
        await journal.append({
          type: "attempt.completed",
          artifacts: outcome.artifacts,
          imageIds: outcome.imageIds,
          report: outcome.report,
          taskWeight: bundle.weight
        });
        completed.add(attemptId);
      }
    }
  }

  if (!alreadyMarkedComplete) {
    await journal.append({
      type: "run.completed",
      completedAt: new Date(now()).toISOString(),
      runId: input.runId
    });
  }

  return aggregateJournal(journal.entries, new Date(now()).toISOString());
}
