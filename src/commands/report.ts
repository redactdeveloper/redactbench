import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { aggregateJournal } from "../aggregate.js";
import type { Report } from "../contracts.js";
import { Journal } from "../journal.js";

export async function reportCommand(
  journalFile: string,
  outDirectory: string,
  generatedAt = new Date().toISOString()
): Promise<{ file: string; report: Report }> {
  const journal = await Journal.open(resolve(journalFile));
  const report = aggregateJournal(journal.entries, generatedAt);
  const directory = resolve(outDirectory);
  const file = resolve(directory, "report.json");
  await mkdir(directory, { recursive: true });
  await writeFile(file, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  return { file, report };
}
