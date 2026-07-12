import type { ReportScoreStatistics } from "../../../src/contracts.js";

import { formatPercent } from "../report.js";

export function ReliabilityNote({
  statistics
}: {
  statistics: ReportScoreStatistics;
}) {
  let detail: string;
  if (statistics.confidence95) {
    detail = [
      `n=${statistics.sampleCount} complete repeats`,
      `95% CI ${formatPercent(statistics.confidence95.lower)}–${formatPercent(statistics.confidence95.upper)}`,
      `SD ${((statistics.standardDeviation ?? 0) * 100).toFixed(1)} pp`
    ].join(" · ");
  } else if (statistics.sampleCount === 1) {
    detail = "n=1 complete repeat · use --repeat 3+ to estimate uncertainty";
  } else {
    detail = "No complete repeats · uncertainty unavailable";
  }

  return (
    <section aria-label="Repeat reliability" className="reliability-note">
      <b>Repeat reliability</b>
      <span>{detail}</span>
    </section>
  );
}
