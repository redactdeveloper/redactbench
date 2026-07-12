import { RedactBenchError } from "../errors.js";

export interface SseEvent {
  data: string;
  event: string;
}

interface SseReadOptions {
  maxBytes: number;
}

export function redactSensitiveText(value: string): string {
  return value
    .replace(/Bearer\s+[^\s"']+/giu, "Bearer [REDACTED]")
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, "[REDACTED]")
    .replace(/\bAIza[A-Za-z0-9_-]{10,}\b/gu, "[REDACTED]")
    .replace(
      /((?:api[_-]?key|x-api-key)\s*[=:]\s*)[^\s,"'}]+/giu,
      "$1[REDACTED]"
    );
}

async function readErrorBody(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) {
    return "";
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let body = "";

  try {
    while (totalBytes < maxBytes) {
      const { done, value } = await reader.read();
      if (done) {
        body += decoder.decode();
        break;
      }
      if (!value) {
        continue;
      }
      const remaining = maxBytes - totalBytes;
      const chunk = value.subarray(0, remaining);
      totalBytes += chunk.byteLength;
      body += decoder.decode(chunk, { stream: totalBytes < maxBytes });
      if (chunk.byteLength < value.byteLength) {
        body += "…";
        break;
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  return body;
}

export async function requireOkProviderResponse(
  response: Response,
  providerLabel: string
): Promise<void> {
  if (response.ok) {
    return;
  }

  const rawBody = await readErrorBody(response, 8_192);
  const safeBody = redactSensitiveText(rawBody).replaceAll(/\s+/gu, " ").trim();
  const suffix = safeBody ? `: ${safeBody}` : "";
  throw new RedactBenchError(
    "PROVIDER_ERROR",
    `${providerLabel} request failed with HTTP ${response.status}${suffix}`
  );
}

export async function* readSseEvents(
  response: Response,
  options: SseReadOptions
): AsyncGenerator<SseEvent> {
  if (!response.body) {
    throw new RedactBenchError("PROVIDER_ERROR", "provider returned an empty stream");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let totalBytes = 0;
  let eventName = "message";
  let dataLines: string[] = [];
  let streamCompleted = false;

  const parseLine = (line: string): SseEvent | null => {
    if (line === "") {
      if (dataLines.length === 0) {
        eventName = "message";
        return null;
      }
      const event = { data: dataLines.join("\n"), event: eventName };
      eventName = "message";
      dataLines = [];
      return event;
    }

    if (line.startsWith(":")) {
      return null;
    }

    const colonIndex = line.indexOf(":");
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    let value = colonIndex === -1 ? "" : line.slice(colonIndex + 1);
    if (value.startsWith(" ")) {
      value = value.slice(1);
    }

    if (field === "event") {
      eventName = value || "message";
    } else if (field === "data") {
      dataLines.push(value);
    }
    return null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        streamCompleted = true;
        buffer += decoder.decode();
        break;
      }
      if (!value) {
        continue;
      }

      totalBytes += value.byteLength;
      if (totalBytes > options.maxBytes) {
        throw new RedactBenchError(
          "PROVIDER_ERROR",
          `provider stream exceeds the ${options.maxBytes}-byte limit`
        );
      }

      buffer += decoder.decode(value, { stream: true });
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        const rawLine = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        const event = parseLine(line);
        if (event) {
          yield event;
        }
        newlineIndex = buffer.indexOf("\n");
      }
    }

    if (buffer.length > 0) {
      const event = parseLine(buffer.endsWith("\r") ? buffer.slice(0, -1) : buffer);
      if (event) {
        yield event;
      }
    }
    const finalEvent = parseLine("");
    if (finalEvent) {
      yield finalEvent;
    }
  } finally {
    if (!streamCompleted) {
      await reader.cancel().catch(() => undefined);
    }
    reader.releaseLock();
  }
}
