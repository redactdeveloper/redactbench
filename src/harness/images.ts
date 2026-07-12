import { constants } from "node:fs";
import { access, cp, mkdir, mkdtemp, realpath, rm, stat } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { RedactBenchError } from "../errors.js";
import type { HarnessName } from "../field-contracts.js";
import {
  runProcess,
  type ProcessOptions,
  type ProcessResult
} from "../process.js";
import { VERSION } from "../version.js";
import type { HarnessCatalog } from "./catalog.js";

type ProcessRunner = (
  argv: readonly [string, ...string[]],
  options: ProcessOptions
) => Promise<ProcessResult>;

export interface HarnessImageReadiness {
  harness: HarnessName;
  image: string;
  imageId: string | null;
  status: "ready" | "build-required";
}

interface EnsureHarnessImagesOptions {
  dryRun: boolean;
  projectRoot?: string;
  resolveTool?: (harness: HarnessName) => Promise<string>;
  run?: ProcessRunner;
}

const CLI_VERSIONS: Readonly<Record<HarnessName, string>> = {
  agy: "1.1.1",
  codex: "0.144.1",
  cursor: "2026.07.09-a3815c0",
  "grok-build": "0.2.93",
  opencode: "1.17.13"
};

async function executable(name: string): Promise<string> {
  for (const directory of (process.env.PATH ?? "").split(":")) {
    if (!directory) continue;
    const candidate = join(directory, name);
    try {
      await access(candidate, constants.X_OK);
      return await realpath(candidate);
    } catch {
      // Continue through the deterministic PATH order.
    }
  }
  throw new RedactBenchError(
    "CONFIG_INVALID",
    `required host CLI is missing: ${name}`
  );
}

export async function resolveHarnessTool(
  harness: HarnessName
): Promise<string> {
  switch (harness) {
    case "codex":
      return executable("codex");
    case "grok-build": {
      const configured = process.env.REDACTBENCH_GROK_BIN;
      const candidates = [
        configured,
        join(homedir(), ".grok", "downloads", "grok-linux-x86_64"),
        "/usr/local/lib/grok-vpn/grok.real"
      ].filter((value): value is string => Boolean(value));
      for (const candidate of candidates) {
        try {
          await access(candidate, constants.X_OK);
          return await realpath(candidate);
        } catch {
          // Try the next known, non-wrapper binary location.
        }
      }
      throw new RedactBenchError(
        "CONFIG_INVALID",
        "required host CLI is missing: grok"
      );
    }
    case "cursor":
      return dirname(await executable("agent"));
    case "agy":
      return executable("agy");
    case "opencode":
      return executable("opencode");
  }
}

async function inspectImage(
  image: string,
  harness: HarnessName,
  runner: ProcessRunner
): Promise<string | null> {
  const result = await runner(
    [
      "docker",
      "image",
      "inspect",
      "--format={{.Id}}|{{index .Config.Labels \"org.redactbench.runtime-version\"}}|{{index .Config.Labels \"org.redactbench.harness\"}}",
      image
    ],
    { maxOutputBytes: 4_096, timeoutMs: 15_000 }
  );
  if (result.exitCode !== 0) return null;
  const [imageId = "", runtimeVersion, imageHarness] = result.stdout
    .trim()
    .split("|");
  if (!/^sha256:[a-f0-9]{64}$/u.test(imageId)) {
    throw new RedactBenchError(
      "SANDBOX_ERROR",
      `Docker returned an invalid image ID for ${image}`
    );
  }
  if (runtimeVersion !== VERSION || imageHarness !== harness) return null;
  return imageId;
}

async function verifyToolVersion(
  harness: HarnessName,
  source: string,
  runner: ProcessRunner
): Promise<void> {
  const executablePath =
    harness === "cursor" ? join(source, "cursor-agent") : source;
  const result = await runner(
    [executablePath, "--version"],
    { maxOutputBytes: 16_384, timeoutMs: 15_000 }
  );
  if (
    result.spawnError ||
    result.timedOut ||
    result.outputLimitExceeded ||
    result.exitCode !== 0 ||
    !result.stdout.includes(CLI_VERSIONS[harness])
  ) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      `${harness} CLI must be version ${CLI_VERSIONS[harness]}`
    );
  }
}

