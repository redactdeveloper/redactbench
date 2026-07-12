// @vitest-environment jsdom

import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";

import reportData from "../dashboard/public/report.json";
import { Dashboard } from "../dashboard/src/App.js";
import { ReportSchema } from "../src/contracts.js";

const report = ReportSchema.parse(reportData);

afterEach(() => {
  document.body.innerHTML = "";
});

describe("dashboard", () => {
  it("renders report-derived values and changes the selected model", async () => {
    const user = userEvent.setup();
    render(<Dashboard initialReport={report} />);

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Run 2026-07-12 / demo");
    expect(screen.getByLabelText("Overall score: 100.0%")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Fixture Fast" }));

    expect(screen.getByLabelText("Overall score: 59.1%")).toBeTruthy();
    expect(screen.getByRole("heading", { name: /Fixture Fast — Attempt details/ })).toBeTruthy();
  });

  it("filters scores and switches to hidden check evidence", async () => {
    const user = userEvent.setup();
    render(<Dashboard initialReport={report} />);

    await user.click(screen.getByRole("button", { name: "Fixture Fast" }));
    await user.selectOptions(screen.getByLabelText("Category filter"), "context-recovery");
    expect(screen.getByLabelText("Overall score: 66.7%")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Hidden checks" }));
    const details = document.querySelector("#details");
    expect(details).not.toBeNull();
    expect(within(details as HTMLElement).getByText("Parses valid ports")).toBeTruthy();
  });

  it("preserves task weights when filters recalculate a score", async () => {
    const user = userEvent.setup();
    const weighted = structuredClone(report);
    const debug = weighted.attempts.find(
      (attempt) => attempt.modelId === "fixture-fast" && attempt.category === "debugging"
    )!;
    const pushback = weighted.attempts.find(
      (attempt) => attempt.modelId === "fixture-fast" && attempt.category === "hallucination"
    )!;
    debug.score = 1;
    debug.taskWeight = 1;
    pushback.category = "debugging";
    pushback.score = 0;
    pushback.taskWeight = 3;
    delete weighted.leaderboard.find(
      (model) => model.modelId === "fixture-fast"
    )!.categoryStatistics.debugging;

    render(<Dashboard initialReport={weighted} />);
    await user.click(screen.getByRole("button", { name: "Fixture Fast" }));
    await user.selectOptions(screen.getByLabelText("Category filter"), "debugging");

    expect(screen.getByLabelText("Overall score: 25.0%")).toBeTruthy();
  });

  it("shows repeat uncertainty and the run conditions that affect comparisons", () => {
    const repeated = structuredClone(report);
    repeated.run.repeatCount = 3;
    repeated.run.concurrency = 2;
    repeated.run.seed = 73;
    repeated.leaderboard[0]!.scoreStatistics = {
      confidence95: { lower: 0.9, upper: 1 },
      sampleCount: 3,
      standardDeviation: 0.04,
      standardError: 0.04 / Math.sqrt(3)
    };

    render(<Dashboard initialReport={repeated} />);

    expect(screen.getByLabelText("Repeat reliability").textContent).toContain(
      "n=3 complete repeats · 95% CI 90.0%–100.0% · SD 4.0 pp"
    );
    expect(screen.getByText(/R3 · C2 · SEED 73/)).toBeTruthy();
  });

  it("opens CLI instructions and closes them with Escape", async () => {
    const user = userEvent.setup();
    render(<Dashboard initialReport={report} />);

    await user.click(screen.getByRole("button", { name: "New run" }));
    expect(screen.getByRole("dialog", { name: "Start a new run" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders untrusted labels as text, never markup", () => {
    const unsafe = structuredClone(report);
    unsafe.leaderboard[0]!.label = "<img src=x onerror=alert(1)>";

    render(<Dashboard initialReport={unsafe} />);

    expect(screen.getByText("<img src=x onerror=alert(1)>")).toBeTruthy();
    expect(document.querySelector("img")).toBeNull();
  });

  it("keeps unknown costs unknown instead of displaying a partial total", () => {
    const partialCost = structuredClone(report);
    partialCost.attempts.find((attempt) => attempt.modelId === "fixture-strong")!.metrics.costUsd = null;

    render(<Dashboard initialReport={partialCost} />);

    expect(screen.getByLabelText("Total cost: Not measured")).toBeTruthy();
  });

  it("sorts unmeasured filtered scores after measured models", async () => {
    const user = userEvent.setup();
    const missingRecovery = structuredClone(report);
    missingRecovery.attempts = missingRecovery.attempts.filter(
      (attempt) => !(attempt.modelId === "fixture-cautious" && attempt.category === "context-recovery")
    );
    render(<Dashboard initialReport={missingRecovery} />);

    await user.selectOptions(screen.getByLabelText("Category filter"), "context-recovery");

    const modelButtons = screen.getAllByRole("button", { name: /^Fixture (?:Strong|Fast|Cautious)$/ });
    expect(modelButtons[0]?.textContent).toContain("Fixture Strong");
    expect(modelButtons.at(-1)?.textContent).toContain("Fixture Cautious");
  });
});
