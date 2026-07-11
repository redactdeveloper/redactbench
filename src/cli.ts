#!/usr/bin/env node

import { parseArgs } from "node:util";

import { BENCHMARK_NAME, VERSION } from "./version.js";

const { values } = parseArgs({
  allowPositionals: true,
  options: {
    help: { short: "h", type: "boolean" },
    version: { short: "v", type: "boolean" }
  }
});

if (values.version) {
  process.stdout.write(`${VERSION}\n`);
} else {
  process.stdout.write(
    `${BENCHMARK_NAME} ${VERSION}\n\n` +
      "Commands will be available after the benchmark contract is initialized.\n"
  );
}
