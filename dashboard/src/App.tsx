import { useEffect, useMemo, useRef, useState } from "react";

import type {
  BenchmarkCategory,
  Report,
  ReportScoreStatistics
} from "../../src/contracts.js";
import {
  summarizeWeightedRepeats,
  weightedMean
} from "../../src/statistics.js";
import { VERSION } from "../../src/version.js";

import { AttemptDetails, type DetailTab } from "./components/AttemptDetails.js";
import { Icon } from "./components/Icon.js";
import { Leaderboard, type LeaderboardRow, type SortKey } from "./components/Leaderboard.js";
import { RecoveryPanel } from "./components/RecoveryPanel.js";
import { ReliabilityNote } from "./components/ReliabilityNote.js";
import { SummaryStrip } from "./components/SummaryStrip.js";
import {
  CATEGORY_LABELS,
  formatPercent,
  formatRate,
  formatSeconds,
  formatUsd,
  loadReport,
  parseLocalReport
} from "./report.js";

type CategoryFilter = "all" | BenchmarkCategory;

const NAV_ITEMS = [
  ["Overview", "home", "#overview"],
  ["Runs", "list", "#overview"],
  ["Tasks", "code", "#leaderboard"],
  ["Models", "cube", "#leaderboard"],
  ["Methodology", "book", "#status"]
] as const;

function average(values: Array<number | null>): number | null {
  const measured = values.filter((value): value is number => value !== null);
  return measured.length === 0 ? null : measured.reduce((sum, value) => sum + value, 0) / measured.length;
}

function totalKnownCost(attempts: Report["attempts"]): number | null {
  if (attempts.length === 0 || attempts.some((attempt) => attempt.metrics.costUsd === null)) {
    return null;
  }
  return attempts.reduce((sum, attempt) => sum + (attempt.metrics.costUsd ?? 0), 0);
}

function filteredScoreSummary(
  attempts: Report["attempts"],
  expectedTaskIds: readonly string[]
): { score: number | null; statistics: ReportScoreStatistics } {
  const observations = attempts.map((attempt) => ({
    repeat: attempt.repeat,
    score: attempt.score,
    taskId: attempt.taskId,
    weight: attempt.taskWeight
  }));
  const repeatSummary = summarizeWeightedRepeats(
    observations,
    expectedTaskIds
  );
  return {
    score:
      repeatSummary.mean ??
      weightedMean(
        observations.map((observation) => ({
          score: observation.score,
          weight: observation.weight
        }))
      ),
    statistics: repeatSummary.statistics
  };
}

function categoryScoreSummary(
  model: Report["leaderboard"][number],
  category: BenchmarkCategory
): { score: number | null; statistics: ReportScoreStatistics } | null {
  const score = model.categories[category];
  const statistics = model.categoryStatistics[category];
  return score === undefined || statistics === undefined
    ? null
    : { score, statistics };
}

function runLabel(report: Report): string {
  const day = report.run.startedAt.slice(0, 10);
  return `Run ${day} / ${report.run.id}`;
}

function downloadReport(report: Report): void {
  const blob = new Blob([`${JSON.stringify(report, null, 2)}\n`], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `${report.run.id}-report.json`;
  anchor.click();
  URL.revokeObjectURL(url);
}

function NewRunDialog({ onClose }: { onClose: () => void }) {
  const closeButton = useRef<HTMLButtonElement>(null);
  const command = "npm run redactbench -- run --suite benchmarks/demo/suite.yaml --models models.yaml --run-id <id>";
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    closeButton.current?.focus();
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  async function copyCommand() {
    await navigator.clipboard?.writeText(command);
    setCopied(true);
  }

  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="new-run-title" aria-modal="true" className="run-dialog" role="dialog">
        <button aria-label="Close new run instructions" className="icon-button dialog-close" onClick={onClose} ref={closeButton} type="button">
          <Icon name="x" />
        </button>
        <p className="dialog-kicker">CLI workflow</p>
        <h2 id="new-run-title">Start a new run</h2>
        <p>Configure direct provider models, then run the benchmark from this repository. The generated report can be loaded here.</p>
        <code>{command}</code>
        <button className="secondary-action dialog-copy" onClick={copyCommand} type="button">
          <Icon name="code" size={18} />
          {copied ? "Copied" : "Copy command"}
        </button>
      </section>
    </div>
  );
}

function LoadingState() {
  return <main className="state-screen"><span className="state-mark">R3</span><p>Loading verified report…</p></main>;
}

function ErrorState({ message }: { message: string }) {
  return (
    <main className="state-screen state-screen--error">
      <span className="state-mark">R3</span>
      <h1>Report unavailable</h1>
      <p>{message}</p>
      <p>Generate it with <code>npm run bench:report</code> or load a valid report JSON.</p>
    </main>
  );
}

