import type { BenchmarkCategory, Report } from "../../../src/contracts.js";

import {
  formatPercent,
  formatRate,
  formatSeconds,
  formatUsd,
  measuredLabel
} from "../report.js";
import { Icon } from "./Icon.js";

export type SortKey = "cost" | "model" | "score" | "speed" | "ttft";

export interface LeaderboardRow {
  cost: number | null;
  model: Report["leaderboard"][number];
  score: number | null;
  speed: number | null;
  ttft: number | null;
}

const CATEGORY_COLUMNS: Array<{ category: BenchmarkCategory; label: string }> = [
  { category: "debugging", label: "Debug" },
  { category: "security", label: "Security" },
  { category: "ui", label: "UI" },
  { category: "reasoning", label: "Reasoning" },
  { category: "hallucination", label: "Pushback" },
  { category: "context-recovery", label: "Recovery" }
];

function SortButton({
  active,
  children,
  onClick
}: {
  active: boolean;
  children: React.ReactNode;
  onClick: () => void;
}) {
  return (
    <button className={active ? "sort-button is-active" : "sort-button"} onClick={onClick} type="button">
      {children}
      <Icon name="sort" size={13} />
    </button>
  );
}

export function Leaderboard({
  onSelect,
  onSort,
  rows,
  selectedModelId,
  sortKey
}: {
  onSelect: (modelId: string) => void;
  onSort: (key: SortKey) => void;
  rows: LeaderboardRow[];
  selectedModelId: string;
  sortKey: SortKey;
}) {
  return (
    <div className="table-frame">
      <div className="table-scroll" tabIndex={0} aria-label="Scrollable leaderboard table">
        <table className="leaderboard-table">
          <thead>
            <tr>
              <th><SortButton active={sortKey === "model"} onClick={() => onSort("model")}>Model</SortButton></th>
              <th><SortButton active={sortKey === "score"} onClick={() => onSort("score")}>Score</SortButton></th>
              {CATEGORY_COLUMNS.map((column) => <th className="category-column" key={column.category}>{column.label}</th>)}
              <th><SortButton active={sortKey === "ttft"} onClick={() => onSort("ttft")}>TTFT <small>(s)</small></SortButton></th>
              <th><SortButton active={sortKey === "speed"} onClick={() => onSort("speed")}>Tok/s</SortButton></th>
              <th><SortButton active={sortKey === "cost"} onClick={() => onSort("cost")}>Cost</SortButton></th>
              <th><span className="sr-only">Open details</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const selected = row.model.modelId === selectedModelId;
              return (
                <tr className={selected ? "is-selected" : ""} key={row.model.modelId}>
                  <td>
                    <button
                      aria-pressed={selected}
                      className="model-select"
                      onClick={() => onSelect(row.model.modelId)}
                      type="button"
                    >
                      <span className="selection-ring" aria-hidden="true" />
                      <span>{row.model.label}</span>
                    </button>
                  </td>
                  <td className="score-cell">{formatPercent(row.score)}</td>
                  {CATEGORY_COLUMNS.map((column) => (
                    <td className="category-column" key={column.category}>
                      {formatPercent(row.model.categories[column.category])}
                    </td>
                  ))}
                  <td aria-label={measuredLabel(formatSeconds(row.ttft))}>{formatSeconds(row.ttft).replace("s", "")}</td>
                  <td aria-label={measuredLabel(formatRate(row.speed))}>{formatRate(row.speed)}</td>
                  <td aria-label={measuredLabel(formatUsd(row.cost))}>{formatUsd(row.cost)}</td>
                  <td><button aria-label={`Select ${row.model.label}`} className="row-arrow" onClick={() => onSelect(row.model.modelId)} type="button"><Icon name="chevron-right" size={17}/></button></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="table-footer">
        <span>{rows.length === 0 ? "0" : `1–${rows.length}`} of {rows.length}</span>
        <span>All models</span>
      </div>
    </div>
  );
}
