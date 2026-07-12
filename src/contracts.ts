import { z } from "zod";

import { FieldProviderSchema, HarnessNameSchema } from "./field-contracts.js";
import { SCHEMA_VERSION } from "./version.js";

const MAX_CONFIG_TEXT = 32_768;
const MAX_PROMPT_TEXT = 262_144;
const MAX_CHECK_OUTPUT = 1_048_576;
const MAX_CHECK_TIMEOUT_MS = 300_000;

export const BenchmarkCategorySchema = z.enum([
  "algorithms",
  "debugging",
  "refactoring",
  "security",
  "ui",
  "reasoning",
  "hallucination",
  "context-recovery"
]);

export const ProviderNameSchema = z.enum([
  "fixture",
  "openai",
  "anthropic",
  "google",
  "xai",
  "cursor",
  "zai",
  "openrouter"
]);

const SlugSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "must be a lowercase slug");

const LabelSchema = z.string().trim().min(1).max(160);
const DescriptionSchema = z.string().trim().min(1).max(MAX_CONFIG_TEXT);
const PromptSchema = z.string().trim().min(1).max(MAX_PROMPT_TEXT);

function isSafeRelativePath(value: string, allowDot: boolean): boolean {
  if (value.includes("\0") || value.includes("\\") || value.startsWith("/")) {
    return false;
  }

  if (value === ".") {
    return allowDot;
  }

  const segments = value.split("/");
  return segments.every(
    (segment) => segment.length > 0 && segment !== "." && segment !== ".."
  );
}

export function safeRelativePathSchema(options: { allowDot?: boolean } = {}) {
  const allowDot = options.allowDot ?? false;
  return z
    .string()
    .min(1)
    .max(240)
    .refine((value) => isSafeRelativePath(value, allowDot), {
      message: "must be a normalized relative path contained by its project directory"
    });
}

export const DockerImageSchema = z
  .string()
  .min(1)
  .max(300)
  .regex(
    /^(?:[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[0-9]+)?\/)*[a-z0-9]+(?:[._-][a-z0-9]+)*(?::[A-Za-z0-9][A-Za-z0-9._-]{0,127})?(?:@sha256:[a-f0-9]{64})?$/,
    "must be a valid OCI image reference"
  );

const ArgSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine((value) => !value.includes("\0"), "must not contain NUL bytes");

export const EvaluatorCheckSchema = z
  .object({
    id: SlugSchema,
    label: LabelSchema.optional(),
    argv: z.array(ArgSchema).min(1).max(32),
    cwd: safeRelativePathSchema({ allowDot: true }).default("."),
    image: DockerImageSchema,
    weight: z.number().positive().max(100).default(1),
    timeoutMs: z.number().int().min(100).max(MAX_CHECK_TIMEOUT_MS).default(30_000),
    maxOutputBytes: z.number().int().min(1_024).max(MAX_CHECK_OUTPUT).default(65_536)
  })
  .strict();

const ResponseConfigSchema = z
  .object({
    kind: z.enum(["patch", "text"]).default("patch"),
    maxBytes: z.number().int().min(1_024).max(1_048_576).default(262_144)
  })
  .strict();

const ContextRecoveryConfigSchema = z
  .object({
    enabled: z.literal(true),
    phase1Prompt: PromptSchema,
    phase2Prompt: PromptSchema.optional(),
    maxPhase1OutputTokens: z.number().int().min(64).max(32_768).default(2_048),
    notesRequired: z.literal(true).default(true)
  })
  .strict();

export const TaskSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: SlugSchema,
    title: LabelSchema,
    category: BenchmarkCategorySchema,
    description: DescriptionSchema,
    prompt: PromptSchema,
    tags: z.array(SlugSchema).max(32).default([]),
    workspace: safeRelativePathSchema().default("workspace"),
    evaluator: safeRelativePathSchema().default("evaluator"),
    response: ResponseConfigSchema.default({ kind: "patch", maxBytes: 262_144 }),
    checks: z.array(EvaluatorCheckSchema).min(1).max(64),
    contextRecovery: ContextRecoveryConfigSchema.optional()
  })
  .strict()
  .superRefine((task, context) => {
    if (task.contextRecovery !== undefined && task.category !== "context-recovery") {
      context.addIssue({
        code: "custom",
        message: "contextRecovery is only valid for the context-recovery category",
        path: ["contextRecovery"]
      });
    }

    if (task.category === "context-recovery" && task.contextRecovery === undefined) {
      context.addIssue({
        code: "custom",
        message: "context-recovery tasks require contextRecovery configuration",
        path: ["contextRecovery"]
      });
    }

    if (task.category === "context-recovery" && task.response.kind !== "patch") {
      context.addIssue({
        code: "custom",
        message: "context-recovery tasks require patch responses",
        path: ["response", "kind"]
      });
    }

    const checkIds = new Set<string>();
    task.checks.forEach((check, index) => {
      if (checkIds.has(check.id)) {
        context.addIssue({
          code: "custom",
          message: `duplicate check id: ${check.id}`,
          path: ["checks", index, "id"]
        });
      }
      checkIds.add(check.id);
    });
  });

