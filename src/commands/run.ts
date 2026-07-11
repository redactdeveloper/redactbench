import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type { ModelConfigFile, Report } from "../contracts.js";
import {
  filterBenchmarkDefinition,
  loadBenchmarkDefinition
} from "../definition.js";
import { RedactBenchError } from "../errors.js";
import { runProcess } from "../process.js";
import { createProviderAdapter } from "../providers/index.js";
import { runBenchmark } from "../run.js";

export interface RunCommandOptions {
  concurrency: number;
  env: Readonly<Record<string, string | undefined>>;
  modelIds?: readonly string[];
  modelsFile: string;
  outDirectory: string;
  preflightDocker?: () => Promise<void>;
  repeatCount: number;
  runId: string;
  seed?: number;
  suiteFile: string;
  taskIds?: readonly string[];
}

export interface RunCommandResult {
  report: Report;
  runDirectory: string;
}

function requireProviderCredentials(
  models: ModelConfigFile,
  env: Readonly<Record<string, string | undefined>>
): void {
  const requirements = {
    openai: "OPENAI_API_KEY",
    anthropic: "ANTHROPIC_API_KEY",
    google: "GEMINI_API_KEY"
  } as const;
  for (const model of models.models) {
    if (model.provider === "fixture") {
      continue;
    }
    const keyName = requirements[model.provider];
    if (!env[keyName]) {
      throw new RedactBenchError(
        "PROVIDER_ERROR",
        `${keyName} is required for model ${model.id}`
      );
    }
  }
}

export async function preflightDocker(): Promise<void> {
  const result = await runProcess(
    ["docker", "info", "--format={{.ServerVersion}}"],
    { maxOutputBytes: 8_192, timeoutMs: 15_000 }
  );
  if (result.spawnError || result.timedOut || result.exitCode !== 0) {
    throw new RedactBenchError(
      "SANDBOX_ERROR",
      "Docker daemon is unavailable; no model requests were sent"
    );
  }
}

export async function runCommand(
  options: RunCommandOptions
): Promise<RunCommandResult> {
  const loaded = await loadBenchmarkDefinition(options.suiteFile, options.modelsFile);
  const definition = filterBenchmarkDefinition(loaded, {
    ...(options.modelIds ? { modelIds: options.modelIds } : {}),
    ...(options.taskIds ? { taskIds: options.taskIds } : {})
  });
  requireProviderCredentials(definition.models, options.env);
  await (options.preflightDocker ?? preflightDocker)();

  const runDirectory = resolve(options.outDirectory, options.runId);
  await mkdir(runDirectory, { recursive: true });
  const report = await runBenchmark({
    concurrency: options.concurrency,
    createAdapter: (model) =>
      createProviderAdapter(model, {
        env: options.env,
        fixtureBaseDirectory: definition.modelConfigDirectory
      }),
    journalFile: resolve(runDirectory, "journal.jsonl"),
    modelConfigDirectory: definition.modelConfigDirectory,
    models: definition.models,
    repeatCount: options.repeatCount,
    runId: options.runId,
    ...(options.seed === undefined ? {} : { seed: options.seed }),
    suite: definition.suite,
    suiteDirectory: definition.suiteDirectory
  });
  await writeFile(
    resolve(runDirectory, "run.json"),
    `${JSON.stringify(report, null, 2)}\n`,
    { mode: 0o600 }
  );
  return { report, runDirectory };
}
