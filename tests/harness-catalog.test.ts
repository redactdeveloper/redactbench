import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { loadBenchmarkField } from "../src/field.js";
import {
  HarnessCatalogSchema,
  loadHarnessCatalog,
  validateHarnessCatalog
} from "../src/harness/catalog.js";

describe("HarnessCatalogSchema", () => {
  it("rejects duplicate runtime and entrant bindings", () => {
    const runtime = {
      id: "codex",
      runtime: {
        schemaVersion: 1,
        execution: "docker",
        harness: "codex",
        image: "redactbench/harness-codex:local",
        argv: ["codex", "exec", "--model", "{model}"],
        promptTransport: "stdin",
        network: "redactbench-egress-openai"
      }
    } as const;
    const binding = {
      entrantId: "gpt-5-6-sol-max-codex",
      model: "gpt-5.6-sol",
      modelArguments: ["-c", "model_reasoning_effort=\"max\""],
      runtimeId: "codex"
    } as const;

    expect(HarnessCatalogSchema.safeParse({
      schemaVersion: 1,
      runtimes: [runtime, runtime],
      bindings: [binding]
    }).success).toBe(false);
    expect(HarnessCatalogSchema.safeParse({
      schemaVersion: 1,
      runtimes: [runtime],
      bindings: [binding, binding]
    }).success).toBe(false);
  });
});

describe("target harness catalog", () => {
  it("binds every target entrant to the intended model, variant and Docker harness", async () => {
    const field = await loadBenchmarkField(resolve("benchmarks/target-field.yaml"));
    const catalog = await loadHarnessCatalog(
      resolve("benchmarks/target-runtimes.yaml"),
      field
    );

    expect(catalog.bindings).toHaveLength(11);
    expect(catalog.bindings.map((binding) => [
      binding.entrantId,
      binding.model,
      binding.modelArguments
    ])).toEqual([
      ["gpt-5-6-sol-max-codex", "gpt-5.6-sol", ["-c", "model_reasoning_effort=\"max\""]],
      ["gpt-5-6-terra-max-codex", "gpt-5.6-terra", ["-c", "model_reasoning_effort=\"max\""]],
      ["gpt-5-6-luna-max-codex", "gpt-5.6-luna", ["-c", "model_reasoning_effort=\"max\""]],
      ["gpt-5-5-xhigh-codex", "gpt-5.5", ["-c", "model_reasoning_effort=\"xhigh\""]],
      ["grok-4-5-high-grok-build", "grok-4.5", ["--reasoning-effort", "high"]],
      ["grok-build-grok-build", "grok-composer-2.5-fast", []],
      ["cursor-composer-2-5-cursor", "composer-2.5", []],
      ["gemini-3-5-flash-high-agy", "Gemini 3.5 Flash (High)", ["--new-project"]],
      ["gemini-3-1-pro-high-agy", "Gemini 3.1 Pro (High)", ["--new-project"]],
      ["glm-5-2-max-opencode", "zai/glm-5.2", ["--variant", "max"]],
      ["hy3-high-opencode", "openrouter/tencent/hy3", ["--variant", "high"]]
    ]);

    const runtimeById = new Map(
      catalog.runtimes.map((entry) => [entry.id, entry.runtime])
    );
    for (const [index, binding] of catalog.bindings.entries()) {
      const entrant = field.entrants[index];
      const runtime = runtimeById.get(binding.runtimeId);
      expect(entrant?.id).toBe(binding.entrantId);
      expect(runtime?.harness).toBe(entrant?.harness);
      expect(runtime?.execution).toBe("docker");
      expect(runtime?.argv).toContain("{modelArguments}");
    }
    expect(JSON.stringify(catalog)).not.toMatch(
      /(?:apiKey\s*:|token\s*:|secretValue\s*:)/iu
    );
  });

  it("fails when a field entrant is missing or points at another harness", async () => {
    const field = await loadBenchmarkField(resolve("benchmarks/target-field.yaml"));
    const catalog = await loadHarnessCatalog(
      resolve("benchmarks/target-runtimes.yaml"),
      field
    );

    await expect(loadHarnessCatalog(
      resolve("benchmarks/target-runtimes.yaml"),
      { ...field, entrants: field.entrants.slice(1) }
    )).rejects.toThrow(/exactly one binding/u);

    const wrongHarness = structuredClone(catalog);
    wrongHarness.bindings[0]!.runtimeId = "grok-build";
    expect(() => validateHarnessCatalog(wrongHarness, field)).toThrow(
      /declared codex harness/u
    );
  });
});
