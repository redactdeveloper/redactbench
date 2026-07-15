import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { loadBenchmarkField } from "../src/field.js";
import { loadHarnessCatalog } from "../src/harness/catalog.js";
import {
  inspectHarnessCredentials,
  stageHarnessCredentials
} from "../src/harness/credentials.js";
import { ensureHarnessImages } from "../src/harness/images.js";
import { ensureHarnessNetworks } from "../src/harness/networks.js";

async function targetCatalog() {
  const field = await loadBenchmarkField("benchmarks/target-field.yaml");
  return loadHarnessCatalog("benchmarks/target-runtimes.yaml", field);
}

function fixtureCliVersion(executable: string): string {
  if (executable.includes("cursor-agent")) return "2026.07.09-a3815c0\n";
  if (executable.includes("grok-build")) return "grok 0.2.93\n";
  if (executable.includes("opencode")) return "1.17.13\n";
  if (executable.includes("codex")) return "codex-cli 0.144.1\n";
  return "1.1.1\n";
}

describe("harness credential readiness", () => {
  it("reports only missing credential names and never reads secret values", async () => {
    const home = await mkdtemp(join(tmpdir(), "redactbench-empty-home-"));
    try {
      const readiness = await inspectHarnessCredentials(
        await targetCatalog(),
        {},
        home
      );

      expect(readiness.ready).toBe(false);
      expect(readiness.checks.filter((check) => !check.ready).map((check) => check.name))
        .toEqual([
          "REDACTBENCH_CODEX_PROFILE",
          "REDACTBENCH_GROK_PROFILE",
          "REDACTBENCH_CURSOR_PROFILE",
          "REDACTBENCH_AGY_PROFILE",
          "REDACTBENCH_ZAI_KEY_FILE",
          "REDACTBENCH_OPENROUTER_KEY_FILE"
        ]);
      expect(JSON.stringify(readiness)).not.toContain("credential-value");
    } finally {
      await rm(home, { force: true, recursive: true });
    }
  });

  it("stages private read-only copies for the non-root container user", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-credentials-"));
    const paths = {
      agy: join(root, "agy"),
      codex: join(root, "codex"),
      cursor: join(root, "cursor"),
      grok: join(root, "grok"),
      openrouter: join(root, "openrouter.key"),
      zai: join(root, "zai.key")
    };
    await Promise.all([
      mkdir(paths.agy),
      mkdir(paths.codex),
      mkdir(paths.cursor),
      mkdir(paths.grok)
    ]);
    await Promise.all([
      mkdir(join(paths.agy, "antigravity-cli")),
      writeFile(join(paths.codex, "auth.json"), "codex-credential-value", { mode: 0o600 }),
      writeFile(join(paths.cursor, "auth.json"), "cursor-credential-value", { mode: 0o600 }),
      writeFile(join(paths.grok, "auth.json"), "grok-credential-value", { mode: 0o600 }),
      writeFile(paths.openrouter, "openrouter-credential-value", { mode: 0o600 }),
      writeFile(paths.zai, "zai-credential-value", { mode: 0o600 })
    ]);
    await Promise.all([
      mkdir(join(paths.agy, "antigravity-cli", "cache"), { recursive: true }),
      mkdir(join(paths.agy, "config", "projects"), { recursive: true })
    ]);
    await Promise.all([
      writeFile(join(paths.agy, "antigravity-cli", "antigravity-oauth-token"), "agy-credential-value", { mode: 0o600 }),
      writeFile(join(paths.agy, "antigravity-cli", "cache", "default_project_id.txt"), "project-id", { mode: 0o600 }),
      writeFile(join(paths.agy, "antigravity-cli", "cache", "onboarding.json"), "{}", { mode: 0o600 }),
      writeFile(join(paths.agy, "antigravity-cli", "installation_id"), "installation-id", { mode: 0o600 }),
      writeFile(join(paths.agy, "config", "config.json"), "{}", { mode: 0o600 }),
      writeFile(join(paths.agy, "config", "projects", "default-cli-project.json"), "{}", { mode: 0o600 })
    ]);

    const readiness = await inspectHarnessCredentials(await targetCatalog(), {
      REDACTBENCH_AGY_PROFILE: paths.agy,
      REDACTBENCH_CODEX_PROFILE: paths.codex,
      REDACTBENCH_CURSOR_PROFILE: paths.cursor,
      REDACTBENCH_GROK_PROFILE: paths.grok,
      REDACTBENCH_OPENROUTER_KEY_FILE: paths.openrouter,
      REDACTBENCH_ZAI_KEY_FILE: paths.zai
    });
    expect(readiness.ready).toBe(true);

    const staged = await stageHarnessCredentials(readiness);
    try {
      expect(staged.environment.REDACTBENCH_CODEX_PROFILE).not.toBe(paths.codex);
      expect(staged.secretFiles.REDACTBENCH_ZAI_KEY_FILE).not.toBe(paths.zai);
      expect(await readFile(
        join(staged.environment.REDACTBENCH_CODEX_PROFILE!, "auth.json"),
        "utf8"
      )).toBe("codex-credential-value");
      expect(await readFile(
        staged.secretFiles.REDACTBENCH_ZAI_KEY_FILE!,
        "utf8"
      )).toBe("zai-credential-value");
      expect(
        (await stat(staged.secretFiles.REDACTBENCH_ZAI_KEY_FILE!)).mode & 0o777
      ).toBe(0o444);
      expect(
        (await stat(staged.environment.REDACTBENCH_CODEX_PROFILE!)).mode & 0o777
      ).toBe(0o555);
      expect(
        (await stat(dirname(staged.environment.REDACTBENCH_CODEX_PROFILE!))).mode &
          0o777
      ).toBe(0o700);
    } finally {
      await staged.cleanup();
      await rm(root, { force: true, recursive: true });
    }
  });
});

