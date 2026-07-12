import { describe, expect, it } from "vitest";

import {
  scoreStatistics,
  summarizeWeightedRepeats,
  weightedMean
} from "../src/statistics.js";

describe("weightedMean", () => {
  it("preserves suite task weights", () => {
    expect(
      weightedMean([
        { score: 1, weight: 1 },
        { score: 0, weight: 3 }
      ])
    ).toBe(0.25);
    expect(weightedMean([])).toBeNull();
  });
});

describe("scoreStatistics", () => {
  it("uses a two-sided 95% Student-t interval for repeat scores", () => {
    const result = scoreStatistics([0.4, 0.5, 0.6]);

    expect(result.sampleCount).toBe(3);
    expect(result.standardDeviation).toBeCloseTo(0.1, 12);
    expect(result.standardError).toBeCloseTo(0.1 / Math.sqrt(3), 12);
    expect(result.confidence95?.lower).toBeCloseTo(0.251567, 5);
    expect(result.confidence95?.upper).toBeCloseTo(0.748433, 5);
  });

  it("does not invent uncertainty from a single repeat", () => {
    expect(scoreStatistics([0.75])).toEqual({
      confidence95: null,
      sampleCount: 1,
      standardDeviation: null,
      standardError: null
    });
  });

  it("returns a zero-width interval when repeated scores do not vary", () => {
    expect(scoreStatistics([0.7, 0.7, 0.7])).toEqual({
      confidence95: { lower: 0.7, upper: 0.7 },
      sampleCount: 3,
      standardDeviation: 0,
      standardError: 0
    });
  });
});

describe("summarizeWeightedRepeats", () => {
  it("includes only complete repeats and weights every task", () => {
    const result = summarizeWeightedRepeats(
      [
        { repeat: 1, score: 1, taskId: "small", weight: 1 },
        { repeat: 1, score: 0, taskId: "large", weight: 3 },
        { repeat: 2, score: 0, taskId: "small", weight: 1 },
        { repeat: 2, score: 1, taskId: "large", weight: 3 },
        { repeat: 3, score: 1, taskId: "small", weight: 1 }
      ],
      ["small", "large"]
    );

    expect(result.repeatScores).toEqual([0.25, 0.75]);
    expect(result.mean).toBe(0.5);
    expect(result.statistics.sampleCount).toBe(2);
  });

  it("returns an explicit empty summary without complete repeats", () => {
    expect(
      summarizeWeightedRepeats(
        [{ repeat: 1, score: 1, taskId: "small", weight: 1 }],
        ["small", "large"]
      )
    ).toEqual({
      mean: null,
      repeatScores: [],
      statistics: {
        confidence95: null,
        sampleCount: 0,
        standardDeviation: null,
        standardError: null
      }
    });
  });
});
