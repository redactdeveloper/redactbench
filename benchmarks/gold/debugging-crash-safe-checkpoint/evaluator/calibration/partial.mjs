function parseCheckpoint(raw) {
  if (raw === null || raw === "") return 0;
  const parsed = JSON.parse(raw);
  if (parsed?.version !== 2 || !Number.isSafeInteger(parsed.nextRow) || parsed.nextRow < 0) {
    return 0;
  }
  return parsed.nextRow;
}

export async function resumeImport(rows, store) {
  const nextRow = parseCheckpoint(await store.readCheckpoint());
  for (let index = nextRow; index < rows.length; index += 1) {
    await store.appendRow(rows[index]);
    await store.syncRows();
    await store.writeCheckpoint(JSON.stringify({ version: 2, nextRow: index + 1 }));
  }
  return { imported: rows.length - nextRow, nextRow: rows.length };
}
