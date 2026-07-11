import { describe, expect, it } from "vitest";

import { RedactBenchError } from "../src/errors.js";
import { readSseEvents, requireOkProviderResponse } from "../src/providers/sse.js";

function streamResponse(chunks: string[], init: ResponseInit = {}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) {
        controller.enqueue(encoder.encode(chunk));
      }
      controller.close();
    }
  });
  return new Response(stream, {
    headers: { "content-type": "text/event-stream" },
    status: 200,
    ...init
  });
}

describe("readSseEvents", () => {
  it("handles chunk boundaries, comments, event names and multiline data", async () => {
    const response = streamResponse([
      ": keepalive\r\n",
      "event: content_block_delta\r\n",
      "data: {\"first\":",
      "true}\r\n",
      "data: second-line\r\n\r\n",
      "data: [DONE]\n\n"
    ]);

    const events = [];
    for await (const event of readSseEvents(response, { maxBytes: 1_024 })) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        data: '{"first":true}\nsecond-line',
        event: "content_block_delta"
      },
      { data: "[DONE]", event: "message" }
    ]);
  });

  it("rejects a stream that exceeds its byte cap", async () => {
    const response = streamResponse([`data: ${"x".repeat(128)}\n\n`]);
    const consume = async () => {
      let eventCount = 0;
      for await (const event of readSseEvents(response, { maxBytes: 64 })) {
        eventCount += event.data.length;
      }
      return eventCount;
    };

    await expect(consume()).rejects.toMatchObject({
      code: "PROVIDER_ERROR"
    } satisfies Partial<RedactBenchError>);
  });
});

describe("requireOkProviderResponse", () => {
  it("redacts credential-shaped content from provider errors", async () => {
    const response = new Response(
      JSON.stringify({ error: "Authorization: Bearer sk-example-secret-value" }),
      { status: 401 }
    );

    await expect(requireOkProviderResponse(response, "OpenAI")).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof RedactBenchError &&
        error.code === "PROVIDER_ERROR" &&
        error.message.includes("[REDACTED]") &&
        !error.message.includes("sk-example")
    );
  });
});
