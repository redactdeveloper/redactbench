#!/usr/bin/env node

import { realpathSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

import { reportCommand } from "./commands/report.js";
import { runCommand } from "./commands/run.js";
import {
  formatRunProgress,
  formatStartResult,
  startCommand,
  type StartCommandOptions,
  type StartCommandResult
} from "./commands/start.js";
import { validateCommand } from "./commands/validate.js";
import { isRedactBenchError, RedactBenchError } from "./errors.js";
import { serveReport } from "./server.js";
import { BENCHMARK_NAME, VERSION } from "./version.js";

interface OutputStream {
  write(chunk: string): unknown;
}

export interface CliDependencies {
  env?: Readonly<Record<string, string | undefined>>;
  now?: () => number;
  preflightDocker?: () => Promise<void>;
  start?: (options: StartCommandOptions) => Promise<StartCommandResult>;
  stderr?: OutputStream;
  stdout?: OutputStream;
}

const HELP = `${BENCHMARK_NAME} ${VERSION}

Usage:
  redactbench start [--dry-run] [options]
  redactbench validate --suite <suite.yaml> --models <models.yaml>
  redactbench run --suite <suite.yaml> --models <models.yaml> [options]
  redactbench report --journal <journal.jsonl> --out <directory>
  redactbench serve --report <directory> [--port 4173]

Run options:
  --run-id <id>          Stable ID; an existing ID resumes its journal
  --out <directory>      Run root (default: runs)
  --task <id>            Include a task; repeat the option for more
  --model <id>           Include a model; repeat the option for more
  --repeat <1..100>      Repetitions per task/model (default: 1)
  --concurrency <1..8>   Concurrent attempts (default: 1)
  --seed <uint32>        Deterministically shuffle attempt order

Start defaults:
  --field benchmarks/target-field.yaml
  --runtimes benchmarks/target-runtimes.yaml
  --suite benchmarks/demo/suite.yaml
  --repeat 1 · --concurrency 1 · --seed 20260712

Global options:
  -h, --help
  -v, --version
`;

const EXIT_CODES: Readonly<Record<string, number>> = {
  CONFIG_INVALID: 2,
  PROVIDER_ERROR: 3,
  SANDBOX_ERROR: 4,
  CHECK_TIMEOUT: 4,
  PATCH_REJECTED: 5,
  JOURNAL_INVALID: 6,
  ATTEMPT_ERROR: 7
};

function requiredString(value: string | undefined, option: string): string {
  if (!value) {
    throw new RedactBenchError("CONFIG_INVALID", `${option} is required`);
  }
  return value;
}

function integerOption(
  value: string | undefined,
  fallback: number,
  label: string,
  minimum: number,
  maximum: number
): number {
  if (value === undefined) {
    return fallback;
  }
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      `${label} must be between ${minimum} and ${maximum}`
    );
  }
  return parsed;
}

function defaultRunId(now: number): string {
  return `run-${new Date(now)
    .toISOString()
    .replaceAll(/[-:]/gu, "")
    .replace(/\.\d{3}Z$/u, "Z")}`;
}

function validateRunId(runId: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/u.test(runId)) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      "run-id must contain only letters, digits, dot, underscore or hyphen"
    );
  }
}

async function handleValidate(args: string[], stdout: OutputStream): Promise<void> {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    options: {
      help: { short: "h", type: "boolean" },
      models: { type: "string" },
      suite: { type: "string" }
    },
    strict: true
  });
  if (values.help) {
    stdout.write(HELP);
    return;
  }
  const definition = await validateCommand(
    requiredString(values.suite, "--suite"),
    requiredString(values.models, "--models")
  );
  const taskWord = definition.tasks.length === 1 ? "task" : "tasks";
  const modelWord = definition.models.models.length === 1 ? "model" : "models";
  stdout.write(
    `Valid: ${definition.tasks.length} ${taskWord} · ${definition.models.models.length} ${modelWord}\n`
  );
}

async function handleRun(
  args: string[],
  dependencies: Required<
    Pick<CliDependencies, "env" | "now" | "stdout">
  > & Pick<CliDependencies, "preflightDocker">
): Promise<void> {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    options: {
      concurrency: { type: "string" },
      help: { short: "h", type: "boolean" },
      model: { multiple: true, type: "string" },
      models: { type: "string" },
      out: { type: "string" },
      repeat: { type: "string" },
      "run-id": { type: "string" },
      seed: { type: "string" },
      suite: { type: "string" },
      task: { multiple: true, type: "string" }
    },
    strict: true
  });
  if (values.help) {
    dependencies.stdout.write(HELP);
    return;
  }

  const concurrency = integerOption(
    values.concurrency,
    1,
    "concurrency",
    1,
    8
  );
  const repeatCount = integerOption(values.repeat, 1, "repeat", 1, 100);
  const seed =
    values.seed === undefined
      ? undefined
      : integerOption(values.seed, 0, "seed", 0, 4_294_967_295);
  const runId = values["run-id"] ?? defaultRunId(dependencies.now());
  validateRunId(runId);

  const result = await runCommand({
    concurrency,
    env: dependencies.env,
    ...(values.model ? { modelIds: values.model } : {}),
    modelsFile: requiredString(values.models, "--models"),
    outDirectory: values.out ?? "runs",
    ...(dependencies.preflightDocker
      ? { preflightDocker: dependencies.preflightDocker }
      : {}),
    repeatCount,
    runId,
    ...(seed === undefined ? {} : { seed }),
    suiteFile: requiredString(values.suite, "--suite"),
    ...(values.task ? { taskIds: values.task } : {})
  });
  dependencies.stdout.write(
    `Run complete: ${result.report.attempts.length} attempts · ${result.runDirectory}\n`
  );
}

