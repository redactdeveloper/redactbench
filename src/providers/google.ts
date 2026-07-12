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

const GOOGLE_API_ROOT = "https://generativelanguage.googleapis.com/v1beta/models";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_MAX_RESPONSE_BYTES = 4_194_304;

const GoogleChunkSchema = z
  .object({
    responseId: z.string().min(1).max(300).optional(),
    modelVersion: z.string().min(1).max(160).optional(),
    candidates: z
      .array(
        z
          .object({
            content: z
              .object({
                parts: z.array(z.object({ text: z.string().optional() }).passthrough())
              })
              .passthrough()
              .optional()
          })
          .passthrough()
      )
      .optional(),
    usageMetadata: z
      .object({
        cachedContentTokenCount: z.number().int().nonnegative().default(0),
        candidatesTokenCount: z.number().int().nonnegative(),
        promptTokenCount: z.number().int().nonnegative()
      })
      .passthrough()
      .optional()
  })
  .passthrough();
const GoogleErrorSchema = z
  .object({
    error: z.object({ message: z.string().optional() }).passthrough()
  })
  .passthrough();

function providerError(message: string, cause?: unknown): RedactBenchError {
  return new RedactBenchError(
    "PROVIDER_ERROR",
    `Google: ${redactSensitiveText(message)}`,
    [],
    cause
  );
}

export function createGoogleAdapter(
  modelConfig: Extract<ModelConfig, { provider: "google" }>,
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
    provider: "google",

    async generate(request: GenerationRequest): Promise<ProviderResult> {
      const apiKey = environment.GEMINI_API_KEY;
      if (!apiKey) {
        throw providerError("GEMINI_API_KEY is not configured");
      }

      const startedAtMs = now();
      const generationConfig: Record<string, unknown> = {
        maxOutputTokens: request.maxOutputTokens
      };
      const temperature = request.temperature ?? modelConfig.temperature;
      if (temperature !== undefined) {
        generationConfig.temperature = temperature;
      }
      const body = {
        contents: [{ parts: [{ text: request.prompt }], role: "user" }],
        generationConfig,
        systemInstruction: { parts: [{ text: request.system }] }
      };
      const url = `${GOOGLE_API_ROOT}/${encodeURIComponent(modelConfig.model)}:streamGenerateContent?alt=sse`;

      let response: Response;
      try {
        response = await fetchImplementation(url, {
          body: JSON.stringify(body),
          headers: {
            "content-type": "application/json",
            "x-goog-api-key": apiKey
          },
          method: "POST",
          redirect: "error",
          signal: AbortSignal.timeout(timeoutMs)
        });
      } catch (error) {
        throw providerError("request could not be completed", error);
      }

      await requireOkProviderResponse(response, "Google");

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

        const errorEvent = GoogleErrorSchema.safeParse(decoded);
        if (errorEvent.success) {
          throw providerError(errorEvent.data.error.message ?? "request failed");
        }

        const chunk = GoogleChunkSchema.safeParse(decoded);
        if (!chunk.success) {
          throw providerError("received a malformed response chunk");
        }
        providerRequestId = chunk.data.responseId ?? providerRequestId;
        responseModel = chunk.data.modelVersion ?? responseModel;

        const parts = chunk.data.candidates?.flatMap(
          (candidate) => candidate.content?.parts ?? []
        );
        for (const part of parts ?? []) {
          if (part.text && part.text.length > 0) {
            if (firstTextAtMs === null) {
              firstTextAtMs = now();
            }
            text += part.text;
          }
        }

        if (chunk.data.usageMetadata) {
          usage = {
            cachedInputTokens: chunk.data.usageMetadata.cachedContentTokenCount,
            inputTokens: chunk.data.usageMetadata.promptTokenCount,
            outputTokens: chunk.data.usageMetadata.candidatesTokenCount
          };
        }
      }

      if (firstTextAtMs === null || text.length === 0) {
        throw providerError("stream completed without text output");
      }

      const completedAtMs = now();
      const generationMs = Math.max(0, completedAtMs - firstTextAtMs);
      return {
        model: responseModel,
        provider: "google",
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
