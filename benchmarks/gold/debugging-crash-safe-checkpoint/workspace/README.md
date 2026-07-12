# Durable importer

`resumeImport(rows, store)` continues an interrupted ordered import. Every row has a stable, unique `id`, and `store.appendRow(row)` is idempotent by that ID.

The store exposes four async operations:

- `readCheckpoint()` returns `null`, a legacy zero-based numeric string such as `"2"`, or a version 2 JSON checkpoint.
- `appendRow(row)` stages a row without making it durable.
- `syncRows()` makes every staged row durable before resolving.
- `writeCheckpoint(value)` durably replaces the checkpoint.

A version 2 checkpoint is JSON shaped as `{ "version": 2, "nextRow": 3 }`. `nextRow` is the zero-based index of the first row that hasn't been committed. Invalid checkpoints must still fail explicitly.
