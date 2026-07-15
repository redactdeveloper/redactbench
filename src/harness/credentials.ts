import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  realpath,
  rm
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { RedactBenchError } from "../errors.js";
import type { HarnessCatalog } from "./catalog.js";

type CredentialKind = "profile" | "secret-file";

interface CredentialSource {
  kind: CredentialKind;
  name: string;
  path: string | null;
  ready: boolean;
}

export interface HarnessCredentialReadiness {
  checks: readonly CredentialSource[];
  ready: boolean;
}

export interface StagedHarnessCredentials {
  cleanup(): Promise<void>;
  environment: Readonly<Record<string, string>>;
  secretFiles: Readonly<Record<string, string>>;
}

const DEFAULT_PATHS: Readonly<Record<string, (home: string) => string>> = {
  REDACTBENCH_CODEX_PROFILE: (home) => join(home, ".codex"),
  REDACTBENCH_GROK_PROFILE: (home) => join(home, ".grok"),
  REDACTBENCH_CURSOR_PROFILE: (home) => join(home, ".config", "cursor"),
  REDACTBENCH_AGY_PROFILE: (home) => join(home, ".gemini"),
  REDACTBENCH_ZAI_KEY_FILE: (home) =>
    join(home, ".config", "redactbench", "secrets", "zai-api-key"),
  REDACTBENCH_OPENROUTER_KEY_FILE: (home) =>
    join(home, ".config", "redactbench", "secrets", "openrouter-api-key")
};

const PROFILE_FILES: Readonly<Record<string, readonly string[]>> = {
  REDACTBENCH_CODEX_PROFILE: ["auth.json"],
  REDACTBENCH_GROK_PROFILE: ["auth.json"],
  REDACTBENCH_CURSOR_PROFILE: ["auth.json"],
  REDACTBENCH_AGY_PROFILE: [
    "antigravity-cli/antigravity-oauth-token",
    "antigravity-cli/cache/default_project_id.txt",
    "antigravity-cli/cache/onboarding.json",
    "antigravity-cli/installation_id",
    "config/config.json",
    "config/projects/default-cli-project.json"
  ]
};
const MAX_CREDENTIAL_BYTES = 1_048_576;

async function inspectSource(
  name: string,
  kind: CredentialKind,
  inputPath: string | undefined
): Promise<CredentialSource> {
  if (!inputPath) {
    return { kind, name, path: null, ready: false };
  }
  try {
    const metadata = await lstat(inputPath);
    if (
      metadata.isSymbolicLink() ||
      (kind === "profile" ? !metadata.isDirectory() : !metadata.isFile()) ||
      (kind === "secret-file" &&
        (metadata.size === 0 || metadata.size > MAX_CREDENTIAL_BYTES))
    ) {
      return { kind, name, path: null, ready: false };
    }
    const path = await realpath(inputPath);
    if (kind === "profile") {
      const requiredFiles = PROFILE_FILES[name] ?? [];
      for (const relativePath of requiredFiles) {
        const required = await lstat(join(path, relativePath));
        if (
          required.isSymbolicLink() ||
          !required.isFile() ||
          required.size === 0 ||
          required.size > MAX_CREDENTIAL_BYTES
        ) {
          return { kind, name, path: null, ready: false };
        }
      }
    }
    return { kind, name, path, ready: true };
  } catch {
    return { kind, name, path: null, ready: false };
  }
}

export async function inspectHarnessCredentials(
  catalog: HarnessCatalog,
  environment: Readonly<Record<string, string | undefined>>,
  home = homedir()
): Promise<HarnessCredentialReadiness> {
  const requested = new Map<string, CredentialKind>();
  for (const entry of catalog.runtimes) {
    for (const mount of entry.runtime.credentialMounts) {
      requested.set(mount.sourceEnv, "profile");
    }
    for (const secret of entry.runtime.credentialSecrets) {
      requested.set(secret.sourceEnv, "secret-file");
    }
  }

  const checks: CredentialSource[] = [];
  for (const [name, kind] of requested) {
    const fallback = DEFAULT_PATHS[name]?.(home);
    checks.push(
      await inspectSource(name, kind, environment[name] ?? fallback)
    );
  }
  return { checks, ready: checks.every((check) => check.ready) };
}

async function secureTree(
  path: string
): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isSymbolicLink()) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      "credential profiles must not contain symbolic links"
    );
  }
  if (metadata.isDirectory()) {
    for (const entry of await readdir(path)) {
      await secureTree(join(path, entry));
    }
    await chmod(path, 0o555);
  } else if (metadata.isFile()) {
    await chmod(path, 0o444);
  } else {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      "credential profiles contain an unsupported file type"
    );
  }
}

async function makeTreeWritable(path: string): Promise<void> {
  const metadata = await lstat(path);
  if (metadata.isDirectory()) {
    await chmod(path, 0o700);
    for (const entry of await readdir(path)) {
      await makeTreeWritable(join(path, entry));
    }
  } else if (metadata.isFile()) {
    await chmod(path, 0o600);
  }
}

export async function stageHarnessCredentials(
  readiness: HarnessCredentialReadiness
): Promise<StagedHarnessCredentials> {
  if (!readiness.ready) {
    const missing = readiness.checks
      .filter((check) => !check.ready)
      .map((check) => check.name)
      .join(", ");
    throw new RedactBenchError(
      "CONFIG_INVALID",
      `harness credentials are not ready: ${missing}`
    );
  }

  const root = await mkdtemp(join(tmpdir(), "redactbench-credentials-"));
  const environment: Record<string, string> = {};
  const secretFiles: Record<string, string> = {};
  try {
    await mkdir(join(root, "profiles"));
    await mkdir(join(root, "secrets"));
    for (const source of readiness.checks) {
      if (!source.path) {
        throw new RedactBenchError(
          "CONFIG_INVALID",
          `harness credential became unavailable: ${source.name}`
        );
      }
      const target = join(
        root,
        source.kind === "profile" ? "profiles" : "secrets",
        source.name.toLowerCase()
      );
      if (source.kind === "profile") {
        await mkdir(target);
        for (const relativePath of PROFILE_FILES[source.name] ?? []) {
          const destination = join(target, relativePath);
          await mkdir(dirname(destination), { recursive: true });
          await cp(join(source.path, relativePath), destination, {
            errorOnExist: true,
            force: false
          });
        }
      } else {
        await cp(source.path, target, {
          errorOnExist: true,
          force: false
        });
      }
      await secureTree(target);
      if (source.kind === "profile") {
        environment[source.name] = target;
      } else {
        secretFiles[source.name] = target;
      }
    }
    await chmod(join(root, "profiles"), 0o700);
    await chmod(join(root, "secrets"), 0o700);
    await chmod(root, 0o700);
  } catch (error) {
    await makeTreeWritable(root).catch(() => undefined);
    await rm(root, { force: true, recursive: true });
    throw error;
  }

  return {
    async cleanup() {
      await makeTreeWritable(root).catch(() => undefined);
      await rm(root, { force: true, recursive: true });
    },
    environment,
    secretFiles
  };
}
