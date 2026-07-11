import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import type { ModelConfig } from "../../src/contracts.js";
import type { RedactBenchError } from "../../src/errors.js";
import { createAnthropicAdapter } from "../../src/providers/anthropic.js";
import { createFixtureAdapter } from "../../src/providers/fixture.js";
import { createGoogleAdapter } from "../../src/providers/google.js";
import { createProviderAdapter } from "../../src/providers/index.js";

function sseStream(events: unknown[]) {
  const encoder = new TextEncoder();
  return new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(": ping\n\n"));
        for (const event of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
        }
        controller.close();
      }
    }),
    {
      headers: { "content-type": "text/event-stream" },
      status: 200
    }
  );
}

const request = {
  maxOutputTokens: 1_024,
  prompt: "Fix the code.",
  system: "Benchmark instructions."
};

describe("Anthropic adapter", () => {
  it("streams Messages text and cumulative usage from the fixed endpoint", async () => {
    const model = {
      id: "anthropic-primary",
      label: "Anthropic Primary",
      maxOutputTokens: 4_096,
      model: "claude-example",
      provider: "anthropic"
    } satisfies Extract<ModelConfig, { provider: "anthropic" }>;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      sseStream([
        {
          type: "message_start",
          message: {
            id: "msg_123",
            model: "claude-example",
            usage: {
              cache_read_input_tokens: 7,
              input_tokens: 30,
              output_tokens: 1
            }
          }
        },
        { type: "ping" },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: "Hello" }
        },
        {
          type: "content_block_delta",
          index: 0,
          delta: { type: "text_delta", text: " Claude" }
        },
        {
          type: "message_delta",
          delta: { stop_reason: "end_turn" },
          usage: { output_tokens: 12 }
        },
        { type: "message_stop" }
      ])
    );
    const now = vi.fn().mockReturnValueOnce(2_000).mockReturnValueOnce(2_300).mockReturnValueOnce(3_000);
    const adapter = createAnthropicAdapter(model, {
      env: { ANTHROPIC_API_KEY: "test-key" },
      fetch: fetchMock,
      now
    });

    const result = await adapter.generate(request);

    expect(result).toMatchObject({
      model: "claude-example",
      provider: "anthropic",
      providerRequestId: "msg_123",
      text: "Hello Claude",
      timing: { durationMs: 1_000, generationMs: 700, ttftMs: 300 },
      usage: { cachedInputTokens: 7, inputTokens: 30, outputTokens: 12 }
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.anthropic.com/v1/messages");
    const headers = new Headers(init?.headers);
    expect(headers.get("x-api-key")).toBe("test-key");
    expect(headers.get("anthropic-version")).toBe("2023-06-01");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      max_tokens: 1_024,
      messages: [{ content: "Fix the code.", role: "user" }],
      model: "claude-example",
      stream: true,
      system: "Benchmark instructions."
    });
  });
});

describe("Google adapter", () => {
  it("streams candidate parts and the latest usageMetadata", async () => {
    const model = {
      id: "google-primary",
      label: "Google Primary",
      maxOutputTokens: 4_096,
      model: "gemini-example",
      provider: "google"
    } satisfies Extract<ModelConfig, { provider: "google" }>;
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      sseStream([
        {
          responseId: "gem_123",
          modelVersion: "gemini-example-001",
          candidates: [{ content: { parts: [{ text: "Hello" }], role: "model" } }]
        },
        {
          responseId: "gem_123",
          modelVersion: "gemini-example-001",
          candidates: [{ content: { parts: [{ text: " Gemini" }], role: "model" } }],
          usageMetadata: {
            cachedContentTokenCount: 3,
            candidatesTokenCount: 9,
            promptTokenCount: 20,
            totalTokenCount: 29
          }
        }
      ])
    );
    const now = vi.fn().mockReturnValueOnce(5_000).mockReturnValueOnce(5_200).mockReturnValueOnce(5_800);
    const adapter = createGoogleAdapter(model, {
      env: { GEMINI_API_KEY: "test-key" },
      fetch: fetchMock,
      now
    });

    const result = await adapter.generate(request);

    expect(result).toMatchObject({
      model: "gemini-example-001",
      provider: "google",
      providerRequestId: "gem_123",
      text: "Hello Gemini",
      timing: { durationMs: 800, generationMs: 600, ttftMs: 200 },
      usage: { cachedInputTokens: 3, inputTokens: 20, outputTokens: 9 }
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-example:streamGenerateContent?alt=sse"
    );
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("test-key");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      contents: [{ parts: [{ text: "Fix the code." }], role: "user" }],
      generationConfig: { maxOutputTokens: 1_024 },
      systemInstruction: { parts: [{ text: "Benchmark instructions." }] }
    });
  });
});

describe("fixture adapter", () => {
  it("returns a deterministic keyed response without network access", async () => {
    const directory = await mkdtemp(join(tmpdir(), "redactbench-fixture-"));
    await mkdir(join(directory, "fixtures"));
    await writeFile(
      join(directory, "fixtures", "model.json"),
      JSON.stringify({
        schemaVersion: 1,
        responses: {
          "debug-get-user:final": {
            durationMs: 250,
            inputTokens: 42,
            outputTokens: 20,
            text: "fixture answer",
            ttftMs: 50
          }
        }
      })
    );
    const model = {
      fixtureFile: "fixtures/model.json",
      id: "fixture-strong",
      label: "Fixture Strong",
      maxOutputTokens: 4_096,
      model: "fixture-v1",
      provider: "fixture"
    } satisfies Extract<ModelConfig, { provider: "fixture" }>;
    const fetchMock = vi.fn<typeof fetch>();
    const adapter = createFixtureAdapter(model, {
      baseDirectory: directory,
      fetch: fetchMock,
      now: () => 10_000
    });

    const result = await adapter.generate({
      ...request,
      fixtureResponseKey: "debug-get-user:final"
    });

    expect(result).toMatchObject({
      provider: "fixture",
      providerRequestId: "fixture:debug-get-user:final",
      text: "fixture answer",
      timing: { durationMs: 250, generationMs: 200, ttftMs: 50 },
      usage: { cachedInputTokens: 0, inputTokens: 42, outputTokens: 20 }
    });
    expect(fetchMock).not.toHaveBeenCalled();

    await expect(adapter.generate(request)).rejects.toMatchObject({
      code: "PROVIDER_ERROR"
    } satisfies Partial<RedactBenchError>);
  });

  it("is selected by the shared provider factory", () => {
    const model = {
      fixtureFile: "fixtures/model.json",
      id: "fixture-strong",
      label: "Fixture Strong",
      maxOutputTokens: 4_096,
      model: "fixture-v1",
      provider: "fixture"
    } satisfies Extract<ModelConfig, { provider: "fixture" }>;

    expect(
      createProviderAdapter(model, { fixtureBaseDirectory: "/safe/base" }).provider
    ).toBe("fixture");
  });
});
