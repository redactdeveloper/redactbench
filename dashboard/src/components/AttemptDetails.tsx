import type { AttemptReport } from "../../../src/contracts.js";

import { formatPercent, formatRate, formatSeconds, formatUsd } from "../report.js";
import { Icon } from "./Icon.js";

export type DetailTab = "attempts" | "checks";

function Status({ status }: { status: AttemptReport["status"] | AttemptReport["checks"][number]["status"] }) {
  const passed = status === "passed";
  return (
    <span className={`status status--${status}`}>
      <Icon name={passed ? "check" : "warning"} size={13}/>
      {status}
    </span>
  );
}

export function AttemptDetails({
  attempts,
  modelLabel,
  onTabChange,
  tab
}: {
  attempts: AttemptReport[];
  modelLabel: string;
  onTabChange: (tab: DetailTab) => void;
  tab: DetailTab;
}) {
  const checks = attempts.flatMap((attempt) =>
    attempt.checks.map((check) => ({ attempt, check }))
  );

  return (
    <section className="attempt-details" id="details">
      <h2>{modelLabel} — Attempt details</h2>
      <div className="detail-tabs" role="tablist" aria-label="Attempt detail view">
        <button aria-selected={tab === "attempts"} onClick={() => onTabChange("attempts")} role="tab" type="button">Attempts</button>
        <button aria-selected={tab === "checks"} onClick={() => onTabChange("checks")} role="tab" type="button">Hidden checks</button>
      </div>
      <div className="detail-table-wrap">
        {tab === "attempts" ? (
          <table className="detail-table">
            <thead><tr><th>Task</th><th>Status</th><th>Score</th><th>TTFT</th><th>Tok/s</th><th>Cost</th></tr></thead>
            <tbody>
              {attempts.map((attempt) => (
                <tr key={attempt.attemptId}>
                  <td>{attempt.taskTitle}</td>
                  <td><Status status={attempt.status}/></td>
                  <td>{formatPercent(attempt.score)}</td>
                  <td>{formatSeconds(attempt.metrics.ttftMs)}</td>
                  <td>{formatRate(attempt.metrics.outputTokensPerSecond)}</td>
                  <td>{formatUsd(attempt.metrics.costUsd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <table className="detail-table detail-table--checks">
            <thead><tr><th>Task</th><th>Check</th><th>Status</th><th>Time</th><th>Evidence</th></tr></thead>
            <tbody>
              {checks.map(({ attempt, check }) => (
                <tr key={`${attempt.attemptId}:${check.id}`}>
                  <td>{attempt.taskTitle}</td>
                  <td>{check.label ?? check.id}</td>
                  <td><Status status={check.status}/></td>
                  <td>{formatSeconds(check.durationMs)}</td>
                  <td className="evidence-cell">{check.output || "No output"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