const SuiteTaskSchema = z
  .object({
    manifest: safeRelativePathSchema(),
    weight: z.number().positive().max(100).default(1)
  })
  .strict();

export const SuiteSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    id: SlugSchema,
    title: LabelSchema,
    description: z.string().trim().max(MAX_CONFIG_TEXT).optional(),
    scorerVersion: z.string().trim().min(1).max(64).default("1.1.0"),
    tasks: z.array(SuiteTaskSchema).min(1).max(1_000)
  })
  .strict()
  .superRefine((suite, context) => {
    const manifests = new Set<string>();
    suite.tasks.forEach((task, index) => {
      if (manifests.has(task.manifest)) {
        context.addIssue({
          code: "custom",
          message: `duplicate task manifest: ${task.manifest}`,
          path: ["tasks", index, "manifest"]
        });
      }
      manifests.add(task.manifest);
    });
  });

const PricingSchema = z
  .object({
    inputUsdPerMillion: z.number().nonnegative().finite(),
    cachedInputUsdPerMillion: z.number().nonnegative().finite().optional(),
    outputUsdPerMillion: z.number().nonnegative().finite()
  })
  .strict();

const ModelBaseShape = {
  id: SlugSchema,
  label: LabelSchema,
  model: z.string().trim().min(1).max(160),
  maxOutputTokens: z.number().int().min(64).max(131_072).default(8_192),
  pricing: PricingSchema.optional(),
  temperature: z.number().min(0).max(2).optional()
};

const FixtureModelSchema = z
  .object({
    ...ModelBaseShape,
    provider: z.literal("fixture"),
    fixtureFile: safeRelativePathSchema()
  })
  .strict();

const OpenAiModelSchema = z
  .object({
    ...ModelBaseShape,
    provider: z.literal("openai")
  })
  .strict();

const AnthropicModelSchema = z
  .object({
    ...ModelBaseShape,
    provider: z.literal("anthropic")
  })
  .strict();

const GoogleModelSchema = z
  .object({
    ...ModelBaseShape,
    provider: z.literal("google")
  })
  .strict();

const HarnessModelSchema = z
  .object({
    ...ModelBaseShape,
    provider: FieldProviderSchema,
    execution: z.literal("docker-harness"),
    harness: HarnessNameSchema
  })
  .strict();

export const ModelSchema = z.union([
  FixtureModelSchema,
  OpenAiModelSchema,
  AnthropicModelSchema,
  GoogleModelSchema,
  HarnessModelSchema
]);

export const ModelConfigFileSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    models: z.array(ModelSchema).min(1).max(100)
  })
  .strict()
  .superRefine((config, context) => {
    const ids = new Set<string>();
    config.models.forEach((model, index) => {
      if (ids.has(model.id)) {
        context.addIssue({
          code: "custom",
          message: `duplicate model id: ${model.id}`,
          path: ["models", index, "id"]
        });
      }
      ids.add(model.id);
    });
  });

const ScoreSchema = z.number().min(0).max(1);
const NullableMetricSchema = z.number().finite().nonnegative().nullable();
const DateTimeSchema = z.string().datetime({ offset: true });

export const CheckResultSchema = z
  .object({
    id: SlugSchema,
    label: LabelSchema.optional(),
    status: z.enum(["passed", "failed", "error", "timeout"]),
    weight: z.number().positive(),
    durationMs: z.number().finite().nonnegative(),
    exitCode: z.number().int().nullable(),
    output: z.string().max(MAX_CHECK_OUTPUT),
    errorCode: z.string().max(80).optional()
  })
  .strict();

