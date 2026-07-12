import { parseCheckpoint, serializeCheckpoint } from "./checkpoint.mjs";

export async function resumeImport(rows, store) {
  const nextRow = parseCheckpoint(await store.readCheckpoint());

  for (let index = nextRow; index < rows.length; index += 1) {
    await store.writeCheckpoint(serializeCheckpoint(index + 1));
    await store.appendRow(rows[index]);
    await store.syncRows();
  }

  return { imported: rows.length - nextRow, nextRow: rows.length };
}
