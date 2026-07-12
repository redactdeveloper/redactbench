import { useMemo, useState } from "react";

import type {
  BenchmarkField,
  HarnessName
} from "../../../src/field-contracts.js";
import {
  HARNESS_LABELS,
  PROVIDER_LABELS
} from "../field.js";

type HarnessFilter = "all" | HarnessName;

export function TargetField({ field }: { field: BenchmarkField }) {
  const [harness, setHarness] = useState<HarnessFilter>("all");
  const harnesses = useMemo(
    () => [...new Set(field.entrants.map((entrant) => entrant.harness))],
    [field]
  );
  const entrants = useMemo(
    () => field.entrants.filter((entrant) => harness === "all" || entrant.harness === harness),
    [field, harness]
  );

  return (
    <section aria-labelledby="target-field-title" className="target-field" id="field">
      <div className="field-hero">
        <div>
          <p className="field-kicker">Next verified run</p>
          <h1 id="target-field-title">{field.title}</h1>
          {field.description ? <p className="field-description">{field.description}</p> : null}
        </div>
        <dl aria-label="Target field summary" className="field-summary">
          <div><dt>Entrants</dt><dd>{field.entrants.length}</dd></div>
          <div><dt>Harnesses</dt><dd>{harnesses.length}</dd></div>
          <div><dt>Runtime</dt><dd>Docker</dd></div>
        </dl>
      </div>

      <div className="field-toolbar">
        <div>
          <h2>Entrants</h2>
          <p>Scores appear only after a complete, journal-verified run.</p>
        </div>
        <label className="field-filter">
          <span className="sr-only">Filter by harness</span>
          <select
            aria-label="Harness filter"
            onChange={(event) => setHarness(event.target.value as HarnessFilter)}
            value={harness}
          >
            <option value="all">All harnesses</option>
            {harnesses.map((name) => (
              <option key={name} value={name}>{HARNESS_LABELS[name]}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="table-frame field-table-frame">
        <div className="table-scroll">
          <table aria-label="Target benchmark entrants" className="target-field-table">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">Model profile</th>
                <th scope="col">Provider</th>
                <th scope="col">Harness</th>
                <th scope="col">Execution</th>
                <th scope="col">Result</th>
              </tr>
            </thead>
            <tbody>
              {entrants.map((entrant) => (
                <tr key={entrant.id}>
                  <td>{String(entrant.order).padStart(2, "0")}</td>
                  <th scope="row">{entrant.displayName}</th>
                  <td>{PROVIDER_LABELS[entrant.provider]}</td>
                  <td><span className="field-badge">{HARNESS_LABELS[entrant.harness]}</span></td>
                  <td><span className="docker-label"><span aria-hidden="true" />Docker</span></td>
                  <td><span className="field-status">Not run</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="table-footer">
          <span>{entrants.length} of {field.entrants.length} entrants</span>
          <span>Results withheld until verification</span>
        </div>
      </div>
    </section>
  );
}