async function handleStart(
  args: string[],
  dependencies: Required<Pick<CliDependencies, "env" | "now" | "stdout">> &
    Pick<CliDependencies, "start">
): Promise<void> {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    options: {
      concurrency: { type: "string" },
      "dry-run": { type: "boolean" },
      field: { type: "string" },
      help: { short: "h", type: "boolean" },
      out: { type: "string" },
      repeat: { type: "string" },
      "run-id": { type: "string" },
      runtimes: { type: "string" },
      seed: { type: "string" },
      suite: { type: "string" }
    },
    strict: true
  });
  if (values.help) {
    dependencies.stdout.write(HELP);
    return;
  }
  const runId = values["run-id"] ?? defaultRunId(dependencies.now());
  validateRunId(runId);
  const dryRun = values["dry-run"] ?? false;
  const options: StartCommandOptions = {
    concurrency: integerOption(values.concurrency, 1, "concurrency", 1, 8),
    dryRun,
    env: dependencies.env,
    fieldFile: values.field ?? "benchmarks/target-field.yaml",
    ...(dryRun
      ? {}
      : {
          onProgress: (event) => {
            dependencies.stdout.write(formatRunProgress(event));
          }
        }),
    outDirectory: values.out ?? "runs",
    repeatCount: integerOption(values.repeat, 1, "repeat", 1, 100),
    runId,
    runtimesFile: values.runtimes ?? "benchmarks/target-runtimes.yaml",
    seed: integerOption(values.seed, 20_260_712, "seed", 0, 4_294_967_295),
    suiteFile: values.suite ?? "benchmarks/demo/suite.yaml"
  };
  const result = await (dependencies.start ?? startCommand)(options);
  dependencies.stdout.write(formatStartResult(result));
}

async function handleReport(
  args: string[],
  stdout: OutputStream,
  now: () => number
): Promise<void> {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    options: {
      help: { short: "h", type: "boolean" },
      journal: { type: "string" },
      out: { type: "string" }
    },
    strict: true
  });
  if (values.help) {
    stdout.write(HELP);
    return;
  }
  const journal = requiredString(values.journal, "--journal");
  const output = values.out ?? resolve(journal, "..", "report");
  const result = await reportCommand(
    journal,
    output,
    new Date(now()).toISOString()
  );
  stdout.write(`Report written: ${result.file}\n`);
}

async function handleServe(args: string[], stdout: OutputStream): Promise<void> {
  const { values } = parseArgs({
    args,
    allowPositionals: false,
    options: {
      help: { short: "h", type: "boolean" },
      port: { type: "string" },
      report: { type: "string" }
    },
    strict: true
  });
  if (values.help) {
    stdout.write(HELP);
    return;
  }
  const port = integerOption(values.port, 4_173, "port", 0, 65_535);
  const served = await serveReport(
    requiredString(values.report, "--report"),
    port
  );
  stdout.write(`Report server: ${served.url}\n`);
}

export async function main(
  argv: string[] = process.argv.slice(2),
  dependencies: CliDependencies = {}
): Promise<number> {
  const stdout = dependencies.stdout ?? process.stdout;
  const stderr = dependencies.stderr ?? process.stderr;
  const env = dependencies.env ?? process.env;
  const now = dependencies.now ?? Date.now;

  try {
    if (argv.length === 0 || argv[0] === "--help" || argv[0] === "-h") {
      stdout.write(HELP);
      return 0;
    }
    if (argv[0] === "--version" || argv[0] === "-v") {
      stdout.write(`${VERSION}\n`);
      return 0;
    }

    const [command, ...args] = argv;
    switch (command) {
      case "start":
        await handleStart(args, {
          env,
          now,
          stdout,
          ...(dependencies.start ? { start: dependencies.start } : {})
        });
        break;
      case "validate":
        await handleValidate(args, stdout);
        break;
      case "run":
        await handleRun(args, {
          env,
          now,
          stdout,
          ...(dependencies.preflightDocker
            ? { preflightDocker: dependencies.preflightDocker }
            : {})
        });
        break;
      case "report":
        await handleReport(args, stdout, now);
        break;
      case "serve":
        await handleServe(args, stdout);
        break;
      default:
        throw new RedactBenchError(
          "CONFIG_INVALID",
          `unknown command: ${command ?? ""}`
        );
    }
    return 0;
  } catch (error) {
    const safeError = isRedactBenchError(error)
      ? error
      : new RedactBenchError(
          "CONFIG_INVALID",
          error instanceof Error ? `invalid CLI arguments: ${error.message}` : "invalid CLI arguments"
        );
    stderr.write(`${safeError.code}: ${safeError.message}\n`);
    return EXIT_CODES[safeError.code] ?? 1;
  }
}

export function isMainModule(
  moduleUrl: string,
  entrypoint: string | undefined
): boolean {
  if (!entrypoint) return false;
  try {
    return (
      realpathSync(fileURLToPath(moduleUrl)) ===
      realpathSync(resolve(entrypoint))
    );
  } catch {
    return false;
  }
}

if (isMainModule(import.meta.url, process.argv[1])) {
  void main().then((exitCode) => {
    process.exitCode = exitCode;
  });
}