async function stageTool(
  harness: HarnessName,
  source: string,
  root: string
): Promise<void> {
  await validateToolSource(harness, source);
  const name = harness === "grok-build" ? "grok" : harness;
  const target = join(root, name);
  await cp(source, target, {
    errorOnExist: true,
    force: false,
    recursive: harness === "cursor"
  });
}

async function validateToolSource(
  harness: HarnessName,
  source: string
): Promise<void> {
  const metadata = await stat(source);
  if (harness === "cursor") {
    if (!metadata.isDirectory()) {
      throw new RedactBenchError(
        "CONFIG_INVALID",
        "Cursor image source must be its version directory"
      );
    }
    try {
      await access(join(source, "cursor-agent"), constants.X_OK);
    } catch (error) {
      throw new RedactBenchError(
        "CONFIG_INVALID",
        "Cursor image source must contain an executable cursor-agent",
        [],
        error
      );
    }
    return;
  }
  if (!metadata.isFile()) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      `${harness} image source must be an executable file`
    );
  }
  try {
    await access(source, constants.X_OK);
  } catch (error) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      `${harness} image source must be executable`,
      [],
      error
    );
  }
}

export async function ensureHarnessImages(
  catalog: HarnessCatalog,
  options: EnsureHarnessImagesOptions
): Promise<HarnessImageReadiness[]> {
  const runner = options.run ?? runProcess;
  const resolveTool = options.resolveTool ?? resolveHarnessTool;
  const projectRoot = resolve(
    options.projectRoot ??
      resolve(dirname(fileURLToPath(import.meta.url)), "..", "..")
  );
  const unique = new Map<string, HarnessName>();
  for (const entry of catalog.runtimes) {
    unique.set(entry.runtime.image, entry.runtime.harness);
  }

  const readiness: HarnessImageReadiness[] = [];
  for (const [image, harness] of unique) {
    let imageId = await inspectImage(image, harness, runner);
    if (imageId) {
      readiness.push({ harness, image, imageId, status: "ready" });
      continue;
    }
    const source = await resolveTool(harness);
    await validateToolSource(harness, source);
    await verifyToolVersion(harness, source, runner);
    if (options.dryRun) {
      readiness.push({ harness, image, imageId: null, status: "build-required" });
      continue;
    }

    const temporary = await mkdtemp(join(tmpdir(), "redactbench-image-"));
    const toolContext = join(temporary, "tool");
    await mkdir(toolContext);
    try {
      await stageTool(harness, source, toolContext);
      const build = await runner(
        [
          "docker",
          "build",
          "--build-context",
          `harness_tool=${toolContext}`,
          "--build-arg",
          `HARNESS=${harness}`,
          "--build-arg",
          `REDACTBENCH_VERSION=${VERSION}`,
          "--file",
          join(projectRoot, "docker", "harnesses", "Dockerfile"),
          "--tag",
          image,
          projectRoot
        ],
        { maxOutputBytes: 1_048_576, timeoutMs: 900_000 }
      );
      if (
        build.spawnError ||
        build.timedOut ||
        build.outputLimitExceeded ||
        build.exitCode !== 0
      ) {
        throw new RedactBenchError(
          "SANDBOX_ERROR",
          `failed to build Docker harness image ${image}`
        );
      }
      imageId = await inspectImage(image, harness, runner);
      if (!imageId) {
        throw new RedactBenchError(
          "SANDBOX_ERROR",
          `built Docker harness image is unavailable: ${image}`
        );
      }
      readiness.push({ harness, image, imageId, status: "ready" });
    } finally {
      await rm(temporary, { force: true, recursive: true });
    }
  }
  return readiness;
}
