import {
  BenchmarkFieldSchema,
  type BenchmarkField,
  type FieldProvider,
  type HarnessName
} from "../../src/field-contracts.js";

export const PROVIDER_LABELS: Readonly<Record<FieldProvider, string>> = {
  openai: "OpenAI",
  xai: "xAI",
  cursor: "Cursor",
  google: "Google",
  zai: "Z.AI",
  openrouter: "OpenRouter"
};

export const HARNESS_LABELS: Readonly<Record<HarnessName, string>> = {
  codex: "Codex",
  "grok-build": "Grok Build",
  cursor: "Cursor Agent",
  agy: "AGY",
  opencode: "OpenCode"
};

export async function loadField(url = "./field.json"): Promise<BenchmarkField> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Field request failed with HTTP ${response.status}`);
  }
  return BenchmarkFieldSchema.parse(await response.json());
}

export function parseField(input: unknown): BenchmarkField {
  return BenchmarkFieldSchema.parse(input);
}
