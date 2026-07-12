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

    expect(screen.getByRole("heading", { level: 1 }).textContent).toContain("Run 2026-07-11 / demo");
    expect(screen.getByLabelText("Overall score: 100.0%")).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Fixture Fast" }));

    expect(screen.getByLabelText("Overall score: 62.2%")).toBeTruthy();
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
