import type {
  BenchmarkCategory,
  Report
} from "./contracts.js";
import { ReportSchema } from "./contracts.js";
import { RedactBenchError } from "./errors.js";
import type { JournalEntry } from "./journal.js";
import { summarizeWeightedRepeats } from "./statistics.js";

function average(values: Array<number | null>): number | null {
  const measured = values.filter((value): value is number => value !== null);
  return measured.length === 0
    ? null
    : measured.reduce((sum, value) => sum + value, 0) / measured.length;
}

export function aggregateJournal(
  entries: readonly JournalEntry[],
  generatedAt = new Date().toISOString()
): Report {
  const startedEntries = entries.filter(
    (entry) => entry.payload.type === "run.started"
  );
  if (startedEntries.length !== 1 || startedEntries[0]?.payload.type !== "run.started") {
    throw new RedactBenchError(
      "JOURNAL_INVALID",
      "journal must contain exactly one run.started event"
    );
  }
  const started = startedEntries[0].payload;
  const completed = entries
    .filter((entry) => entry.payload.type === "run.completed")
    .at(-1);

  const attemptEvents = new Map<
    string,
    Extract<JournalEntry["payload"], { type: "attempt.completed" }>
  >();
  for (const entry of entries) {
    if (entry.payload.type === "attempt.completed") {
      attemptEvents.set(entry.payload.report.attemptId, entry.payload);
    }
  }
  const attemptsWithWeight = [...attemptEvents.values()];
  const attempts = attemptsWithWeight
    .map((event) => ({ ...event.report, taskWeight: event.taskWeight }))
    .sort(
      (left, right) =>
        left.modelId.localeCompare(right.modelId) ||
        left.taskId.localeCompare(right.taskId) ||
        left.repeat - right.repeat
    );
  const imageIds = new Set(
    attemptsWithWeight.flatMap((event) => event.imageIds)
  );

  const leaderboard = started.run.models.map((model) => {
    const modelEvents = attemptsWithWeight.filter(
      (event) => event.report.modelId === model.id
    );
    const totalWeight = modelEvents.reduce(
      (sum, event) => sum + event.taskWeight,
      0
    );
    const weightedScore = modelEvents.reduce(
      (sum, event) => sum + event.report.score * event.taskWeight,
      0
    );
    const categoryTotals = new Map<
      BenchmarkCategory,
      { score: number; weight: number }
    >();
    for (const event of modelEvents) {
      const current = categoryTotals.get(event.report.category) ?? {
        score: 0,
        weight: 0
      };
      current.score += event.report.score * event.taskWeight;
      current.weight += event.taskWeight;
      categoryTotals.set(event.report.category, current);
    }
    const categories: Partial<Record<BenchmarkCategory, number>> = {};
    for (const [category, total] of categoryTotals) {
      categories[category] = total.weight === 0 ? 0 : total.score / total.weight;
    }

    const observations = modelEvents.map((event) => ({
      repeat: event.report.repeat,
      score: event.report.score,
      taskId: event.report.taskId,
      weight: event.taskWeight
    }));
    const scoreStatistics = summarizeWeightedRepeats(
      observations,
      started.run.tasks.map((task) => task.id)
    ).statistics;
    const categoryStatistics: Partial<
      Record<BenchmarkCategory, typeof scoreStatistics>
    > = {};
    for (const category of new Set(started.run.tasks.map((task) => task.category))) {
      const expectedCategoryTaskIds = started.run.tasks
        .filter((task) => task.category === category)
        .map((task) => task.id);
      const expectedCategoryTasks = new Set(expectedCategoryTaskIds);
      categoryStatistics[category] = summarizeWeightedRepeats(
        observations.filter((observation) =>
          expectedCategoryTasks.has(observation.taskId)
        ),
        expectedCategoryTaskIds
      ).statistics;
    }

    const reports = modelEvents.map((event) => event.report);
    const costs = reports.map((report) => report.metrics.costUsd);
    const everyCostKnown = costs.every((cost) => cost !== null);
    const totalCostUsd = everyCostKnown
      ? (costs as number[]).reduce((sum, cost) => sum + cost, 0)
      : null;
    const correctCount = reports.filter((report) => report.score === 1).length;

    return {
      modelId: model.id,
      label: model.label,
      provider: model.provider,
      score: totalWeight === 0 ? 0 : weightedScore / totalWeight,
      categories,
      scoreStatistics,
      categoryStatistics,
      metrics: {
        attemptCount: reports.length,
        avgTtftMs: average(reports.map((report) => report.metrics.ttftMs)),
        correctCount,
        costPerCorrectUsd:
          totalCostUsd === null || correctCount === 0
            ? null
            : totalCostUsd / correctCount,
        outputTokensPerSecond: average(
          reports.map((report) => report.metrics.outputTokensPerSecond)
        ),
        totalCostUsd
      }
    };
  });

  const completedAt =
    completed?.payload.type === "run.completed"
      ? completed.payload.completedAt
      : null;
  return ReportSchema.parse({
    schemaVersion: 1,
    scorerVersion: started.run.scorerVersion,
    generatedAt,
    run: {
      id: started.run.id,
      title: started.run.title,
      startedAt: started.run.startedAt,
      completedAt,
      modelCount: started.run.models.length,
      repeatCount: started.run.repeatCount,
      taskCount: started.run.tasks.length,
      concurrency: started.run.concurrency ?? 1,
      seed: started.run.seed ?? null
    },
    leaderboard,
    attempts,
    journalVerified: true,
    sandbox: {
      imageIds: [...imageIds].sort(),
      kind: "docker",
      network: "none"
    }
  });
}
