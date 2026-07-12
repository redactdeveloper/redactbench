import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import fieldData from "../dashboard/public/field.json";
import {
  BenchmarkFieldSchema,
  loadBenchmarkField
} from "../src/field.js";

const entrant = {
  displayName: "GPT-5.6 Sol Max",
  execution: "docker",
  harness: "codex",
  id: "gpt-5-6-sol-max-codex",
  order: 1,
  provider: "openai"
} as const;

describe("BenchmarkFieldSchema", () => {
  it("accepts a Docker-only entrant roster", () => {
    const field = BenchmarkFieldSchema.parse({
      schemaVersion: 1,
      id: "target-field",
      title: "Target field",
      entrants: [entrant]
    });

    expect(field.entrants[0]).toEqual(entrant);
  });

  it.each([
    ["host execution", { ...entrant, execution: "host" }],
    ["unknown harness", { ...entrant, harness: "unknown-agent" }],
    ["unknown provider", { ...entrant, provider: "mystery-router" }],
    ["credential field", { ...entrant, apiKey: "must-not-be-here" }]
  ])("rejects %s", (_label, invalidEntrant) => {
    expect(
      BenchmarkFieldSchema.safeParse({
        schemaVersion: 1,
        id: "target-field",
        title: "Target field",
        entrants: [invalidEntrant]
      }).success
    ).toBe(false);
  });

  it("requires unique IDs and contiguous display order", () => {
    expect(
      BenchmarkFieldSchema.safeParse({
        schemaVersion: 1,
        id: "target-field",
        title: "Target field",
        entrants: [entrant, { ...entrant, order: 2 }]
      }).success
    ).toBe(false);
    expect(
      BenchmarkFieldSchema.safeParse({
        schemaVersion: 1,
        id: "target-field",
        title: "Target field",
        entrants: [entrant, { ...entrant, id: "second", order: 3 }]
      }).success
    ).toBe(false);
  });
});

describe("target benchmark field", () => {
  it("loads the exact eleven requested entrants without secrets", async () => {
    const field = await loadBenchmarkField(
      resolve("benchmarks/target-field.yaml")
    );

    expect(field.entrants).toHaveLength(11);
    expect(field.entrants.map((entry) => entry.displayName)).toEqual([
      "GPT-5.6 Sol Max",
      "GPT-5.6 Terra Max",
      "GPT-5.6 Luna Max",
      "GPT-5.5 xHigh",
      "Grok 4.5 High",
      "Grok Build",
      "Cursor Composer 2.5",
      "Gemini 3.5 Flash High",
      "Gemini 3.1 Pro High",
      "GLM 5.2 Max",
      "Hy3 High"
    ]);
    expect(field.entrants.every((entry) => entry.execution === "docker")).toBe(
      true
    );
    expect(JSON.stringify(field)).not.toMatch(/api[_-]?key|token|secret/iu);
    expect(BenchmarkFieldSchema.parse(fieldData)).toEqual(field);
  });
});
