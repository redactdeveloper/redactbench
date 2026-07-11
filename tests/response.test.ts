import { describe, expect, it } from "vitest";

import { RedactBenchError } from "../src/errors.js";
import { parseModelResponse } from "../src/response.js";

const safeDiff = [
  "diff --git a/src/users.ts b/src/users.ts",
  "index 1111111..2222222 100644",
  "--- a/src/users.ts",
  "+++ b/src/users.ts",
  "@@ -1 +1 @@",
  "-return users[id];",
  "+return users.find((user) => user.id === id);"
].join("\n");

function envelope(patch = safeDiff, notes = "Changed lookup semantics and preserved the API.") {
  return [
    "<redactbench_patch>",
    patch,
    "</redactbench_patch>",
    "<redactbench_notes>",
    notes,
    "</redactbench_notes>"
  ].join("\n");
}

describe("parseModelResponse", () => {
  it("extracts one strict patch envelope and notes", () => {
    const result = parseModelResponse(envelope(), {
      kind: "patch",
      maxBytes: 262_144
    });

    expect(result.kind).toBe("patch");
    if (result.kind === "patch") {
      expect(result.patch).toBe(safeDiff);
      expect(result.notes).toContain("lookup semantics");
      expect(result.rawHash).toMatch(/^[a-f0-9]{64}$/);
    }
  });

  it("keeps a text answer as data", () => {
    const result = parseModelResponse("  The premise is false because 2 + 2 = 4.  ", {
      kind: "text",
      maxBytes: 1_024
    });

    expect(result).toMatchObject({
      kind: "text",
      answer: "The premise is false because 2 + 2 = 4."
    });
  });

  it.each([
    ["path traversal", safeDiff.replace("a/src/users.ts", "a/../outside.ts")],
    ["absolute path", safeDiff.replace("+++ b/src/users.ts", "+++ /etc/passwd")],
    ["binary patch", `${safeDiff}\nGIT binary patch\nliteral 1\nA`],
    ["symlink mode", `${safeDiff}\nnew file mode 120000`]
  ])("rejects a %s", (_label, patch) => {
    expect(() =>
      parseModelResponse(envelope(patch), {
        kind: "patch",
        maxBytes: 262_144
      })
    ).toThrowError(RedactBenchError);
  });

  it("rejects duplicate or unwrapped envelopes", () => {
    for (const response of [
      `${envelope()}\n${envelope()}`,
      `I fixed it.\n${envelope()}`,
      safeDiff
    ]) {
      expect(() =>
        parseModelResponse(response, { kind: "patch", maxBytes: 262_144 })
      ).toThrowError(/exactly one response envelope/i);
    }
  });

  it("rejects empty and oversized output before it can reach patch application", () => {
    expect(() => parseModelResponse("   ", { kind: "text", maxBytes: 1_024 })).toThrow(
      /empty/i
    );
    expect(() =>
      parseModelResponse("x".repeat(1_025), { kind: "text", maxBytes: 1_024 })
    ).toThrow(/exceeds/i);
  });
});