const AttemptMetricsSchema = z
  .object({
    costUsd: NullableMetricSchema,
    durationMs: z.number().finite().nonnegative(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    outputTokensPerSecond: NullableMetricSchema,
    ttftMs: NullableMetricSchema
  })
  .strict();

const ContextRecoveryResultSchema = z
  .object({
    checksPassed: z.number().int().nonnegative(),
    duplicateEdits: z.number().int().nonnegative(),
    notesPreserved: z.boolean(),
    notesTotal: z.number().int().nonnegative(),
    recoveryMs: z.number().finite().nonnegative(),
    rollbackDetected: z.boolean()
  })
  .strict();

export const AttemptReportSchema = z
  .object({
    attemptId: z.string().min(1).max(200),
    taskId: SlugSchema,
    taskTitle: LabelSchema,
    category: BenchmarkCategorySchema,
    modelId: SlugSchema,
    provider: ProviderNameSchema,
    providerModel: z.string().min(1).max(160),
    repeat: z.number().int().positive(),
    startedAt: DateTimeSchema,
    completedAt: DateTimeSchema,
    status: z.enum(["passed", "failed", "error"]),
    score: ScoreSchema,
    metrics: AttemptMetricsSchema,
    checks: z.array(CheckResultSchema),
    error: z
      .object({
        code: z.string().min(1).max(80),
        message: z.string().min(1).max(2_048)
      })
      .strict()
      .optional(),
    contextRecovery: ContextRecoveryResultSchema.optional()
  })
  .strict();

export const ReportAttemptSchema = AttemptReportSchema.extend({
  taskWeight: z.number().positive().max(100).default(1)
});

export const ScoreStatisticsSchema = z
  .object({
    confidence95: z
      .object({
        lower: ScoreSchema,
        upper: ScoreSchema
      })
      .strict()
      .nullable(),
    sampleCount: z.number().int().nonnegative(),
    standardDeviation: NullableMetricSchema,
    standardError: NullableMetricSchema
  })
  .strict()
  .superRefine((statistics, context) => {
    if (
      statistics.confidence95 !== null &&
      statistics.confidence95.lower > statistics.confidence95.upper
    ) {
      context.addIssue({
        code: "custom",
        message: "confidence interval lower bound must not exceed its upper bound",
        path: ["confidence95", "lower"]
      });
    }

    const estimates = [
      statistics.confidence95,
      statistics.standardDeviation,
      statistics.standardError
    ];
    const hasAllEstimates = estimates.every((estimate) => estimate !== null);
    const hasNoEstimates = estimates.every((estimate) => estimate === null);
    if (
      (statistics.sampleCount < 2 && !hasNoEstimates) ||
      (statistics.sampleCount >= 2 && !hasAllEstimates)
    ) {
      context.addIssue({
        code: "custom",
        message: "uncertainty estimates require at least two samples",
        path: ["sampleCount"]
      });
    }
  });

const EMPTY_SCORE_STATISTICS = {
  confidence95: null,
  sampleCount: 0,
  standardDeviation: null,
  standardError: null
} as const;

const ModelReportSchema = z
  .object({
    modelId: SlugSchema,
    label: LabelSchema,
    provider: ProviderNameSchema,
    score: ScoreSchema,
    categories: z.partialRecord(BenchmarkCategorySchema, ScoreSchema),
    scoreStatistics: ScoreStatisticsSchema.default(EMPTY_SCORE_STATISTICS),
    categoryStatistics: z
      .partialRecord(BenchmarkCategorySchema, ScoreStatisticsSchema)
      .default({}),
    metrics: z
      .object({
        attemptCount: z.number().int().nonnegative(),
        avgTtftMs: NullableMetricSchema,
        correctCount: z.number().int().nonnegative(),
        costPerCorrectUsd: NullableMetricSchema,
        outputTokensPerSecond: NullableMetricSchema,
        totalCostUsd: NullableMetricSchema
      })
      .strict()
  })
  .strict();

export const ReportSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    scorerVersion: z.string().min(1).max(64),
    generatedAt: DateTimeSchema,
    run: z
      .object({
        id: z.string().min(1).max(160),
        title: LabelSchema,
        startedAt: DateTimeSchema,
        completedAt: DateTimeSchema.nullable(),
        modelCount: z.number().int().nonnegative(),
        repeatCount: z.number().int().positive(),
        taskCount: z.number().int().nonnegative(),
        concurrency: z.number().int().min(1).max(8).default(1),
        seed: z.number().int().min(0).max(4_294_967_295).nullable().default(null)
      })
      .strict(),
    leaderboard: z.array(ModelReportSchema),
    attempts: z.array(ReportAttemptSchema),
    journalVerified: z.boolean(),
    sandbox: z
      .object({
        imageIds: z.array(z.string().min(1).max(300)),
        kind: z.literal("docker"),
        network: z.literal("none")
      })
      .strict()
  })
  .strict();

export type AttemptReport = z.infer<typeof AttemptReportSchema>;
export type BenchmarkCategory = z.infer<typeof BenchmarkCategorySchema>;
export type CheckResult = z.infer<typeof CheckResultSchema>;
export type EvaluatorCheck = z.infer<typeof EvaluatorCheckSchema>;
export type ModelConfig = z.infer<typeof ModelSchema>;
export type ModelConfigFile = z.infer<typeof ModelConfigFileSchema>;
export type ProviderName = z.infer<typeof ProviderNameSchema>;
export type Report = z.infer<typeof ReportSchema>;
export type ReportAttempt = z.infer<typeof ReportAttemptSchema>;
export type ReportScoreStatistics = z.infer<typeof ScoreStatisticsSchema>;
export type Suite = z.infer<typeof SuiteSchema>;
export type Task = z.infer<typeof TaskSchema>;
