import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  truncate
} from "node:fs/promises";
import { dirname } from "node:path";

import { z } from "zod";

import {
  AttemptReportSchema,
  BenchmarkCategorySchema,
  ProviderNameSchema,
  safeRelativePathSchema
} from "./contracts.js";
import { RedactBenchError } from "./errors.js";
import { stableStringify } from "./stable-json.js";

const HexHashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const DateTimeSchema = z.string().datetime({ offset: true });

const RunStartedSchema = z
  .object({
    type: z.literal("run.started"),
    configHash: HexHashSchema,
    run: z
      .object({
        id: z.string().min(1).max(160),
        title: z.string().min(1).max(160),
        suiteId: z.string().min(1).max(80),
        scorerVersion: z.string().min(1).max(64),
        startedAt: DateTimeSchema,
        repeatCount: z.number().int().positive(),
        models: z.array(
          z
            .object({
              id: z.string().min(1).max(80),
              label: z.string().min(1).max(160),
              model: z.string().min(1).max(160),
              provider: ProviderNameSchema
            })
            .strict()
        ),
        tasks: z.array(
          z
            .object({
              category: BenchmarkCategorySchema,
              id: z.string().min(1).max(80),
              title: z.string().min(1).max(160),
              weight: z.number().positive().max(100)
            })
            .strict()
        )
      })
      .strict()
  })
  .strict();

const AttemptCompletedSchema = z
  .object({
    type: z.literal("attempt.completed"),
    artifacts: z
      .object({
        notes: z.string().max(32_768).nullable(),
        patchHash: HexHashSchema.nullable(),
        phase1ResponseHash: HexHashSchema.optional(),
        phase2ResponseHash: HexHashSchema.optional(),
        promptHash: HexHashSchema.nullable(),
        responseHash: HexHashSchema.nullable()
      })
      .strict(),
    imageIds: z.array(z.string().min(1).max(300)),
    report: AttemptReportSchema,
    taskWeight: z.number().positive().max(100)
  })
  .strict();

const ProviderResultSchema = z
  .object({
    model: z.string().min(1).max(160),
    provider: ProviderNameSchema,
    providerRequestId: z.string().max(300).nullable(),
    text: z.string().min(1).max(1_048_576),
    timing: z
      .object({
        completedAt: DateTimeSchema,
        durationMs: z.number().finite().nonnegative(),
        generationMs: z.number().finite().nonnegative(),
        outputTokensPerSecond: z.number().finite().nonnegative().nullable(),
        startedAt: DateTimeSchema,
        ttftMs: z.number().finite().nonnegative()
      })
      .strict(),
    usage: z
      .object({
        cachedInputTokens: z.number().int().nonnegative(),
        inputTokens: z.number().int().nonnegative(),
        outputTokens: z.number().int().nonnegative()
      })
      .strict()
      .nullable()
  })
  .strict();

const RecoveryPhase1CompletedSchema = z
  .object({
    type: z.literal("recovery.phase1.completed"),
    attemptId: z.string().min(1).max(240),
    checkpointPath: safeRelativePathSchema(),
    state: z
      .object({
        commitSha: z.string().regex(/^[a-f0-9]{40,64}$/),
        notes: z.string().min(1).max(32_768),
        patch: z.string().min(1).max(1_048_576),
        patchHash: HexHashSchema,
        promptHash: HexHashSchema,
        providerResult: ProviderResultSchema,
        responseHash: HexHashSchema,
        snapshotHash: HexHashSchema
      })
      .strict()
  })
  .strict();

const RunCompletedSchema = z
  .object({
    type: z.literal("run.completed"),
    completedAt: DateTimeSchema,
    runId: z.string().min(1).max(160)
  })
  .strict();

export const JournalPayloadSchema = z.discriminatedUnion("type", [
  RunStartedSchema,
  AttemptCompletedSchema,
  RecoveryPhase1CompletedSchema,
  RunCompletedSchema
]);

const JournalEntrySchema = z
  .object({
    schemaVersion: z.literal(1),
    sequence: z.number().int().positive(),
    timestamp: DateTimeSchema,
    previousHash: HexHashSchema.nullable(),
    payload: JournalPayloadSchema,
    hash: HexHashSchema
  })
  .strict();

export type JournalPayload = z.infer<typeof JournalPayloadSchema>;
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

interface JournalOptions {
  now?: () => number;
}

