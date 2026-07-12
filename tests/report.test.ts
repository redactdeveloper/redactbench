import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { reportCommand } from "../src/commands/report.js";
import { Journal } from "../src/journal.js";

describe("report command", () => {
  it("packages the dashboard assets with a verified report", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-report-"));
    const dashboard = join(root, "dashboard");
    const output = join(root, "report");
    await mkdir(join(dashboard, "assets"), { recursive: true });
    await mkdir(join(output, "assets"), { recursive: true });
    await writeFile(join(dashboard, "index.html"), "<!doctype html><title>RedactBench</title>");
    await writeFile(join(dashboard, "assets", "app.js"), "export {};\n");
    await writeFile(join(output, "assets", "stale.js"), "stale\n");

    const journalFile = join(root, "journal.jsonl");
    const journal = await Journal.open(journalFile, { now: () => Date.parse("2026-07-12T00:00:00Z") });
    await journal.append({
      type: "run.started",
      configHash: "a".repeat(64),
      run: {
        id: "demo",
        title: "Demo",
        suiteId: "demo",
        scorerVersion: "1.0.0",
        startedAt: "2026-07-12T00:00:00.000Z",
        repeatCount: 1,
        models: [{ id: "fixture", label: "Fixture", model: "fixture-v1", provider: "fixture" }],
        tasks: [{ category: "debugging", id: "debug", title: "Debug", weight: 1 }]
      }
    });

    const result = await reportCommand(
      journalFile,
      output,
      "2026-07-12T00:00:01.000Z",
      dashboard
    );

    expect(await readFile(join(output, "index.html"), "utf8")).toContain("RedactBench");
    expect(await readFile(join(output, "assets", "app.js"), "utf8")).toContain("export");
    await expect(readFile(join(output, "assets", "stale.js"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect(JSON.parse(await readFile(result.file, "utf8"))).toMatchObject({
      journalVerified: true,
      run: { id: "demo" }
    });
  });

  it("rejects an output symlink before modifying its target", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-report-link-"));
    const dashboard = join(root, "dashboard");
    const target = join(root, "target");
    const output = join(root, "output-link");
    await mkdir(join(dashboard, "assets"), { recursive: true });
    await mkdir(join(target, "assets"), { recursive: true });
    await writeFile(join(dashboard, "index.html"), "dashboard");
    await writeFile(join(target, "index.html"), "target sentinel");
    await writeFile(join(target, "assets", "sentinel.js"), "sentinel");
    await symlink(target, output, "dir");

    const journalFile = join(root, "journal.jsonl");
    const journal = await Journal.open(journalFile);
    await journal.append({
      type: "run.started",
      configHash: "b".repeat(64),
      run: {
        id: "demo",
        title: "Demo",
        suiteId: "demo",
        scorerVersion: "1.0.0",
        startedAt: "2026-07-12T00:00:00.000Z",
        repeatCount: 1,
        models: [],
        tasks: []
      }
    });

    await expect(
      reportCommand(journalFile, output, "2026-07-12T00:00:01.000Z", dashboard)
    ).rejects.toMatchObject({ code: "CONFIG_INVALID" });
    expect(await readFile(join(target, "index.html"), "utf8")).toBe("target sentinel");
    expect(await readFile(join(target, "assets", "sentinel.js"), "utf8")).toBe("sentinel");
  });
});
