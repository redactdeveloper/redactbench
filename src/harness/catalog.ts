import { z } from "zod";

import { loadYamlConfig } from "../config.js";
import { RedactBenchError } from "../errors.js";
import type { BenchmarkField } from "../field-contracts.js";
import { SCHEMA_VERSION } from "../version.js";
import {
  HarnessDockerRuntimeSchema,
  HarnessModelArgumentsSchema
} from "./docker.js";

const SlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase slug");

const RuntimeDefinitionSchema = z
  .object({
    id: SlugSchema,
    runtime: HarnessDockerRuntimeSchema
  })
  .strict();

const EntrantBindingSchema = z
  .object({
    entrantId: SlugSchema,
    runtimeId: SlugSchema,
    model: z.string().trim().min(1).max(160),
    modelArguments: HarnessModelArgumentsSchema.default([])
  })
  .strict();

export const HarnessCatalogSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    runtimes: z.array(RuntimeDefinitionSchema).min(1).max(32),
    bindings: z.array(EntrantBindingSchema).min(1).max(100)
  })
  .strict()
  .superRefine((catalog, context) => {
    const runtimeIds = new Set<string>();
    catalog.runtimes.forEach((entry, index) => {
      if (runtimeIds.has(entry.id)) {
        context.addIssue({
          code: "custom",
          message: `duplicate runtime id: ${entry.id}`,
          path: ["runtimes", index, "id"]
        });
      }
      runtimeIds.add(entry.id);
    });

    const entrantIds = new Set<string>();
    catalog.bindings.forEach((binding, index) => {
      if (entrantIds.has(binding.entrantId)) {
        context.addIssue({
          code: "custom",
          message: `duplicate entrant binding: ${binding.entrantId}`,
          path: ["bindings", index, "entrantId"]
        });
      }
      entrantIds.add(binding.entrantId);
      if (!runtimeIds.has(binding.runtimeId)) {
        context.addIssue({
          code: "custom",
          message: `unknown runtime id: ${binding.runtimeId}`,
          path: ["bindings", index, "runtimeId"]
        });
      }
    });
  });

export function validateHarnessCatalog(
  catalog: HarnessCatalog,
  field: BenchmarkField
): HarnessCatalog {
  if (catalog.bindings.length !== field.entrants.length) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      "target field must have exactly one binding per entrant"
    );
  }

  const runtimeById = new Map(
    catalog.runtimes.map((entry) => [entry.id, entry.runtime])
  );
  field.entrants.forEach((entrant, index) => {
    const binding = catalog.bindings[index];
    if (binding?.entrantId !== entrant.id) {
      throw new RedactBenchError(
        "CONFIG_INVALID",
        `binding order must match target field at entrant ${entrant.id}`
      );
    }
    const runtime = runtimeById.get(binding.runtimeId);
    if (!runtime || runtime.harness !== entrant.harness) {
      throw new RedactBenchError(
        "CONFIG_INVALID",
        `binding ${binding.entrantId} must use its declared ${entrant.harness} harness`
      );
    }
    if (!runtime.argv.includes("{modelArguments}")) {
      throw new RedactBenchError(
        "CONFIG_INVALID",
        `runtime ${binding.runtimeId} must expose the modelArguments slot`
      );
    }
  });

  return catalog;
}

export async function loadHarnessCatalog(
  filePath: string,
  field: BenchmarkField
): Promise<HarnessCatalog> {
  const catalog = await loadYamlConfig(filePath, HarnessCatalogSchema);
  return validateHarnessCatalog(catalog, field);
}

export type HarnessCatalog = z.infer<typeof HarnessCatalogSchema>;
export type HarnessEntrantBinding = z.infer<typeof EntrantBindingSchema>;
