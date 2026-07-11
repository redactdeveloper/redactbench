import { resolve, sep } from "node:path";

import { z } from "zod";

import { loadYamlConfig } from "../config.js";
import type { ModelConfig } from "../contracts.js";
import { RedactBenchError } from "../errors.js";
import type {
  GenerationRequest,
  ProviderAdapter,
  ProviderDependencies,
  ProviderResult
} from "./types.js";

const FixtureResponseSchema = z
  .object({
    cachedInputTokens: z.number().int().nonnegative().default(0),
    durationMs: z.number().finite().nonnegative(),
    inputTokens: z.number().int().nonnegative(),
    outputTokens: z.number().int().nonnegative(),
    text: z.string().min(1).max(1_048_576),
    ttftMs: z.number().finite().nonnegative()
  })
  .strict()
  .refine((response) => response.ttftMs <= response.durationMs, {
    message: "ttftMs must not exceed durationMs"
  });

const FixtureFileSchema = z
  .object({
    schemaVersion: z.literal(1),
    responses: z.record(z.string().min(1).max(240), FixtureResponseSchema)
  })
  .strict();

interface FixtureDependencies extends ProviderDependencies {
  baseDirectory: string;
}

function providerError(message: string, cause?: unknown): RedactBenchError {
  return new RedactBenchError("PROVIDER_ERROR", `Fixture: ${message}`, [], cause);
}

export function createFixtureAdapter(
  modelConfig: Extract<ModelConfig, { provider: "fixture" }>,
  dependencies: FixtureDependencies
): ProviderAdapter {
  const now = dependencies.now ?? Date.now;
  const baseDirectory = resolve(dependencies.baseDirectory);
  const fixturePath = resolve(baseDirectory, modelConfig.fixtureFile);
  if (fixturePath !== baseDirectory && !fixturePath.startsWith(`${baseDirectory}${sep}`)) {
    throw providerError("fixture file escapes its configured base directory");
  }

  let fixturePromise: Promise<z.infer<typeof FixtureFileSchema>> | null = null;

  return {
    model: modelConfig.model,
    provider: "fixture",

    async generate(request: GenerationRequest): Promise<ProviderResult> {
      if (!request.fixtureResponseKey) {
        throw providerError("fixtureResponseKey is required");
      }

      fixturePromise ??= loadYamlConfig(fixturePath, FixtureFileSchema);
      const fixture = await fixturePromise;
      const response = fixture.responses[request.fixtureResponseKey];
      if (!response) {
        throw providerError(`no response configured for ${request.fixtureResponseKey}`);
      }

      const startedAtMs = now();
      const completedAtMs = startedAtMs + response.durationMs;
      const generationMs = response.durationMs - response.ttftMs;
      return {
        model: modelConfig.model,
        provider: "fixture",
        providerRequestId: `fixture:${request.fixtureResponseKey}`,
        text: response.text,
        timing: {
          completedAt: new Date(completedAtMs).toISOString(),
          durationMs: response.durationMs,
          generationMs,
          outputTokensPerSecond:
            generationMs > 0
              ? response.outputTokens / (generationMs / 1_000)
              : null,
          startedAt: new Date(startedAtMs).toISOString(),
          ttftMs: response.ttftMs
        },
        usage: {
          cachedInputTokens: response.cachedInputTokens,
          inputTokens: response.inputTokens,
          outputTokens: response.outputTokens
        }
      };
    }
  };
}
