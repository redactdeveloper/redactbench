import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { ModelConfig } from "../src/contracts.js";
import { TaskSchema } from "../src/contracts.js";
import { runAttempt } from "../src/attempt.js";
import { createFixtureAdapter } from "../src/providers/fixture.js";

describe("attempt integration", () => {
  it("runs fixture provider, git patch and hidden Docker check end-to-end", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-attempt-integration-"));
    await mkdir(join(root, "workspace"));
    await mkdir(join(root, "evaluator"));
    await mkdir(join(root, "fixtures"));
    await writeFile(
      join(root, "workspace", "users.mjs"),
      "export const getUser = (users, id) => users[id];\n"
    );
    await writeFile(
      join(root, "evaluator", "check.mjs"),
      [
        'import { getUser } from "/workspace/users.mjs";',
        "const users = [{ id: 100, name: 'Ada' }, { id: 205, name: 'Lin' }];",
        "if (getUser(users, 205)?.name !== 'Lin') process.exit(1);",
        "if (getUser([], 1) !== undefined) process.exit(1);"
      ].join("\n")
    );
    const response = [
      "<redactbench_patch>",
      "diff --git a/users.mjs b/users.mjs",
      "--- a/users.mjs",
      "+++ b/users.mjs",
      "@@ -1 +1 @@",
      "-export const getUser = (users, id) => users[id];",
      "+export const getUser = (users, id) => users.find((user) => user.id === id);",
      "</redactbench_patch>",
      "<redactbench_notes>",
      "Resolved ID lookup and left missing users as undefined.",
      "</redactbench_notes>"
    ].join("\n");
    await writeFile(
      join(root, "fixtures", "model.json"),
      JSON.stringify({
        schemaVersion: 1,
        responses: {
          "debug-get-user:final": {
            durationMs: 100,
            inputTokens: 20,
            outputTokens: 30,
            text: response,
            ttftMs: 25
          }
        }
      })
    );
    await chmod(join(root, "evaluator"), 0o555);
    await chmod(join(root, "evaluator", "check.mjs"), 0o444);

    const task = TaskSchema.parse({
      schemaVersion: 1,
      id: "debug-get-user",
      title: "Fix getUser",
      category: "debugging",
      description: "Resolve IDs independently from indexes.",
      prompt: "Fix getUser.",
      checks: [
        {
          argv: ["node", "/evaluator/check.mjs"],
          id: "edge-cases",
          image: "node:22-alpine"
        }
      ]
    });
    const model = {
      fixtureFile: "fixtures/model.json",
      id: "fixture-strong",
      label: "Fixture Strong",
      maxOutputTokens: 4_096,
      model: "fixture-v1",
      provider: "fixture"
    } satisfies Extract<ModelConfig, { provider: "fixture" }>;
    const adapter = createFixtureAdapter(model, { baseDirectory: root });

    const result = await runAttempt({
      adapter,
      attemptId: "integration:debug-get-user:fixture-strong:1",
      model,
      repeat: 1,
      task,
      taskDirectory: root
    });

    expect(result.report).toMatchObject({ score: 1, status: "passed" });
    expect(result.report.checks[0]).toMatchObject({ status: "passed" });
    expect(result.imageIds[0]).toMatch(/^sha256:/);
  }, 60_000);
});
