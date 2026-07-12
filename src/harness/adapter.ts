import { createHash } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { z } from "zod";

import { RedactBenchError } from "../errors.js";
import type { BenchmarkEntrant } from "../field-contracts.js";
import type {
  GenerationRequest,
  ProviderAdapter,
  ProviderResult
} from "../providers/types.js";
import {
  runProcess,
  type ProcessOptions,
  type ProcessResult
} from "../process.js";
import { SCHEMA_VERSION } from "../version.js";
import type { HarnessEntrantBinding } from "./catalog.js";
import {
  buildHarnessDockerArgs,
  type HarnessDockerRuntime
} from "./docker.js";

const HarnessResultSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    text: z.string().max(16_777_216),
    providerRequestId: z.string().min(1).max(300).nullable().default(null),
    ttftMs: z.number().finite().nonnegative().nullable().default(null),
    usage: z
      .object({
        cachedInputTokens: z.number().int().nonnegative().default(0),
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative()
      })
      .strict()
      .nullable()
      .default(null)
  })
  .strict();

type ProcessRunner = (
  argv: readonly [string, ...string[]],
  options: ProcessOptions
) => Promise<ProcessResult>;

export interface HarnessAdapterOptions {
  binding: HarnessEntrantBinding;
  entrant: BenchmarkEntrant;
  environment: Readonly<Record<string, string | undefined>>;
  run?: ProcessRunner;
  runtime: HarnessDockerRuntime;
  secretFiles: Readonly<Record<string, string | undefined>>;
}

function promptForHarness(request: GenerationRequest): string {
  return [
    request.system,
    "",
    request.prompt
  ].join("\n");
}

function safeContainerError(result: ProcessResult): RedactBenchError {
  if (result.timedOut) {
    return new RedactBenchError("PROVIDER_ERROR", "harness container timed out");
  }
  if (result.outputLimitExceeded) {
    return new RedactBenchError(
      "PROVIDER_ERROR",
      "harness container exceeded its output limit"
    );
  }
  if (result.spawnError) {
    return new RedactBenchError("PROVIDER_ERROR", "harness container could not start");
  }
  return new RedactBenchError(
    "PROVIDER_ERROR",
    `harness container exited with code ${result.exitCode ?? "unknown"}`
  );
}

function parseHarnessResult(output: string) {
  try {
    return HarnessResultSchema.parse(JSON.parse(output) as unknown);
  } catch (error) {
    throw new RedactBenchError(
      "PROVIDER_ERROR",
      "harness container returned an invalid result envelope",
      [],
      error
    );
  }
}

export function createHarnessAdapter(
  options: HarnessAdapterOptions
): ProviderAdapter {
  const processRunner = options.run ?? runProcess;
  let sequence = 0;

  return {
    model: options.binding.model,
    provider: options.entrant.provider,
    workspaceMode: true,
    async generate(request): Promise<ProviderResult> {
      if (!request.workspaceDirectory) {
        throw new RedactBenchError(
          "CONFIG_INVALID",
          "Docker harness requires a workspace directory"
        );
      }

      sequence += 1;
      const suffix = createHash("sha256")
        .update(`${options.entrant.id}:${request.requestId ?? "request"}:${sequence}`)
        .digest("hex")
        .slice(0, 12);
      const containerName = `redactbench-${options.entrant.id.slice(0, 35)}-${suffix}`;
      const temporary = await mkdtemp(join(tmpdir(), "redactbench-harness-prompt-"));
      const promptFile = join(temporary, "prompt.txt");
      const prompt = promptForHarness(request);
      await writeFile(promptFile, prompt, { mode: 0o600 });
      const startedAtMs = Date.now();

      try {
        const dockerArgs = await buildHarnessDockerArgs(options.runtime, {
          containerName,
          environment: options.environment,
          model: options.binding.model,
          modelArguments: options.binding.modelArguments,
          promptFile,
          secretFiles: options.secretFiles,
          workspaceDirectory: request.workspaceDirectory
        });
        const result = await processRunner(["docker", ...dockerArgs], {
          maxOutputBytes: options.runtime.maxOutputBytes,
          ...(options.runtime.promptTransport === "stdin" ? { stdin: prompt } : {}),
          timeoutMs: options.runtime.timeoutMs,
          onTerminate: async () => {
            await runProcess(["docker", "rm", "--force", containerName], {
              maxOutputBytes: 4_096,
              timeoutMs: 10_000
            });
          }
        });
        if (
          result.spawnError ||
          result.timedOut ||
          result.outputLimitExceeded ||
          result.exitCode !== 0
        ) {
          throw safeContainerError(result);
        }

        const envelope = parseHarnessResult(result.stdout);
        const completedAtMs = startedAtMs + result.durationMs;
        const generationMs = Math.max(
          0,
          result.durationMs - (envelope.ttftMs ?? 0)
        );
        const outputTokensPerSecond =
          envelope.usage && generationMs > 0
            ? envelope.usage.outputTokens / (generationMs / 1_000)
            : null;
        return {
          model: options.binding.model,
          provider: options.entrant.provider,
          providerRequestId: envelope.providerRequestId,
          text: envelope.text,
          timing: {
            completedAt: new Date(completedAtMs).toISOString(),
            durationMs: result.durationMs,
            generationMs,
            outputTokensPerSecond,
            startedAt: new Date(startedAtMs).toISOString(),
            ttftMs: envelope.ttftMs
          },
          usage: envelope.usage
        };
      } finally {
        await rm(temporary, { force: true, recursive: true });
      }
    }
  };
}
