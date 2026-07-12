import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { runProcess } from "../src/process.js";

describe("container harness runner", () => {
  it("normalizes a headless CLI result and keeps the prompt out of host argv", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-runner-"));
    const tools = join(root, "tools");
    const workspace = join(root, "workspace");
    const prompt = join(root, "prompt.txt");
    await Promise.all([mkdir(tools), mkdir(workspace)]);
    await writeFile(prompt, "Private benchmark prompt fixture", { mode: 0o600 });
    const fakeAgy = join(tools, "agy");
    await writeFile(
      fakeAgy,
      [
        "#!/usr/bin/env node",
        "const fs = require('node:fs');",
        "fs.writeFileSync('agent-edit.txt', 'edited inside workspace\\n');",
        "process.stdout.write('Implemented the requested workspace change.\\n');"
      ].join("\n"),
      { mode: 0o700 }
    );
    await chmod(fakeAgy, 0o700);

    try {
      const argv = [
        process.execPath,
        resolve("docker/harnesses/runner.mjs"),
        "--harness",
        "agy",
        "--model",
        "fixture-model",
        "--workspace",
        workspace,
        "--prompt-file",
        prompt
      ] as const;
      expect(argv.join(" ")).not.toContain("Private benchmark prompt fixture");
      const result = await runProcess(argv, {
        env: {
          ...process.env,
          REDACTBENCH_SKIP_PROFILE: "1",
          REDACTBENCH_TOOL_ROOT: tools
        },
        maxOutputBytes: 65_536,
        timeoutMs: 10_000
      });

      expect(result.stderr, result.stdout).toBe("");
      expect(result.exitCode).toBe(0);
      expect(JSON.parse(result.stdout)).toMatchObject({
        providerRequestId: null,
        schemaVersion: 1,
        text: "Implemented the requested workspace change.",
        usage: null
      });
      expect(await readFile(join(workspace, "agent-edit.txt"), "utf8"))
        .toBe("edited inside workspace\n");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
