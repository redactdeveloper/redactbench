import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";

const mode = process.argv[2];
const modulePath = process.argv[3] ?? "/workspace/src/importer.mjs";
const { resumeImport } = await import(pathToFileURL(modulePath).href);

const rows = [
  { id: "row-a", value: "alpha" },
  { id: "row-b", value: "beta" },
  { id: "row-c", value: "gamma" }
];

class FakeStore {
  constructor(options = {}) {
    this.checkpoint = options.checkpoint ?? null;
    this.durableRows = new Map((options.durableRows ?? []).map((row) => [row.id, row]));
    this.stagedRows = new Map();
    this.appendAttempts = [];
    this.crashAfterCheckpoint = options.crashAfterCheckpoint ?? false;
    this.crashAfterSync = options.crashAfterSync ?? false;
  }

  async readCheckpoint() {
    return this.checkpoint;
  }

  async appendRow(row) {
    this.appendAttempts.push(row.id);
    this.stagedRows.set(row.id, { ...row });
  }

  async syncRows() {
    for (const [id, row] of this.stagedRows) this.durableRows.set(id, row);
    this.stagedRows.clear();
    if (this.crashAfterSync) {
      this.crashAfterSync = false;
      throw new Error("injected crash after durable row sync");
    }
  }

  async writeCheckpoint(value) {
    this.checkpoint = value;
    if (this.crashAfterCheckpoint) {
      this.crashAfterCheckpoint = false;
      throw new Error("injected crash after checkpoint persistence");
    }
  }
}

function durableIds(store) {
  return [...store.durableRows.keys()].sort();
}

async function expectCrash(operation) {
  await assert.rejects(operation, /injected crash/u);
}

if (mode === "normal") {
  const store = new FakeStore();
  const input = rows.map((row) => ({ ...row }));
  const result = await resumeImport(input, store);
  assert.deepEqual(durableIds(store), ["row-a", "row-b", "row-c"]);
  assert.deepEqual(JSON.parse(store.checkpoint), { version: 2, nextRow: 3 });
  assert.deepEqual(input, rows);
  assert.equal(result.nextRow, 3);
} else if (mode === "checkpoint-crash") {
  const store = new FakeStore({ crashAfterCheckpoint: true });
  await expectCrash(() => resumeImport(rows, store));
  await resumeImport(rows, store);
  assert.deepEqual(durableIds(store), ["row-a", "row-b", "row-c"]);
  assert.deepEqual(JSON.parse(store.checkpoint), { version: 2, nextRow: 3 });
} else if (mode === "idempotent-resume") {
  const store = new FakeStore({ crashAfterSync: true });
  await expectCrash(() => resumeImport(rows, store));
  await resumeImport(rows, store);
  assert.deepEqual(durableIds(store), ["row-a", "row-b", "row-c"]);
  assert.equal(store.durableRows.size, 3);
} else if (mode === "legacy") {
  const store = new FakeStore({ checkpoint: "1", durableRows: [rows[0]] });
  await resumeImport(rows, store);
  assert.deepEqual(durableIds(store), ["row-a", "row-b", "row-c"]);
  assert.deepEqual(store.appendAttempts, ["row-b", "row-c"]);
  assert.deepEqual(JSON.parse(store.checkpoint), { version: 2, nextRow: 3 });
} else {
  throw new Error(`unknown evaluator mode: ${mode}`);
}