export function Dashboard({ initialReport }: { initialReport?: Report }) {
  const [report, setReport] = useState<Report | null>(initialReport ?? null);
  const [error, setError] = useState<string | null>(null);
  const [selectedModelId, setSelectedModelId] = useState(initialReport?.leaderboard[0]?.modelId ?? "");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [taskId, setTaskId] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [detailTab, setDetailTab] = useState<DetailTab>("attempts");
  const [showNewRun, setShowNewRun] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    if (initialReport) return;
    let cancelled = false;
    loadReport()
      .then((nextReport) => {
        if (cancelled) return;
        setReport(nextReport);
        setSelectedModelId(nextReport.leaderboard[0]?.modelId ?? "");
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : "Unknown report error");
      });
    return () => { cancelled = true; };
  }, [initialReport]);

  const tasks = useMemo(() => {
    if (!report) return [];
    return Array.from(new Map(report.attempts.map((attempt) => [attempt.taskId, attempt.taskTitle])).entries());
  }, [report]);

  const filteredAttempts = useMemo(() => {
    if (!report) return [];
    return report.attempts.filter((attempt) =>
      (category === "all" || attempt.category === category) &&
      (taskId === "all" || attempt.taskId === taskId)
    );
  }, [category, report, taskId]);

  const expectedFilteredTaskIds = useMemo(
    () =>
      taskId === "all"
        ? [...new Set(filteredAttempts.map((attempt) => attempt.taskId))]
        : [taskId],
    [filteredAttempts, taskId]
  );

  const rows = useMemo<LeaderboardRow[]>(() => {
    if (!report) return [];
    const isFiltered = category !== "all" || taskId !== "all";
    const nextRows = report.leaderboard.map((model) => {
      const attempts = filteredAttempts.filter((attempt) => attempt.modelId === model.modelId);
      let score: number | null = model.score;
      let statistics = model.scoreStatistics;
      if (isFiltered) {
        const categorySummary =
          category !== "all" && taskId === "all"
            ? categoryScoreSummary(model, category)
            : null;
        const summary =
          categorySummary ??
          filteredScoreSummary(attempts, expectedFilteredTaskIds);
        score = summary.score;
        statistics = summary.statistics;
      }
      return {
        model,
        score,
        statistics,
        ttft: isFiltered ? average(attempts.map((attempt) => attempt.metrics.ttftMs)) : model.metrics.avgTtftMs,
        speed: isFiltered ? average(attempts.map((attempt) => attempt.metrics.outputTokensPerSecond)) : model.metrics.outputTokensPerSecond,
        cost: isFiltered ? totalKnownCost(attempts) : model.metrics.totalCostUsd
      };
    });
    const compare = (left: LeaderboardRow, right: LeaderboardRow) => {
      const direction = sortDirection === "asc" ? 1 : -1;
      if (sortKey === "model") return left.model.label.localeCompare(right.model.label) * direction;
      const leftValue = left[sortKey];
      const rightValue = right[sortKey];
      if (leftValue === null) return rightValue === null ? 0 : 1;
      if (rightValue === null) return -1;
      return (leftValue - rightValue) * direction;
    };
    return nextRows.sort(compare);
  }, [category, expectedFilteredTaskIds, filteredAttempts, report, sortDirection, sortKey, taskId]);

  if (error) return <ErrorState message={error} />;
  if (!report) return <LoadingState />;

  const selectedModel = report.leaderboard.find((model) => model.modelId === selectedModelId) ?? report.leaderboard[0];
  if (!selectedModel) return <ErrorState message="The report contains no model results." />;

  const selectedAttempts = filteredAttempts.filter((attempt) => attempt.modelId === selectedModel.modelId);
  const selectedRow = rows.find((row) => row.model.modelId === selectedModel.modelId);
  const summaryScore = selectedRow?.score ?? null;
  const summaryStatistics = selectedRow?.statistics ?? selectedModel.scoreStatistics;
  const summaryTtft = category === "all" && taskId === "all"
    ? selectedModel.metrics.avgTtftMs
    : average(selectedAttempts.map((attempt) => attempt.metrics.ttftMs));
  const summarySpeed = category === "all" && taskId === "all"
    ? selectedModel.metrics.outputTokensPerSecond
    : average(selectedAttempts.map((attempt) => attempt.metrics.outputTokensPerSecond));
  const summaryCost = totalKnownCost(selectedAttempts);
  const passedCount = selectedAttempts.filter((attempt) => attempt.status === "passed").length;
  const costPerCorrect = summaryCost === null || passedCount === 0 ? null : summaryCost / passedCount;
  const recoveryAttempt = report.attempts.find(
    (attempt) => attempt.modelId === selectedModel.modelId && attempt.category === "context-recovery"
  );

  function handleSort(nextKey: SortKey) {
    if (sortKey === nextKey) {
      setSortDirection((direction) => direction === "desc" ? "asc" : "desc");
      return;
    }
    setSortKey(nextKey);
    setSortDirection(nextKey === "model" ? "asc" : "desc");
  }

  async function importReport(file: File | undefined) {
    if (!file) return;
    try {
      const nextReport = parseLocalReport(JSON.parse(await file.text()) as unknown);
      setReport(nextReport);
      setSelectedModelId(nextReport.leaderboard[0]?.modelId ?? "");
      setCategory("all");
      setTaskId("all");
      setError(null);
    } catch (cause: unknown) {
      setError(cause instanceof Error ? `Invalid report: ${cause.message}` : "Invalid report");
    }
  }

  function showChecks() {
    setDetailTab("checks");
    requestAnimationFrame(() => document.querySelector("#details")?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }

  return (
    <div className="app-shell">
      <aside className={menuOpen ? "sidebar is-open" : "sidebar"} aria-label="Primary navigation">
        <a className="brand" href="#overview" onClick={() => setMenuOpen(false)}><span>R3</span><b>REDACTBENCH</b></a>
        <nav>
          {NAV_ITEMS.map(([label, icon, href], index) => (
            <a className={index === 0 ? "is-active" : ""} href={href} key={label} onClick={() => setMenuOpen(false)}>
              <Icon name={icon} />{label}
            </a>
          ))}
        </nav>
        <div className="sidebar-foot"><Icon name="clock" size={18}/><span>Dark</span></div>
      </aside>

      <header className="mobile-header">
        <button aria-expanded={menuOpen} aria-label="Toggle navigation" className="icon-button" onClick={() => setMenuOpen((open) => !open)} type="button"><Icon name={menuOpen ? "x" : "menu"} size={28}/></button>
        <a className="brand" href="#overview"><span>R3</span><b>REDACTBENCH</b></a>
      </header>

      <div className="workspace">
        <header className="run-toolbar">
          <label className="run-picker">
            <span>{runLabel(report)}</span><Icon name="chevron-down" size={16}/>
            <input accept="application/json,.json" aria-label="Load report JSON" onChange={(event) => void importReport(event.target.files?.[0])} type="file" />
          </label>
          <button className="primary-action" onClick={() => setShowNewRun(true)} type="button"><Icon name="plus" size={21}/>New run</button>
        </header>

        <main id="overview">
          <section className="run-heading">
            <h1>{runLabel(report)}</h1>
            <p>{report.run.modelCount} MODELS <i>·</i> {report.run.taskCount} TASKS <i>·</i> R{report.run.repeatCount} · C{report.run.concurrency} · SEED {report.run.seed ?? "—"} <i>·</i> SCORER v{report.scorerVersion.split(".")[0]}</p>
          </section>

          <SummaryStrip items={[
            { label: "Overall score", value: formatPercent(summaryScore) },
            { label: "Avg TTFT", value: formatSeconds(summaryTtft) },
            { label: "Output speed", value: formatRate(summarySpeed) },
            { label: "Total cost", value: formatUsd(summaryCost) },
            { hiddenOnMobile: true, label: "Cost / correct", value: formatUsd(costPerCorrect) }
          ]}/>
          <ReliabilityNote statistics={summaryStatistics}/>

          <section className="leaderboard-section" id="leaderboard">
            <div className="leaderboard-toolbar">
              <h2>Leaderboard</h2>
              <div className="filter-group">
                <label><span className="sr-only">Filter by category</span><select aria-label="Category filter" onChange={(event) => setCategory(event.target.value as CategoryFilter)} value={category}><option value="all">All categories</option>{Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label className="task-filter"><span className="sr-only">Filter by task</span><select aria-label="Task filter" onChange={(event) => setTaskId(event.target.value)} value={taskId}><option value="all">All tasks</option>{tasks.map(([id, title]) => <option key={id} value={id}>{title}</option>)}</select></label>
                <button aria-label="Export report JSON" className="icon-button bordered-button" onClick={() => downloadReport(report)} type="button"><Icon name="download" size={19}/></button>
              </div>
            </div>
            <Leaderboard onSelect={setSelectedModelId} onSort={handleSort} rows={rows} selectedModelId={selectedModel.modelId} sortKey={sortKey}/>
          </section>

          <div className="lower-grid">
            <RecoveryPanel attempt={recoveryAttempt} onViewChecks={showChecks}/>
            <AttemptDetails attempts={selectedAttempts} modelLabel={selectedModel.label} onTabChange={setDetailTab} tab={detailTab}/>
          </div>
        </main>

        <footer className="status-bar" id="status">
          <div><span className={report.journalVerified ? "status-dot" : "status-dot status-dot--warning"}/>{report.journalVerified ? "Journal verified" : "Journal unverified"}<i>·</i>Docker isolated<i>·</i>Network disabled</div>
          <div className="status-meta">RedactBench v{VERSION} <i>·</i> schema {report.schemaVersion}</div>
        </footer>
      </div>
      {showNewRun ? <NewRunDialog onClose={() => setShowNewRun(false)}/> : null}
    </div>
  );
}
