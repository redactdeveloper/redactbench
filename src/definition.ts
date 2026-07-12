import { stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { loadYamlConfig } from "./config.js";
import type { ModelConfigFile, Suite, Task } from "./contracts.js";
import {
  ModelConfigFileSchema,
  ModelConfigFileSchema as ModelsSchema,
  SuiteSchema,
  TaskSchema
} from "./contracts.js";
import { RedactBenchError } from "./errors.js";
import { FixtureFileSchema } from "./providers/fixture.js";
import { resolveContainedPath, resolveContainedRealPath } from "./workspace.js";

export interface LoadedTask {
  directory: string;
  manifest: string;
  task: Task;
  weight: number;
}

export interface BenchmarkDefinition {
  modelConfigDirectory: string;
  models: ModelConfigFile;
  modelsFile: string;
  suite: Suite;
  suiteDirectory: string;
  suiteFile: string;
  tasks: LoadedTask[];
}

async function requireDirectory(path: string, label: string): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) {
      throw new Error("not a directory");
    }
  } catch (error) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      `${label} directory is missing: ${path}`,
      [],
      error
    );
  }
}

export async function loadBenchmarkDefinition(
  suiteFileInput: string,
  modelsFileInput: string
): Promise<BenchmarkDefinition> {
  const suiteFile = resolve(suiteFileInput);
  const modelsFile = resolve(modelsFileInput);
  const suiteDirectory = dirname(suiteFile);
  const modelConfigDirectory = dirname(modelsFile);
  const [suite, models] = await Promise.all([
    loadYamlConfig(suiteFile, SuiteSchema),
    loadYamlConfig(modelsFile, ModelsSchema)
  ]);
  const tasks: LoadedTask[] = [];
  const taskIds = new Set<string>();

  for (const suiteTask of suite.tasks) {
    const manifest = resolveContainedPath(suiteDirectory, suiteTask.manifest);
    const realManifest = await resolveContainedRealPath(
      suiteDirectory,
      suiteTask.manifest
    );
    const task = await loadYamlConfig(realManifest, TaskSchema);
    if (taskIds.has(task.id)) {
      throw new RedactBenchError(
        "CONFIG_INVALID",
        `suite contains duplicate task id: ${task.id}`
      );
    }
    taskIds.add(task.id);
    const directory = dirname(realManifest);
    await requireDirectory(
      await resolveContainedRealPath(directory, task.workspace),
      `${task.id} workspace`
    );
    await requireDirectory(
      await resolveContainedRealPath(directory, task.evaluator),
      `${task.id} evaluator`
    );
    tasks.push({ directory, manifest, task, weight: suiteTask.weight });
  }

  for (const model of models.models) {
    if (model.provider === "fixture") {
      const fixtureFile = await resolveContainedRealPath(
        modelConfigDirectory,
        model.fixtureFile
      );
      await loadYamlConfig(fixtureFile, FixtureFileSchema);
    }
  }

  return {
    modelConfigDirectory,
    models,
    modelsFile,
    suite,
    suiteDirectory,
    suiteFile,
    tasks
  };
}

function requestedSet(values: readonly string[] | undefined): Set<string> | null {
  return values && values.length > 0 ? new Set(values) : null;
}

export function filterBenchmarkDefinition(
  definition: BenchmarkDefinition,
  filters: { modelIds?: readonly string[]; taskIds?: readonly string[] }
): BenchmarkDefinition {
  const requestedTasks = requestedSet(filters.taskIds);
  const requestedModels = requestedSet(filters.modelIds);
  const tasks = requestedTasks
    ? definition.tasks.filter((entry) => requestedTasks.has(entry.task.id))
    : definition.tasks;
  const models = requestedModels
    ? definition.models.models.filter((model) => requestedModels.has(model.id))
    : definition.models.models;

  if (requestedTasks) {
    const missing = [...requestedTasks].filter(
      (id) => !definition.tasks.some((entry) => entry.task.id === id)
    );
    if (missing.length > 0) {
      throw new RedactBenchError(
        "CONFIG_INVALID",
        `unknown task filter: ${missing.join(", ")}`
      );
    }
  }
  if (requestedModels) {
    const missing = [...requestedModels].filter(
      (id) => !definition.models.models.some((model) => model.id === id)
    );
    if (missing.length > 0) {
      throw new RedactBenchError(
        "CONFIG_INVALID",
        `unknown model filter: ${missing.join(", ")}`
      );
    }
  }

  const selectedManifests = new Set(tasks.map((entry) => entry.manifest));
  const suite = SuiteSchema.parse({
    ...definition.suite,
    tasks: definition.suite.tasks.filter((suiteTask) =>
      selectedManifests.has(
        resolveContainedPath(definition.suiteDirectory, suiteTask.manifest)
      )
    )
  });

  return {
    ...definition,
    models: ModelConfigFileSchema.parse({
      schemaVersion: 1,
      models
    }),
    suite,
    tasks
  };
}
