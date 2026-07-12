import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { Report } from "../contracts.js";
import { ModelConfigFileSchema } from "../contracts.js";
import { loadSuiteDefinition } from "../definition.js";
import { RedactBenchError } from "../errors.js";
import { loadBenchmarkField } from "../field.js";
import { createHarnessAdapter } from "../harness/adapter.js";
import { loadHarnessCatalog } from "../harness/catalog.js";
import {
  inspectHarnessCredentials,
  stageHarnessCredentials,
  type HarnessCredentialReadiness
} from "../harness/credentials.js";
import {
  ensureHarnessImages,
  type HarnessImageReadiness
} from "../harness/images.js";
import {
  ensureHarnessNetworks,
  type HarnessNetworkReadiness
} from "../harness/networks.js";
import { runBenchmark } from "../run.js";
import { reportCommand } from "./report.js";
import { preflightDocker } from "./run.js";

export interface StartCommandOptions {
  concurrency: number;
  dryRun: boolean;
  env: Readonly<Record<string, string | undefined>>;
  fieldFile: string;
  outDirectory: string;
  repeatCount: number;
  runId: string;
  runtimesFile: string;
  seed: number;
  suiteFile: string;
}

export interface StartPlanEntrant {
  harness: string;
  id: string;
  label: string;
  model: string;
  modelArguments: readonly string[];
  provider: string;
}

export interface StartPlan {
  attemptCount: number;
  concurrency: number;
  entrantCount: number;
  entrants: readonly StartPlanEntrant[];
  repeatCount: number;
  runId: string;
  seed: number;
  suiteTitle: string;
  taskCount: number;
}

export interface StartDryRunResult {
  credentials: HarnessCredentialReadiness;
  dryRun: true;
  images: readonly HarnessImageReadiness[];
  networks: readonly HarnessNetworkReadiness[];
  plan: StartPlan;
}

export interface StartCompletedResult {
  dryRun: false;
  plan: StartPlan;
  report: Report;
  reportFile: string;
  runDirectory: string;
}

export type StartCommandResult = StartDryRunResult | StartCompletedResult;

export interface StartCommandDependencies {
  ensureImages?: typeof ensureHarnessImages;
  ensureNetworks?: typeof ensureHarnessNetworks;
  inspectCredentials?: typeof inspectHarnessCredentials;
  now?: () => number;
  packageReport?: typeof reportCommand;
  preflightDocker?: () => Promise<void>;
  runBenchmark?: typeof runBenchmark;
  stageCredentials?: typeof stageHarnessCredentials;
}

function missingCredentialNames(readiness: HarnessCredentialReadiness): string {
  return readiness.checks
    .filter((check) => !check.ready)
    .map((check) => check.name)
    .join(", ");
}

function metric(value: number | null, suffix = ""): string {
  return value === null ? "—" : `${value.toFixed(1)}${suffix}`;
}

function money(value: number | null): string {
  return value === null ? "—" : `$${value.toFixed(value < 0.01 ? 4 : 2)}`;
}

function table(report: Report): string {
  const rows = report.leaderboard.map((entry, index) => [
    String(index + 1),
    entry.label,
    `${(entry.score * 100).toFixed(1)}%`,
    metric(entry.metrics.avgTtftMs === null ? null : entry.metrics.avgTtftMs / 1_000, "s"),
    metric(entry.metrics.outputTokensPerSecond),
    money(entry.metrics.totalCostUsd)
  ]);
  const headers = ["#", "Model", "Score", "TTFT", "Tok/s", "Cost"];
  const widths = headers.map((header, column) =>
    Math.max(header.length, ...rows.map((row) => row[column]?.length ?? 0))
  );
  const render = (row: readonly string[]) =>
    row.map((value, column) => value.padEnd(widths[column] ?? value.length)).join("  ").trimEnd();
  return [render(headers), render(widths.map((width) => "-".repeat(width))), ...rows.map(render)]
    .join("\n");
}

export function formatStartResult(result: StartCommandResult): string {
  const summary = `${result.plan.entrantCount} entrants · ${result.plan.taskCount} tasks · ${result.plan.attemptCount} attempts · R${result.plan.repeatCount} · C${result.plan.concurrency} · seed ${result.plan.seed}`;
  if (result.dryRun) {
    const readyCredentials = result.credentials.checks.filter((check) => check.ready).length;
    const readyImages = result.images.filter((image) => image.status === "ready").length;
    const readyNetworks = result.networks.filter((network) => network.status === "ready").length;
    const missingCredentials = result.credentials.checks
      .filter((check) => !check.ready)
      .map((check) => check.name);
    const missingImages = result.images
      .filter((image) => image.status === "build-required")
      .map((image) => image.image);
    const missingNetworks = result.networks
      .filter((network) => network.status === "create-required")
      .map((network) => network.name);
    return [
      `RedactBench start dry-run: ${summary}`,
      `Credentials: ${readyCredentials}/${result.credentials.checks.length} ready`,
      ...(missingCredentials.length > 0
        ? [`  Missing: ${missingCredentials.join(", ")}`]
        : []),
      `Images: ${readyImages}/${result.images.length} ready`,
      ...(missingImages.length > 0
        ? [`  Will build: ${missingImages.join(", ")}`]
        : []),
      `Networks: ${readyNetworks}/${result.networks.length} ready`,
      ...(missingNetworks.length > 0
        ? [`  Will create: ${missingNetworks.join(", ")}`]
        : []),
      `Run ID: ${result.plan.runId}`,
      "No model or API requests were sent."
    ].join("\n") + "\n";
  }
  return [
    `RedactBench run complete: ${summary}`,
    "",
    table(result.report),
    "",
    `Run ID: ${result.plan.runId}`,
    `Static report: ${result.reportFile}`,
    `Run directory: ${result.runDirectory}`
  ].join("\n") + "\n";
}

