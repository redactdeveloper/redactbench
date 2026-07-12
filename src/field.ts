import { z } from "zod";

import { loadYamlConfig } from "./config.js";
import { SCHEMA_VERSION } from "./version.js";

const SlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase slug");

export const FieldProviderSchema = z.enum([
  "openai",
  "xai",
  "cursor",
  "google",
  "zai",
  "openrouter"
]);

export const HarnessNameSchema = z.enum([
  "codex",
  "grok-build",
  "cursor",
  "agy",
  "opencode"
]);

export const BenchmarkEntrantSchema = z
  .object({
    id: SlugSchema,
    order: z.number().int().positive().max(100),
    displayName: z.string().trim().min(1).max(160),
    provider: FieldProviderSchema,
    harness: HarnessNameSchema,
    execution: z.literal("docker")
  })
  .strict();

export const BenchmarkFieldSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: SlugSchema,
    title: z.string().trim().min(1).max(160),
    description: z.string().trim().min(1).max(32_768).optional(),
    entrants: z.array(BenchmarkEntrantSchema).min(1).max(100)
  })
  .strict()
  .superRefine((field, context) => {
    const ids = new Set<string>();
    field.entrants.forEach((entrant, index) => {
      if (ids.has(entrant.id)) {
        context.addIssue({
          code: "custom",
          message: `duplicate entrant id: ${entrant.id}`,
          path: ["entrants", index, "id"]
        });
      }
      ids.add(entrant.id);

      if (entrant.order !== index + 1) {
        context.addIssue({
          code: "custom",
          message: `entrant order must be contiguous and match array position`,
          path: ["entrants", index, "order"]
        });
      }
    });
  });

export async function loadBenchmarkField(filePath: string): Promise<BenchmarkField> {
  return loadYamlConfig(filePath, BenchmarkFieldSchema);
}

export type BenchmarkEntrant = z.infer<typeof BenchmarkEntrantSchema>;
export type BenchmarkField = z.infer<typeof BenchmarkFieldSchema>;
export type FieldProvider = z.infer<typeof FieldProviderSchema>;
export type HarnessName = z.infer<typeof HarnessNameSchema>;
