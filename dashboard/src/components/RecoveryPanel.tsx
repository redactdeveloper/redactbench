import type { AttemptReport } from "../../../src/contracts.js";

import { formatSeconds } from "../report.js";
import { Icon } from "./Icon.js";

export function RecoveryPanel({
  attempt,
  onViewChecks
}: {
  attempt: AttemptReport | undefined;
  onViewChecks: () => void;
}) {
  const recovery = attempt?.contextRecovery;
  if (!attempt || !recovery) {
    return (
      <section className="recovery-panel" id="recovery">
        <h2>Context Recovery</h2>
        <p className="empty-copy">No recovery attempt was measured for this model.</p>
      </section>
    );
  }

  const totalChecks = attempt.checks.length;
  return (
    <section className="recovery-panel" id="recovery">
      <div className="section-heading-row">
        <h2>Context Recovery</h2>
        {recovery.rollbackDetected ? <span className="warning-label"><Icon name="warning" size={15}/> Rollback detected</span> : null}
      </div>
      <div className="recovery-track" aria-label="Context recovery phases">
        <div className="track-line" aria-hidden="true"><span /><i /><span /></div>
        {[
          ["Phase 1", "check"],
          ["Context reset", "reset"],
          ["Phase 2", "check"],
          ["Hidden checks", recovery.checksPassed === totalChecks ? "check" : "warning"]
        ].map(([label, state]) => (
          <div className="track-step" key={label}>
            <span className={`track-marker track-marker--${state}`}>
              {state === "check" ? <Icon name="check" size={15}/> : state === "warning" ? <Icon name="warning" size={14}/> : null}
            </span>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <dl className="recovery-metrics">
        <div><Icon name="file"/><dt>Notes preserved</dt><dd>{recovery.notesPreserved ? `${recovery.notesTotal} words` : "No"}</dd></div>
        <div><Icon name="code"/><dt>Duplicate edits</dt><dd>{recovery.duplicateEdits}</dd></div>
        <div><Icon name="shield"/><dt>Checks passed</dt><dd>{recovery.checksPassed} / {totalChecks}</dd></div>
        <div><Icon name="clock"/><dt>Recovery</dt><dd>{formatSeconds(recovery.recoveryMs)}</dd></div>
      </dl>
      <button className="secondary-action" onClick={onViewChecks} type="button">
        <Icon name="file" size={18}/>
        View recovery checks
        <Icon name="chevron-right" size={17}/>
      </button>
    </section>
  );
}
