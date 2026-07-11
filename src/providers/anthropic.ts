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

const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4_194_304;

const EventBaseSchema = z.object({ type: z.string() }).passthrough();
const MessageStartSchema = z
  .object({
    type: z.literal("message_start"),
    message: z
      .object({
        id: z.string(),
        model: z.string(),
        usage: z
          .object({
            cache_read_input_tokens: z.number().int().nonnegative().default(0),
            input_tokens: z.number().int().nonnegative(),
            output_tokens: z.number().int().nonnegative()
          })
          .passthrough()
      })
      .passthrough()
  })
  .passthrough();
const TextDeltaSchema = z
  .object({
    type: z.literal("content_block_delta"),
    delta: z
      .object({
        type: z.literal("text_delta"),
        text: z.string()
      })
      .passthrough()
  })
  .passthrough();
const MessageDeltaSchema = z
  .object({
    type: z.literal("message_delta"),
    usage: z
      .object({ output_tokens: z.number().int().nonnegative() })
      .passthrough()
  })
  .passthrough();
const ErrorEventSchema = z
  .object({
    type: z.literal("error"),
    error: z
      .object({ message: z.string().optional(), type: z.string().optional() })
      .passthrough()
  })
  .passthrough();

function providerError(message: string, cause?: unknown): RedactBenchError {
  return new RedactBenchError(
    "PROVIDER_ERROR",
    `Anthropic: ${redactSensitiveText(message)}`,
    [],
    cause
  );
}

export function createAnthropicAdapter(
  modelConfig: Extract<ModelConfig, { provider: "anthropic" }>,
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
    provider: "anthropic",

    async generate(request: GenerationRequest): Promise<ProviderResult> {
      const apiKey = environment.ANTHROPIC_API_KEY;
      if (!apiKey) {
        throw providerError("ANTHROPIC_API_KEY is not configured");
      }

      const startedAtMs = now();
      const body: Record<string, unknown> = {
        max_tokens: request.maxOutputTokens,
        messages: [{ content: request.prompt, role: "user" }],
        model: modelConfig.model,
        stream: true,
        system: request.system
      };
      const temperature = request.temperature ?? modelConfig.temperature;
      if (temperature !== undefined) {
        body.temperature = temperature;
      }

      let response: Response;
      try {
        response = await fetchImplementation(ANTHROPIC_MESSAGES_URL, {
          body: JSON.stringify(body),
          headers: {
            "anthropic-version": ANTHROPIC_VERSION,
            "content-type": "application/json",
            "x-api-key": apiKey
          },
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        throw providerError("request could not be completed", error);
      }

      await requireOkProviderResponse(response, "Anthropic");

      let firstTextAtMs: number | null = null;
      let providerRequestId: string | null = null;
      let responseModel = modelConfig.model;
      let text = "";
      let usage: ProviderUsage | null = null;

      for await (const sseEvent of readSseEvents(response, {
        maxBytes: maxResponseBytes
      })) {
        let decoded: unknown;
        try {
          decoded = JSON.parse(sseEvent.data);
        } catch (error) {
          throw providerError("received malformed JSON in the event stream", error);
        }

        const baseEvent = EventBaseSchema.safeParse(decoded);
        if (!baseEvent.success) {
          throw providerError("received a malformed event");
        }

        if (baseEvent.data.type === "message_start") {
          const event = MessageStartSchema.safeParse(decoded);
          if (!event.success) {
            throw providerError("received a malformed message_start event");
          }
          providerRequestId = event.data.message.id;
          responseModel = event.data.message.model;
          usage = {
            cachedInputTokens: event.data.message.usage.cache_read_input_tokens,
            inputTokens: event.data.message.usage.input_tokens,
            outputTokens: event.data.message.usage.output_tokens
          };
        } else if (baseEvent.data.type === "content_block_delta") {
          const event = TextDeltaSchema.safeParse(decoded);
          if (!event.success) {
            continue;
          }
          if (event.data.delta.text.length > 0) {
            if (firstTextAtMs === null) {
              firstTextAtMs = now();
            }
            text += event.data.delta.text;
          }
        } else if (baseEvent.data.type === "message_delta") {
          const event = MessageDeltaSchema.safeParse(decoded);
          if (!event.success) {
            throw providerError("received a malformed message_delta event");
          }
          if (usage) {
            usage.outputTokens = event.data.usage.output_tokens;
          }
        } else if (baseEvent.data.type === "error") {
          const event = ErrorEventSchema.safeParse(decoded);
          if (!event.success) {
            throw providerError("request failed with a malformed error event");
          }
          throw providerError(event.data.error.message ?? event.data.error.type ?? "request failed");
        }
      }

      if (firstTextAtMs === null || text.length === 0) {
        throw providerError("stream completed without text output");
      }

      const completedAtMs = now();
      const generationMs = Math.max(0, completedAtMs - firstTextAtMs);
      return {
        model: responseModel,
        provider: "anthropic",
        providerRequestId,
        text,
        timing: {
          completedAt: new Date(completedAtMs).toISOString(),
          durationMs: Math.max(0, completedAtMs - startedAtMs),
          generationMs,
          outputTokensPerSecond:
            usage && generationMs > 0
              ? usage.outputTokens / (generationMs / 1_000)
              : null,
          startedAt: new Date(startedAtMs).toISOString(),
          ttftMs: Math.max(0, firstTextAtMs - startedAtMs)
        },
        usage
      };
    }
  };
}
