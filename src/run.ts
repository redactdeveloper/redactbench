import { createHash } from "node:crypto";
import { cp, mkdir, rm } from "node:fs/promises";
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
import {
  runContextRecoveryAttempt,
  type RecoveryPhase1Checkpoint
} from "./context-recovery.js";
import { RedactBenchError } from "./errors.js";
import {
  completedAttemptIds,
  Journal,
  type JournalPayload
} from "./journal.js";
import { createProviderAdapter, type ProviderAdapter } from "./providers/index.js";
import type { SandboxRunner } from "./sandbox/docker.js";
import { stableStringify } from "./stable-json.js";
import { resolveContainedPath, resolveContainedRealPath } from "./workspace.js";

interface TaskBundle {
  directory: string;
  task: Task;
  weight: number;
}

type AttemptExecutor = (input: RunAttemptInput) => Promise<AttemptOutcome>;

export interface RunBenchmarkInput {
  afterRecoveryPhase1?: (attemptId: string) => Promise<void> | void;
  concurrency?: number;
  createAdapter?: (model: ModelConfig) => ProviderAdapter;
  executeAttempt?: AttemptExecutor;
  journalFile: string;
  modelConfigDirectory: string;
  models: ModelConfigFile;
  now?: () => number;
  repeatCount: number;
  runId: string;
  sandbox?: SandboxRunner;
  seed?: number;
  suite: Suite;
  suiteDirectory: string;
}

type RecoveryPhase1Payload = Extract<
  JournalPayload,
  { type: "recovery.phase1.completed" }
>;

