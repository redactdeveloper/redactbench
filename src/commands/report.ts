import { cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { aggregateJournal } from "../aggregate.js";
import type { Report } from "../contracts.js";
import { RedactBenchError } from "../errors.js";
import { Journal } from "../journal.js";

function containsPath(parent: string, candidate: string): boolean {
  const relation = relative(parent, candidate);
  return relation === "" || (!relation.startsWith("..") && !isAbsolute(relation));
}

async function locateDashboard(explicitDirectory?: string): Promise<string> {
  const candidates = explicitDirectory
    ? [resolve(explicitDirectory)]
    : [
        resolve(dirname(fileURLToPath(import.meta.url)), "..", "dashboard"),
        resolve(process.cwd(), "dist", "dashboard")
      ];
  for (const candidate of candidates) {
    try {
      if ((await stat(join(candidate, "index.html"))).isFile()) return candidate;
    } catch {
      // Try the next deterministic build location.
    }
  }
  throw new RedactBenchError(
    "CONFIG_INVALID",
    "dashboard build is missing; run npm run build:dashboard before report"
  );
}

export async function reportCommand(
  journalFile: string,
  outDirectory: string,
  generatedAt = new Date().toISOString(),
  dashboardDirectory?: string
): Promise<{ file: string; report: Report }> {
  const journal = await Journal.open(resolve(journalFile));
  const report = aggregateJournal(journal.entries, generatedAt);
  const directory = resolve(outDirectory);
  const dashboard = await locateDashboard(dashboardDirectory);
  if (containsPath(dashboard, directory) || containsPath(directory, dashboard)) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      "report output must not contain, or be contained by, the dashboard build"
    );
  }
  const file = resolve(directory, "report.json");
  await mkdir(directory, { recursive: true });
  await Promise.all([
    rm(join(directory, "assets"), { force: true, recursive: true }),
    rm(join(directory, "index.html"), { force: true })
  ]);
  for (const entry of await readdir(dashboard)) {
    await cp(join(dashboard, entry), join(directory, entry), {
      force: true,
      recursive: true
    });
  }
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return { file, report };
}
