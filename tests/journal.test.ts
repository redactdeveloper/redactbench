import { appendFile, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { RedactBenchError } from "../src/errors.js";
import {
  Journal,
  completedAttemptIds,
  type JournalPayload
} from "../src/journal.js";

const runStarted: JournalPayload = {
  type: "run.started",
  configHash: "a".repeat(64),
  run: {
    id: "run-demo",
    title: "Demo",
    suiteId: "demo",
    scorerVersion: "1.0.0",
    startedAt: "2026-07-12T00:00:00.000Z",
    repeatCount: 1,
    models: [
      {
        id: "fixture",
        label: "Fixture",
        model: "fixture-v1",
        provider: "fixture"
      }
    ],
    tasks: [
      {
        category: "debugging",
        id: "debug-get-user",
        title: "Fix getUser",
        weight: 1
      }
    ]
  }
};

const attemptCompleted: JournalPayload = {
  type: "attempt.completed",
  artifacts: {
    notes: "done",
    patchHash: "b".repeat(64),
    promptHash: "c".repeat(64),
    responseHash: "d".repeat(64)
  },
  imageIds: ["sha256:image"],
  report: {
    attemptId: "run-demo:debug-get-user:fixture:1",
    taskId: "debug-get-user",
    taskTitle: "Fix getUser",
    category: "debugging",
    modelId: "fixture",
    provider: "fixture",
    providerModel: "fixture-v1",
    repeat: 1,
    startedAt: "2026-07-12T00:00:00.000Z",
    completedAt: "2026-07-12T00:00:01.000Z",
    status: "passed",
    score: 1,
    metrics: {
      costUsd: null,
      durationMs: 1_000,
      inputTokens: 10,
      outputTokens: 10,
      outputTokensPerSecond: 20,
      ttftMs: 500
    },
    checks: []
  },
  taskWeight: 1
};

describe("Journal", () => {
  it("appends a verifiable sequence and reopens it without changing bytes", async () => {
    const directory = await mkdtemp(join(tmpdir(), "redactbench-journal-"));
    const file = join(directory, "journal.jsonl");
    const timestamps = [
      Date.parse("2026-07-12T00:00:00.000Z"),
      Date.parse("2026-07-12T00:00:01.000Z")
    ];
    const journal = await Journal.open(file, { now: () => timestamps.shift() ?? 0 });

    const first = await journal.append(runStarted);
    const second = await journal.append(attemptCompleted);
    const before = await readFile(file, "utf8");
    const reopened = await Journal.open(file);
    const after = await readFile(file, "utf8");

    expect(first.sequence).toBe(1);
    expect(first.previousHash).toBeNull();
    expect(second.sequence).toBe(2);
    expect(second.previousHash).toBe(first.hash);
    expect(second.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(reopened.entries).toHaveLength(2);
    expect(after).toBe(before);
    expect(completedAttemptIds(reopened.entries)).toEqual(
      new Set(["run-demo:debug-get-user:fixture:1"])
    );
  });

  it("rejects a tampered hash chain", async () => {
    const directory = await mkdtemp(join(tmpdir(), "redactbench-journal-"));
    const file = join(directory, "journal.jsonl");
    const journal = await Journal.open(file);
    await journal.append(runStarted);
    const contents = await readFile(file, "utf8");
    await writeFile(file, contents.replace('"title":"Demo"', '"title":"Tampered"'));

    await expect(Journal.open(file)).rejects.toMatchObject({
      code: "JOURNAL_INVALID"
    } satisfies Partial<RedactBenchError>);
  });

  it("truncates only an incomplete trailing record after a crash", async () => {
    const directory = await mkdtemp(join(tmpdir(), "redactbench-journal-"));
    const file = join(directory, "journal.jsonl");
    const journal = await Journal.open(file);
    await journal.append(runStarted);
    await appendFile(file, '{"schemaVersion":1,"sequence":2');

    const reopened = await Journal.open(file);
    const repaired = await readFile(file, "utf8");

    expect(reopened.entries).toHaveLength(1);
    expect(repaired.endsWith("\n")).toBe(true);
    expect(repaired).not.toContain('"sequence":2');
  });

  it("deduplicates repeated completed attempt IDs for resume", async () => {
    const directory = await mkdtemp(join(tmpdir(), "redactbench-journal-"));
    const file = join(directory, "journal.jsonl");
    const journal = await Journal.open(file);
    await journal.append(runStarted);
    await journal.append(attemptCompleted);
    await journal.append(attemptCompleted);

    expect(completedAttemptIds(journal.entries).size).toBe(1);
  });
});