async function loadTasks(suite: Suite, suiteDirectory: string): Promise<TaskBundle[]> {
  const bundles: TaskBundle[] = [];
  const ids = new Set<string>();
  for (const suiteTask of suite.tasks) {
    const manifest = await resolveContainedRealPath(
      suiteDirectory,
      suiteTask.manifest
    );
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
  repeatCount: number,
  concurrency: number,
  seed: number | undefined
): string {
  return createHash("sha256")
    .update(
      stableStringify({
        models,
        concurrency,
        repeatCount,
        seed: seed ?? null,
        suite,
        tasks: tasks.map((bundle) => ({ task: bundle.task, weight: bundle.weight }))
      })
    )
    .digest("hex");
}

interface AttemptJob {
  bundle: TaskBundle;
  model: ModelConfig;
  repeat: number;
}

function shuffledJobs(jobs: AttemptJob[], seed: number | undefined): AttemptJob[] {
  if (seed === undefined) {
    return jobs;
  }
  let state = seed >>> 0;
  const random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
  for (let index = jobs.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [jobs[index], jobs[other]] = [jobs[other]!, jobs[index]!];
  }
  return jobs;
}

export async function runBenchmark(input: RunBenchmarkInput): Promise<Report> {
  if (!Number.isInteger(input.repeatCount) || input.repeatCount < 1 || input.repeatCount > 100) {
    throw new RedactBenchError("CONFIG_INVALID", "repeatCount must be between 1 and 100");
  }
  const concurrency = input.concurrency ?? 1;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      "concurrency must be between 1 and 8"
    );
  }
  if (
    input.seed !== undefined &&
    (!Number.isInteger(input.seed) || input.seed < 0 || input.seed > 4_294_967_295)
  ) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      "seed must be an integer between 0 and 4294967295"
    );
  }

  const now = input.now ?? Date.now;
  const tasks = await loadTasks(input.suite, resolve(input.suiteDirectory));
  const configHash = configurationHash(
    input.suite,
    tasks,
    input.models,
    input.repeatCount,
    concurrency,
    input.seed
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
        concurrency,
        ...(input.seed === undefined ? {} : { seed: input.seed }),
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
  const runDirectory = dirname(resolve(input.journalFile));
  const recoveryStates = new Map<string, RecoveryPhase1Payload>();
  for (const entry of journal.entries) {
    if (entry.payload.type === "recovery.phase1.completed") {
      recoveryStates.set(entry.payload.attemptId, entry.payload);
    }
  }
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

  const persistRecoveryPhase1 = async (
    attemptId: string,
    checkpoint: RecoveryPhase1Checkpoint
  ) => {
    const checkpointPath = `recovery/${createHash("sha256")
      .update(attemptId)
      .digest("hex")}`;
    const checkpointDirectory = resolveContainedPath(runDirectory, checkpointPath);
    await rm(checkpointDirectory, { force: true, recursive: true });
    await mkdir(dirname(checkpointDirectory), { recursive: true });
    await cp(checkpoint.workspaceDirectory, checkpointDirectory, {
      errorOnExist: true,
      force: false,
      recursive: true
    });
    const payload: RecoveryPhase1Payload = {
      type: "recovery.phase1.completed",
      attemptId,
      checkpointPath,
      state: {
        commitSha: checkpoint.commitSha,
        notes: checkpoint.notes,
        patch: checkpoint.patch,
        patchHash: checkpoint.patchHash,
        promptHash: checkpoint.promptHash,
        providerResult: checkpoint.providerResult,
        responseHash: checkpoint.responseHash,
        snapshotHash: checkpoint.snapshotHash
      }
    };
    await journal.append(payload);
    recoveryStates.set(attemptId, payload);
    await input.afterRecoveryPhase1?.(attemptId);
  };

  const executeAttempt: AttemptExecutor =
    input.executeAttempt ??
    (async (attemptInput: RunAttemptInput) => {
      if (attemptInput.task.category !== "context-recovery") {
        return runAttempt(attemptInput);
      }
      const checkpoint = recoveryStates.get(attemptInput.attemptId);
      if (checkpoint) {
        return runContextRecoveryAttempt({
          ...attemptInput,
          phase1State: {
            ...checkpoint.state,
            checkpointDirectory: await resolveContainedRealPath(
              runDirectory,
              checkpoint.checkpointPath
            )
          }
        });
      }
      return runContextRecoveryAttempt({
        ...attemptInput,
        onPhase1Complete: (phase1) =>
          persistRecoveryPhase1(attemptInput.attemptId, phase1)
      });
    });
  const adapterFactory =
    input.createAdapter ??
    ((model: ModelConfig) =>
      createProviderAdapter(model, {
        fixtureBaseDirectory: resolve(input.modelConfigDirectory)
      }));
  const adapters = new Map<string, ProviderAdapter>();
  const jobs: AttemptJob[] = [];
  for (const bundle of tasks) {
    for (const model of input.models.models) {
      for (let repeat = 1; repeat <= input.repeatCount; repeat += 1) {
        const attemptId = `${input.runId}:${bundle.task.id}:${model.id}:${repeat}`;
        if (!completed.has(attemptId)) {
          jobs.push({ bundle, model, repeat });
        }
      }
    }
  }
  shuffledJobs(jobs, input.seed);
  let nextJob = 0;

  const worker = async () => {
    while (nextJob < jobs.length) {
      const job = jobs[nextJob];
      nextJob += 1;
      if (!job) {
        return;
      }
      const { bundle, model, repeat } = job;
      const attemptId = `${input.runId}:${bundle.task.id}:${model.id}:${repeat}`;
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
        ...(input.sandbox ? { sandbox: input.sandbox } : {}),
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
      const recoveryState = recoveryStates.get(attemptId);
      if (recoveryState) {
        await rm(
          resolveContainedPath(runDirectory, recoveryState.checkpointPath),
          { force: true, recursive: true }
        );
      }
      completed.add(attemptId);
    }
  };
  await Promise.all(Array.from({ length: concurrency }, () => worker()));

  if (!alreadyMarkedComplete) {
    await journal.append({
      type: "run.completed",
      completedAt: new Date(now()).toISOString(),
      runId: input.runId
    });
  }

  return aggregateJournal(journal.entries, new Date(now()).toISOString());
}
