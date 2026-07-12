export interface WeightedScore {
  score: number;
  weight: number;
}

export interface RepeatScoreObservation extends WeightedScore {
  repeat: number;
  taskId: string;
}

export interface ScoreStatistics {
  confidence95: { lower: number; upper: number } | null;
  sampleCount: number;
  standardDeviation: number | null;
  standardError: number | null;
}

export interface RepeatScoreSummary {
  mean: number | null;
  repeatScores: number[];
  statistics: ScoreStatistics;
}

// Two-sided 95% critical values from the NIST/SEMATECH t-distribution table.
// For degrees of freedom between published rows, the lower row is selected so
// the resulting interval is conservatively wider.
// https://www.itl.nist.gov/div898/handbook/eda/section3/eda3672.htm
const T95_CRITICAL_VALUES = [
  [1, 12.706],
  [2, 4.303],
  [3, 3.182],
  [4, 2.776],
  [5, 2.571],
  [6, 2.447],
  [7, 2.365],
  [8, 2.306],
  [9, 2.262],
  [10, 2.228],
  [11, 2.201],
  [12, 2.179],
  [13, 2.16],
  [14, 2.145],
  [15, 2.131],
  [16, 2.12],
  [17, 2.11],
  [18, 2.101],
  [19, 2.093],
  [20, 2.086],
  [21, 2.08],
  [22, 2.074],
  [23, 2.069],
  [24, 2.064],
  [25, 2.06],
  [26, 2.056],
  [27, 2.052],
  [28, 2.048],
  [29, 2.045],
  [30, 2.042],
  [40, 2.021],
  [60, 2],
  [120, 1.98],
  [1_000, 1.962]
] as const;

function t95CriticalValue(degreesOfFreedom: number): number {
  let critical: number = T95_CRITICAL_VALUES[0][1];
  for (const [publishedDegrees, publishedCritical] of T95_CRITICAL_VALUES) {
    if (publishedDegrees > degreesOfFreedom) {
      break;
    }
    critical = publishedCritical;
  }
  return degreesOfFreedom > 1_000 ? 1.96 : critical;
}

export function weightedMean(values: readonly WeightedScore[]): number | null {
  const totalWeight = values.reduce((sum, value) => sum + value.weight, 0);
  if (totalWeight === 0) {
    return null;
  }
  return (
    values.reduce((sum, value) => sum + value.score * value.weight, 0) /
    totalWeight
  );
}

export function scoreStatistics(values: readonly number[]): ScoreStatistics {
  const sampleCount = values.length;
  if (sampleCount < 2) {
    return {
      confidence95: null,
      sampleCount,
      standardDeviation: null,
      standardError: null
    };
  }

  const identical = values.every((value) => value === values[0]);
  const mean = identical
    ? values[0]!
    : values.reduce((sum, value) => sum + value, 0) / sampleCount;
  const variance = identical
    ? 0
    : values.reduce((sum, value) => sum + (value - mean) ** 2, 0) /
      (sampleCount - 1);
  const standardDeviation = Math.sqrt(variance);
  const standardError = standardDeviation / Math.sqrt(sampleCount);
  // NIST mean confidence interval: mean ± t(1-alpha/2, n-1) × s/√n.
  // https://www.itl.nist.gov/div898/handbook/eda/section3/eda352.htm
  const margin = t95CriticalValue(sampleCount - 1) * standardError;

  return {
    confidence95: {
      lower: Math.max(0, mean - margin),
      upper: Math.min(1, mean + margin)
    },
    sampleCount,
    standardDeviation,
    standardError
  };
}

export function summarizeWeightedRepeats(
  observations: readonly RepeatScoreObservation[],
  expectedTaskIds: readonly string[]
): RepeatScoreSummary {
  const expected = new Set(expectedTaskIds);
  const byRepeat = new Map<number, Map<string, WeightedScore>>();

  for (const observation of observations) {
    if (!expected.has(observation.taskId)) {
      continue;
    }
    const tasks = byRepeat.get(observation.repeat) ?? new Map<string, WeightedScore>();
    tasks.set(observation.taskId, observation);
    byRepeat.set(observation.repeat, tasks);
  }

  const repeatScores = [...byRepeat.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([, tasks]) => {
      if (expected.size === 0 || [...expected].some((taskId) => !tasks.has(taskId))) {
        return [];
      }
      const score = weightedMean([...expected].map((taskId) => tasks.get(taskId)!));
      return score === null ? [] : [score];
    });

  return {
    mean:
      repeatScores.length === 0
        ? null
        : repeatScores.reduce((sum, score) => sum + score, 0) /
          repeatScores.length,
    repeatScores,
    statistics: scoreStatistics(repeatScores)
  };
}
