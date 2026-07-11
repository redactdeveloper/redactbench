import { z } from "zod";

import type { ModelConfig } from "../contracts.js";
import { RedactBenchError } from "../errors.js";
import {
  readSseEvents,
  redactSensitiveText,
  requireOkProviderResponse
} from "./sse.js";
import type {
  GenerationRequest,
  ProviderAdapter,
  ProviderDependencies,
  ProviderResult,
  ProviderUsage
} from "./types.js";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4_194_304;

const OpenAiEventBaseSchema = z.object({ type: z.string() }).passthrough();
const OpenAiDeltaSchema = z
  .object({
    type: z.literal("response.output_text.delta"),
    delta: z.string()
  })
  .passthrough();
const OpenAiCreatedSchema = z
  .object({
    type: z.literal("response.created"),
    response: z
      .object({
        id: z.string().optional(),
        model: z.string().optional()
      })
      .passthrough()
  })
  .passthrough();
const OpenAiCompletedSchema = z
  .object({
    type: z.literal("response.completed"),
    response: z
      .object({
        id: z.string().optional(),
        model: z.string().optional(),
        usage: z
          .object({
            input_tokens: z.number().int().nonnegative(),
            output_tokens: z.number().int().nonnegative(),
            input_tokens_details: z
              .object({ cached_tokens: z.number().int().nonnegative().default(0) })
              .passthrough()
              .optional()
          })
          .passthrough()
          .optional()
      })
      .passthrough()
  })
  .passthrough();
const OpenAiErrorSchema = z
  .object({
    type: z.enum(["error", "response.failed"]),
    error: z
      .object({
        message: z.string().optional(),
        type: z.string().optional()
      })
      .passthrough()
      .optional(),
    response: z
      .object({
        error: z
          .object({ message: z.string().optional() })
          .passthrough()
          .optional()
      })
      .passthrough()
      .optional()
  })
  .passthrough();

function providerError(message: string, cause?: unknown): RedactBenchError {
  return new RedactBenchError(
    "PROVIDER_ERROR",
    `OpenAI: ${redactSensitiveText(message)}`,
    [],
    cause
  );
}

function calculateTokensPerSecond(
  usage: ProviderUsage | null,
  generationMs: number
): number | null {
  if (!usage || generationMs <= 0) {
    return null;
  }
  return usage.outputTokens / (generationMs / 1_000);
}

export function createOpenAIAdapter(
  modelConfig: Extract<ModelConfig, { provider: "openai" }>,
  dependencies: ProviderDependencies = {}
): ProviderAdapter {
  const fetchImplementation = dependencies.fetch ?? globalThis.fetch;
  const now = dependencies.now ?? Date.now;
  const environment = dependencies.env ?? process.env;
  const timeoutMs = dependencies.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxResponseBytes =
    dependencies.maxResponseBytes ?? DEFAULT_MAX_RESPONSE_BYTES;

  return {
    model: modelConfig.model,
    provider: "openai",

    async generate(request: GenerationRequest): Promise<ProviderResult> {
      const apiKey = environment.OPENAI_API_KEY;
      if (!apiKey) {
        throw providerError("OPENAI_API_KEY is not configured");
      }

      const startedAtMs = now();
      const body: Record<string, unknown> = {
        input: request.prompt,
        instructions: request.system,
        max_output_tokens: request.maxOutputTokens,
        model: modelConfig.model,
        store: false,
        stream: true
      };
      const temperature = request.temperature ?? modelConfig.temperature;
      if (temperature !== undefined) {
        body.temperature = temperature;
      }

      let response: Response;
      try {
        response = await fetchImplementation(OPENAI_RESPONSES_URL, {
          body: JSON.stringify(body),
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json"
          },
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        throw providerError("request could not be completed", error);
      }

      await requireOkProviderResponse(response, "OpenAI");

      let firstTextAtMs: number | null = null;
      let providerRequestId: string | null = null;
      let responseModel = modelConfig.model;
      let text = "";
      let usage: ProviderUsage | null = null;

      for await (const sseEvent of readSseEvents(response, {
        maxBytes: maxResponseBytes
      })) {
        if (sseEvent.data === "[DONE]") {
          continue;
        }

        let decoded: unknown;
        try {
          decoded = JSON.parse(sseEvent.data);
        } catch (error) {
          throw providerError("received malformed JSON in the event stream", error);
        }

        const baseEvent = OpenAiEventBaseSchema.safeParse(decoded);
        if (!baseEvent.success) {
          throw providerError("received a malformed event");
        }

        if (baseEvent.data.type === "response.output_text.delta") {
          const deltaEvent = OpenAiDeltaSchema.safeParse(decoded);
          if (!deltaEvent.success) {
            throw providerError("received a malformed output_text delta");
          }
          if (deltaEvent.data.delta.length > 0) {
            if (firstTextAtMs === null) {
              firstTextAtMs = now();
            }
            text += deltaEvent.data.delta;
          }
        } else if (baseEvent.data.type === "response.created") {
          const createdEvent = OpenAiCreatedSchema.safeParse(decoded);
          if (!createdEvent.success) {
            throw providerError("received a malformed response.created event");
          }
          providerRequestId = createdEvent.data.response.id ?? providerRequestId;
          responseModel = createdEvent.data.response.model ?? responseModel;
        } else if (baseEvent.data.type === "response.completed") {
          const completedEvent = OpenAiCompletedSchema.safeParse(decoded);
          if (!completedEvent.success) {
            throw providerError("received a malformed response.completed event");
          }
          providerRequestId = completedEvent.data.response.id ?? providerRequestId;
          responseModel = completedEvent.data.response.model ?? responseModel;
          const completedUsage = completedEvent.data.response.usage;
          if (completedUsage) {
            usage = {
              cachedInputTokens:
                completedUsage.input_tokens_details?.cached_tokens ?? 0,
              inputTokens: completedUsage.input_tokens,
              outputTokens: completedUsage.output_tokens
            };
          }
        } else if (
          baseEvent.data.type === "error" ||
          baseEvent.data.type === "response.failed"
        ) {
          const errorEvent = OpenAiErrorSchema.safeParse(decoded);
          if (!errorEvent.success) {
            throw providerError("request failed with a malformed error event");
          }
          const message =
            errorEvent.data.error?.message ??
            errorEvent.data.response?.error?.message ??
            "request failed";
          throw providerError(message);
        }
      }

      if (firstTextAtMs === null || text.length === 0) {
        throw providerError("stream completed without text output");
      }

      const completedAtMs = now();
      const generationMs = Math.max(0, completedAtMs - firstTextAtMs);
      return {
        model: responseModel,
        provider: "openai",
        providerRequestId,
        text,
        timing: {
          completedAt: new Date(completedAtMs).toISOString(),
          durationMs: Math.max(0, completedAtMs - startedAtMs),
          generationMs,
          outputTokensPerSecond: calculateTokensPerSecond(usage, generationMs),
          startedAt: new Date(startedAtMs).toISOString(),
          ttftMs: Math.max(0, firstTextAtMs - startedAtMs)
        },
        usage
      };
    }
  };
}
