import { describe, expect, it } from "vitest";

import { BENCHMARK_NAME, SCHEMA_VERSION, VERSION } from "../src/version.js";

describe("project identity", () => {
  it("exposes stable public version constants", () => {
    expect(BENCHMARK_NAME).toBe("RedactBench");
    expect(VERSION).toMatch(/^0\.1\.0$/);
    expect(SCHEMA_VERSION).toBe(1);
  });
});