function calculateEntryHash(entry: Omit<JournalEntry, "hash">): string {
  return createHash("sha256").update(stableStringify(entry)).digest("hex");
}

async function readAndRepair(filePath: string): Promise<Buffer> {
  let contents: Buffer;
  try {
    contents = await readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return Buffer.alloc(0);
    }
    throw error;
  }

  if (contents.length > 0 && contents[contents.length - 1] !== 0x0a) {
    const lastNewline = contents.lastIndexOf(0x0a);
    const validLength = lastNewline === -1 ? 0 : lastNewline + 1;
    await truncate(filePath, validLength);
    contents = contents.subarray(0, validLength);
  }
  return contents;
}

function parseEntries(contents: Buffer): JournalEntry[] {
  const text = contents.toString("utf8");
  const lines = text.split("\n").filter((line) => line.length > 0);
  const entries: JournalEntry[] = [];
  let previousHash: string | null = null;

  lines.forEach((line, index) => {
    let input: unknown;
    try {
      input = JSON.parse(line);
    } catch (error) {
      throw new RedactBenchError(
        "JOURNAL_INVALID",
        `journal line ${index + 1} is not valid JSON`,
        [],
        error
      );
    }

    const result = JournalEntrySchema.safeParse(input);
    if (!result.success) {
      throw new RedactBenchError(
        "JOURNAL_INVALID",
        `journal line ${index + 1} does not match schema v1`
      );
    }
    const entry = result.data;
    if (entry.sequence !== index + 1 || entry.previousHash !== previousHash) {
      throw new RedactBenchError(
        "JOURNAL_INVALID",
        `journal chain is discontinuous at line ${index + 1}`
      );
    }
    const { hash, ...hashInput } = entry;
    if (calculateEntryHash(hashInput) !== hash) {
      throw new RedactBenchError(
        "JOURNAL_INVALID",
        `journal hash mismatch at line ${index + 1}`
      );
    }
    entries.push(entry);
    previousHash = entry.hash;
  });

  return entries;
}

export class Journal {
  readonly #filePath: string;
  readonly #now: () => number;
  readonly #entries: JournalEntry[];
  #appendQueue: Promise<void> = Promise.resolve();

  private constructor(
    filePath: string,
    entries: JournalEntry[],
    now: () => number
  ) {
    this.#filePath = filePath;
    this.#entries = entries;
    this.#now = now;
  }

  static async open(filePath: string, options: JournalOptions = {}): Promise<Journal> {
    await mkdir(dirname(filePath), { recursive: true });
    const contents = await readAndRepair(filePath);
    return new Journal(filePath, parseEntries(contents), options.now ?? Date.now);
  }

  get entries(): readonly JournalEntry[] {
    return this.#entries;
  }

  async append(payloadInput: JournalPayload): Promise<JournalEntry> {
    const payload = JournalPayloadSchema.parse(payloadInput);
    let resolveEntry: (entry: JournalEntry) => void;
    let rejectEntry: (error: unknown) => void;
    const result = new Promise<JournalEntry>((resolve, reject) => {
      resolveEntry = resolve;
      rejectEntry = reject;
    });

    this.#appendQueue = this.#appendQueue.then(async () => {
      try {
        const previous = this.#entries.at(-1);
        const hashInput: Omit<JournalEntry, "hash"> = {
          payload,
          previousHash: previous?.hash ?? null,
          schemaVersion: 1,
          sequence: this.#entries.length + 1,
          timestamp: new Date(this.#now()).toISOString()
        };
        const entry: JournalEntry = {
          ...hashInput,
          hash: calculateEntryHash(hashInput)
        };
        const handle = await open(this.#filePath, "a", 0o600);
        try {
          await handle.writeFile(`${stableStringify(entry)}\n`, "utf8");
          await handle.sync();
        } finally {
          await handle.close();
        }
        this.#entries.push(entry);
        resolveEntry(entry);
      } catch (error) {
        rejectEntry(error);
      }
    });

    await this.#appendQueue;
    return await result;
  }
}

export function completedAttemptIds(entries: readonly JournalEntry[]): Set<string> {
  return new Set(
    entries
      .filter((entry) => entry.payload.type === "attempt.completed")
      .map((entry) =>
        entry.payload.type === "attempt.completed" ? entry.payload.report.attemptId : ""
      )
      .filter(Boolean)
  );
}
