import { RedactBenchError } from "../errors.js";
import {
  runProcess,
  type ProcessOptions,
  type ProcessResult
} from "../process.js";
import type { HarnessCatalog } from "./catalog.js";

type ProcessRunner = (
  argv: readonly [string, ...string[]],
  options: ProcessOptions
) => Promise<ProcessResult>;

export interface HarnessNetworkReadiness {
  name: string;
  status: "ready" | "create-required";
}

async function networkExists(
  name: string,
  runner: ProcessRunner
): Promise<boolean> {
  const result = await runner(
    [
      "docker",
      "network",
      "inspect",
      "--format={{.Driver}}|{{index .Labels \"org.redactbench.egress\"}}",
      name
    ],
    { maxOutputBytes: 4_096, timeoutMs: 15_000 }
  );
  return (
    result.exitCode === 0 &&
    !result.spawnError &&
    !result.timedOut &&
    result.stdout.trim() === "bridge|true"
  );
}

export async function ensureHarnessNetworks(
  catalog: HarnessCatalog,
  options: { dryRun: boolean; run?: ProcessRunner }
): Promise<HarnessNetworkReadiness[]> {
  const runner = options.run ?? runProcess;
  const names = [
    ...new Set(catalog.runtimes.map((entry) => entry.runtime.network))
  ];
  const readiness: HarnessNetworkReadiness[] = [];
  for (const name of names) {
    if (await networkExists(name, runner)) {
      readiness.push({ name, status: "ready" });
      continue;
    }
    if (options.dryRun) {
      readiness.push({ name, status: "create-required" });
      continue;
    }
    const result = await runner(
      [
        "docker",
        "network",
        "create",
        "--driver",
        "bridge",
        "--label",
        "org.redactbench.egress=true",
        name
      ],
      { maxOutputBytes: 8_192, timeoutMs: 30_000 }
    );
    if (
      result.spawnError ||
      result.timedOut ||
      result.outputLimitExceeded ||
      result.exitCode !== 0 ||
      !(await networkExists(name, runner))
    ) {
      throw new RedactBenchError(
        "SANDBOX_ERROR",
        `could not create harness network ${name}`
      );
    }
    readiness.push({ name, status: "ready" });
  }
  return readiness;
}
