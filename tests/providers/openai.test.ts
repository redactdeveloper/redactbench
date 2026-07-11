import { describe, expect, it, vi } from "vitest";

import type { ModelConfig } from "../../src/contracts.js";
import { RedactBenchError } from "../../src/errors.js";
import { createOpenAIAdapter } from "../../src/providers/openai.js";

const modelConfig: ModelConfig = {
  id: "openai-primary",
  label: "OpenAI Primary",
  maxOutputTokens: 4_096,
  model: "gpt-example",
  provider: "openai"
};

function openAiStream(events: unknown[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    }),
    {
      headers: { "content-type": "text/event-stream" },
      status: 200
    }
  );
}

describe("createOpenAIAdapter", () => {
  it("streams text directly from Responses API and measures TTFT and usage", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      openAiStream([
        {
          type: "response.created",
          response: { id: "resp_123", model: "gpt-example" }
        },
        { type: "response.in_progress", sequence_number: 2 },
        { type: "response.output_text.delta", delta: "Hello" },
        { type: "response.output_text.delta", delta: " world" },
        {
          type: "response.completed",
          response: {
            id: "resp_123",
            model: "gpt-example",
            usage: {
              input_tokens: 25,
              input_tokens_details: { cached_tokens: 5 },
              output_tokens: 10,
              total_tokens: 35
            }
          }
        }
      ])
    );
    const now = vi.fn().mockReturnValueOnce(1_000).mockReturnValueOnce(1_250).mockReturnValueOnce(2_000);
    const adapter = createOpenAIAdapter(modelConfig, {
      env: { OPENAI_API_KEY: "test-key" },
      fetch: fetchMock,
      now
    });

    const result = await adapter.generate({
      maxOutputTokens: 1_024,
      prompt: "Fix the code.",
      system: "You are participating in a deterministic benchmark."
    });

    expect(result).toMatchObject({
      model: "gpt-example",
      provider: "openai",
      providerRequestId: "resp_123",
      text: "Hello world",
      timing: {
        durationMs: 1_000,
        generationMs: 750,
        ttftMs: 250
      },
      usage: {
        cachedInputTokens: 5,
        inputTokens: 25,
        outputTokens: 10
      }
    });
    expect(result.timing.outputTokensPerSecond).toBeCloseTo(13.333, 3);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.openai.com/v1/responses");
    expect(init?.method).toBe("POST");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer test-key");
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      input: "Fix the code.",
      instructions: "You are participating in a deterministic benchmark.",
      max_output_tokens: 1_024,
      model: "gpt-example",
      store: false,
      stream: true
    });
    expect(body).not.toHaveProperty("temperature");
  });

  it("fails before fetch when OPENAI_API_KEY is absent", async () => {
    const fetchMock = vi.fn<typeof fetch>();
    const adapter = createOpenAIAdapter(modelConfig, {
      env: {},
      fetch: fetchMock
    });

    await expect(
      adapter.generate({ maxOutputTokens: 1_024, prompt: "x", system: "y" })
    ).rejects.toMatchObject({
      code: "PROVIDER_ERROR"
    } satisfies Partial<RedactBenchError>);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("turns streamed API errors into redacted stable errors", async () => {
    const adapter = createOpenAIAdapter(modelConfig, {
      env: { OPENAI_API_KEY: "test-key" },
      fetch: vi.fn<typeof fetch>().mockResolvedValue(
        openAiStream([
          {
            type: "error",
            error: {
              message: "request rejected for sk-example-secret-value",
              type: "invalid_request_error"
            }
          }
        ])
      )
    });

    await expect(
      adapter.generate({ maxOutputTokens: 1_024, prompt: "x", system: "y" })
    ).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof RedactBenchError &&
        error.message.includes("[REDACTED]") &&
        !error.message.includes("sk-example")
    );
  });
});