export async function startCommand(
  options: StartCommandOptions,
  dependencies: StartCommandDependencies = {}
): Promise<StartCommandResult> {
  const [field, suiteDefinition] = await Promise.all([
    loadBenchmarkField(resolve(options.fieldFile)),
    loadSuiteDefinition(resolve(options.suiteFile))
  ]);
  const catalog = await loadHarnessCatalog(resolve(options.runtimesFile), field);
  const runtimeById = new Map(
    catalog.runtimes.map((entry) => [entry.id, entry.runtime])
  );
  const bindingByEntrant = new Map(
    catalog.bindings.map((binding) => [binding.entrantId, binding])
  );
  const plan: StartPlan = {
    attemptCount:
      field.entrants.length * suiteDefinition.tasks.length * options.repeatCount,
    concurrency: options.concurrency,
    entrantCount: field.entrants.length,
    entrants: field.entrants.map((entrant) => {
      const binding = bindingByEntrant.get(entrant.id)!;
      return {
        harness: entrant.harness,
        id: entrant.id,
        label: entrant.displayName,
        model: binding.model,
        modelArguments: binding.modelArguments,
        provider: entrant.provider
      };
    }),
    repeatCount: options.repeatCount,
    runId: options.runId,
    seed: options.seed,
    suiteTitle: suiteDefinition.suite.title,
    taskCount: suiteDefinition.tasks.length
  };

  await (dependencies.preflightDocker ?? preflightDocker)();
  const inspectCredentials =
    dependencies.inspectCredentials ?? inspectHarnessCredentials;
  const credentials = await inspectCredentials(catalog, options.env);
  if (!options.dryRun && !credentials.ready) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      `harness credentials are not ready: ${missingCredentialNames(credentials)}`
    );
  }

  const ensureImages = dependencies.ensureImages ?? ensureHarnessImages;
  const ensureNetworks = dependencies.ensureNetworks ?? ensureHarnessNetworks;
  const [images, networks] = await Promise.all([
    ensureImages(catalog, { dryRun: options.dryRun }),
    ensureNetworks(catalog, { dryRun: options.dryRun })
  ]);
  if (options.dryRun) {
    return { credentials, dryRun: true, images, networks, plan };
  }

  const stageCredentials =
    dependencies.stageCredentials ?? stageHarnessCredentials;
  const staged = await stageCredentials(credentials);
  const runDirectory = resolve(options.outDirectory, options.runId);
  const journalFile = resolve(runDirectory, "journal.jsonl");
  try {
    await mkdir(runDirectory, { recursive: true });
    const models = ModelConfigFileSchema.parse({
      schemaVersion: 1,
      models: field.entrants.map((entrant) => {
        const binding = bindingByEntrant.get(entrant.id)!;
        return {
          execution: "docker-harness",
          harness: entrant.harness,
          id: entrant.id,
          label: entrant.displayName,
          maxOutputTokens: 32_768,
          model: binding.model,
          provider: entrant.provider
        };
      })
    });
    const benchmark = dependencies.runBenchmark ?? runBenchmark;
    const report = await benchmark({
      concurrency: options.concurrency,
      createAdapter: (model) => {
        const entrant = field.entrants.find((entry) => entry.id === model.id);
        const binding = bindingByEntrant.get(model.id);
        const runtime = binding ? runtimeById.get(binding.runtimeId) : undefined;
        if (!entrant || !binding || !runtime) {
          throw new RedactBenchError(
            "CONFIG_INVALID",
            `missing harness adapter binding for ${model.id}`
          );
        }
        return createHarnessAdapter({
          binding,
          entrant,
          environment: staged.environment,
          runtime,
          secretFiles: staged.secretFiles
        });
      },
      journalFile,
      modelConfigDirectory: dirname(resolve(options.runtimesFile)),
      models,
      repeatCount: options.repeatCount,
      runId: options.runId,
      seed: options.seed,
      suite: suiteDefinition.suite,
      suiteDirectory: suiteDefinition.suiteDirectory
    });
    await Promise.all([
      writeFile(
        resolve(runDirectory, "run.json"),
        `${JSON.stringify(report, null, 2)}\n`,
        { mode: 0o600 }
      ),
      writeFile(
        resolve(runDirectory, "start.json"),
        `${JSON.stringify({ images, networks, plan }, null, 2)}\n`,
        { mode: 0o600 }
      )
    ]);
    const packageReport = dependencies.packageReport ?? reportCommand;
    const packaged = await packageReport(
      journalFile,
      resolve(runDirectory, "report"),
      new Date((dependencies.now ?? Date.now)()).toISOString()
    );
    return {
      dryRun: false,
      plan,
      report,
      reportFile: resolve(dirname(packaged.file), "index.html"),
      runDirectory
    };
  } finally {
    await staged.cleanup();
  }
}
