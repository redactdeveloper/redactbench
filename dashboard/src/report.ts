import { ReportSchema, type BenchmarkCategory, type Report } from "../../src/contracts.js";

export const CATEGORY_LABELS: Readonly<Record<BenchmarkCategory, string>> = {
  algorithms: "Algorithms",
  debugging: "Debug",
  refactoring: "Refactor",
  security: "Security",
  ui: "UI",
  reasoning: "Reasoning",
  hallucination: "Pushback",
  "context-recovery": "Recovery"
};

export async function loadReport(url = "./report.json"): Promise<Report> {
  const response = await fetch(url, { cache: "no-store" });
  if (!response.ok) {
    throw new Error(`Report request failed with HTTP ${response.status}`);
  }
  return ReportSchema.parse(await response.json());
}

export function parseLocalReport(input: unknown): Report {
  return ReportSchema.parse(input);
}

export function formatPercent(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : `${(value * 100).toFixed(1)}%`;
}

export function formatSeconds(milliseconds: number | null | undefined): string {
  return milliseconds === null || milliseconds === undefined
    ? "—"
    : `${(milliseconds / 1_000).toFixed(milliseconds >= 10_000 ? 1 : 2)}s`;
}

export function formatRate(value: number | null | undefined): string {
  return value === null || value === undefined ? "—" : value.toFixed(1);
}

export function formatUsd(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (value === 0) {
    return "$0.00";
  }
  return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
}

export function measuredLabel(value: string): string {
  return value === "—" ? "Not measured" : value;
}
