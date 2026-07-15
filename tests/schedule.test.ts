import { describe, expect, it } from "vitest";

import { scheduleAttemptJobs } from "../src/schedule.js";

const jobs = ["task-a", "task-b"].flatMap((taskId) =>
  [1, 2].flatMap((repeat) =>
    ["model-a", "model-b", "model-c"].map((modelId) => ({ modelId, repeat, taskId }))
  )
);

describe("scheduleAttemptJobs", () => {
  it("creates deterministic task-repeat blocks with one job per model", () => {
    const scheduled = scheduleAttemptJobs(jobs, 42);

    expect(scheduleAttemptJobs(jobs, 42)).toEqual(scheduled);
    expect(scheduleAttemptJobs(jobs, 73)).not.toEqual(scheduled);
    for (let index = 0; index < scheduled.length; index += 3) {
      const block = scheduled.slice(index, index + 3);
      expect(new Set(block.map((job) => `${job.taskId}:${job.repeat}`))).toHaveLength(1);
      expect(new Set(block.map((job) => job.modelId))).toEqual(
        new Set(["model-a", "model-b", "model-c"])
      );
    }
  });

  it("keeps the relative schedule when completed jobs are removed for resume", () => {
    const scheduled = scheduleAttemptJobs(jobs, 42);
    const completed = new Set([
      `${scheduled[1]?.taskId}:${scheduled[1]?.modelId}:${scheduled[1]?.repeat}`,
      `${scheduled[7]?.taskId}:${scheduled[7]?.modelId}:${scheduled[7]?.repeat}`
    ]);
    const remaining = scheduleAttemptJobs(
      jobs,
      42,
      (job) => completed.has(`${job.taskId}:${job.modelId}:${job.repeat}`)
    );

    expect(remaining).toEqual(scheduled.filter((job) => !completed.has(
      `${job.taskId}:${job.modelId}:${job.repeat}`
    )));
  });
});