describe("harness image readiness", () => {
  it("plans missing builds during dry-run without invoking docker build", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-dry-run-tools-"));
    const cursor = join(root, "cursor");
    await mkdir(cursor);
    await writeFile(join(cursor, "cursor-agent"), "#!/bin/sh\n", { mode: 0o755 });
    const tools = new Map<string, string>();
    for (const harness of ["codex", "grok-build", "agy", "opencode"] as const) {
      const path = join(root, harness);
      await writeFile(path, "fixture binary", { mode: 0o755 });
      tools.set(harness, path);
    }
    tools.set("cursor", cursor);
    const run = vi.fn(async (argv: readonly string[]) => {
      const isDocker = argv[0] === "docker";
      return {
        durationMs: 1,
        exitCode: isDocker ? 1 : 0,
        outputLimitExceeded: false,
        spawnError: null,
        stderr: "",
        stdout: isDocker ? "" : fixtureCliVersion(argv[0] ?? ""),
        timedOut: false
      };
    });
    try {
      const result = await ensureHarnessImages(await targetCatalog(), {
        dryRun: true,
        resolveTool: async (harness) => tools.get(harness)!,
        run
      });

      expect(result).toHaveLength(5);
      expect(result.every((image) => image.status === "build-required")).toBe(true);
      expect(run.mock.calls.every(([argv]) => !argv.includes("build"))).toBe(true);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("builds each missing CLI image once and records its immutable image ID", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-tools-"));
    const cursor = join(root, "cursor");
    await mkdir(cursor);
    await writeFile(join(cursor, "cursor-agent"), "#!/bin/sh\n", { mode: 0o755 });
    const tools = new Map<string, string>();
    for (const harness of ["codex", "grok-build", "agy", "opencode"] as const) {
      const path = join(root, harness);
      await writeFile(path, "fixture binary", { mode: 0o755 });
      tools.set(harness, path);
    }
    tools.set("cursor", cursor);
    const built = new Map<string, string>();
    const run = vi.fn(async (argv: readonly string[]) => {
      if (argv[0] !== "docker") {
        return {
          durationMs: 1,
          exitCode: 0,
          outputLimitExceeded: false,
          spawnError: null,
          stderr: "",
          stdout: fixtureCliVersion(argv[0] ?? ""),
          timedOut: false
        };
      }
      const image = argv.at(-1) ?? "";
      if (argv[1] === "image" && argv[2] === "inspect") {
        const harness = built.get(image);
        return {
          durationMs: 1,
          exitCode: harness ? 0 : 1,
          outputLimitExceeded: false,
          spawnError: null,
          stderr: "",
          stdout: harness
            ? `sha256:${"a".repeat(64)}|0.3.0|${harness}\n`
            : "",
          timedOut: false
        };
      }
      const tagIndex = argv.indexOf("--tag");
      if (argv[1] === "build" && tagIndex >= 0) {
        const harnessArgument = argv.find((value) => value.startsWith("HARNESS="));
        built.set(
          argv[tagIndex + 1]!,
          harnessArgument?.slice("HARNESS=".length) ?? ""
        );
      }
      return {
        durationMs: 1,
        exitCode: 0,
        outputLimitExceeded: false,
        spawnError: null,
        stderr: "",
        stdout: "",
        timedOut: false
      };
    });

    try {
      const result = await ensureHarnessImages(await targetCatalog(), {
        dryRun: false,
        projectRoot: process.cwd(),
        resolveTool: async (harness) => tools.get(harness)!,
        run
      });

      expect(result).toHaveLength(5);
      expect(result.every((image) => image.status === "ready")).toBe(true);
      expect(result.every((image) => image.imageId?.startsWith("sha256:"))).toBe(true);
      expect(run.mock.calls.filter(([argv]) => argv[1] === "build")).toHaveLength(5);
    } finally {
      await chmod(root, 0o700);
      await rm(root, { force: true, recursive: true });
    }
  });

  it("rejects an unexpected host CLI version before building an image", async () => {
    const run = vi.fn(async (argv: readonly string[]) => ({
      durationMs: 1,
      exitCode: argv[0] === "docker" ? 1 : 0,
      outputLimitExceeded: false,
      spawnError: null,
      stderr: "",
      stdout: argv[0] === "docker" ? "" : "version 999.0.0\n",
      timedOut: false
    }));

    await expect(ensureHarnessImages(await targetCatalog(), {
      dryRun: true,
      resolveTool: async () => process.execPath,
      run
    })).rejects.toThrow(/codex CLI must be version 0\.144\.1/u);
    expect(run.mock.calls.every(([argv]) => !argv.includes("build"))).toBe(true);
  });
});

describe("harness network readiness", () => {
  it("creates every missing labelled bridge and verifies it", async () => {
    const created = new Set<string>();
    const run = vi.fn(async (argv: readonly string[]) => {
      const name = argv.at(-1) ?? "";
      if (argv[1] === "network" && argv[2] === "create") created.add(name);
      const ready = created.has(name);
      return {
        durationMs: 1,
        exitCode: argv[2] === "inspect" && !ready ? 1 : 0,
        outputLimitExceeded: false,
        spawnError: null,
        stderr: "",
        stdout: argv[2] === "inspect" && ready ? "bridge|true\n" : "",
        timedOut: false
      };
    });

    const readiness = await ensureHarnessNetworks(await targetCatalog(), {
      dryRun: false,
      run
    });

    expect(readiness).toHaveLength(6);
    expect(readiness.every((network) => network.status === "ready")).toBe(true);
    expect(run.mock.calls.filter(([argv]) => argv[2] === "create")).toHaveLength(6);
  });

  it("does not trust an existing network with the wrong driver", async () => {
    const run = vi.fn().mockResolvedValue({
      durationMs: 1,
      exitCode: 0,
      outputLimitExceeded: false,
      spawnError: null,
      stderr: "",
      stdout: "host|true\n",
      timedOut: false
    });

    const readiness = await ensureHarnessNetworks(await targetCatalog(), {
      dryRun: true,
      run
    });

    expect(readiness.every((network) => network.status === "create-required"))
      .toBe(true);
    expect(run.mock.calls.every(([argv]) => argv[2] !== "create")).toBe(true);
  });
});
