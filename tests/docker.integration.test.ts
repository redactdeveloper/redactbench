import { chmod, mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { EvaluatorCheckSchema } from "../src/contracts.js";
import { runDockerCheck } from "../src/sandbox/docker.js";

describe("Docker sandbox integration", () => {
  it("blocks network and evaluator writes while allowing workspace writes", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-docker-"));
    const workspaceDirectory = join(root, "workspace");
    const evaluatorDirectory = join(root, "evaluator");
    await mkdir(workspaceDirectory);
    await mkdir(evaluatorDirectory);
    await writeFile(
      join(evaluatorDirectory, "check.mjs"),
      [
        'import { writeFile } from "node:fs/promises";',
        "let networkBlocked = false;",
        "let evaluatorReadOnly = false;",
        "try {",
        '  await fetch("http://1.1.1.1", { signal: AbortSignal.timeout(1000) });',
        "} catch { networkBlocked = true; }",
        "try {",
        '  await writeFile("/evaluator/escape.txt", "no");',
        "} catch { evaluatorReadOnly = true; }",
        'await writeFile("/workspace/result.json", JSON.stringify({ networkBlocked, evaluatorReadOnly }));',
        "if (!networkBlocked || !evaluatorReadOnly) process.exit(1);"
      ].join("\n")
    );
    await chmod(workspaceDirectory, 0o777);
    await chmod(evaluatorDirectory, 0o555);
    await chmod(join(evaluatorDirectory, "check.mjs"), 0o444);

    const check = EvaluatorCheckSchema.parse({
      argv: ["node", "/evaluator/check.mjs"],
      id: "docker-isolation",
      image: "node:22-alpine",
      timeoutMs: 30_000
    });
    const result = await runDockerCheck(check, {
      evaluatorDirectory,
      workspaceDirectory
    });

    expect(result, result.output).toMatchObject({
      exitCode: 0,
      outputLimitExceeded: false,
      timedOut: false
    });
    expect(result.imageId).toMatch(/^sha256:/);
  }, 60_000);
});
