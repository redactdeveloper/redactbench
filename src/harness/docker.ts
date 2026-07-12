import { realpath, stat } from "node:fs/promises";
import { basename } from "node:path";

import { z } from "zod";

import { DockerImageSchema } from "../contracts.js";
import { RedactBenchError } from "../errors.js";
import { HarnessNameSchema } from "../field.js";
import { SCHEMA_VERSION } from "../version.js";

const ALLOWED_TEMPLATES = new Set(["{model}", "{promptFile}", "{workspace}"]);
const FORBIDDEN_ENV_NAMES = new Set([
  "DOCKER_HOST",
  "HOME",
  "NODE_OPTIONS",
  "PATH"
]);
const SHELL_EXECUTABLES = new Set(["ash", "bash", "dash", "ksh", "sh", "zsh"]);

const EnvironmentNameSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[A-Z][A-Z0-9_]*$/, "must be an uppercase environment variable name")
  .refine((name) => !FORBIDDEN_ENV_NAMES.has(name), "environment variable is not allowed");

const RuntimeArgumentSchema = z
  .string()
  .min(1)
  .max(1_024)
  .refine((value) => !value.includes("\0"), "must not contain NUL bytes")
  .refine((value) => {
    const templates = value.match(/\{[^}]+\}/gu) ?? [];
    return templates.every((template) => ALLOWED_TEMPLATES.has(template));
  }, "contains an unsupported template");

const CredentialMountSchema = z
  .object({
    sourceEnv: EnvironmentNameSchema,
    target: z
      .string()
      .regex(/^\/auth\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/u, "must be a direct /auth path")
  })
  .strict();

const CredentialSecretSchema = z
  .object({
    sourceEnv: EnvironmentNameSchema,
    target: z
      .string()
      .regex(
        /^\/run\/secrets\/[a-z0-9]+(?:[._-][a-z0-9]+)*$/u,
        "must be a direct /run/secrets path"
      )
  })
  .strict();

export const HarnessDockerRuntimeSchema = z
  .object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    execution: z.literal("docker"),
    harness: HarnessNameSchema,
    image: DockerImageSchema,
    argv: z.array(RuntimeArgumentSchema).min(1).max(64),
    promptTransport: z.enum(["file", "stdin"]),
    network: z
      .string()
      .regex(
        /^redactbench-egress(?:-[a-z0-9]+)*$/u,
        "must use a dedicated RedactBench egress network"
      ),
    credentialSecrets: z.array(CredentialSecretSchema).max(16).default([]),
    credentialMounts: z.array(CredentialMountSchema).max(8).default([]),
    timeoutMs: z.number().int().min(1_000).max(7_200_000).default(1_800_000),
    maxOutputBytes: z.number().int().min(1_024).max(16_777_216).default(1_048_576),
    memoryMb: z.number().int().min(512).max(16_384).default(4_096),
    cpus: z.number().min(0.25).max(8).default(2),
    pidsLimit: z.number().int().min(32).max(2_048).default(256)
  })
  .strict()
  .superRefine((runtime, context) => {
    if (SHELL_EXECUTABLES.has(basename(runtime.argv[0] ?? ""))) {
      context.addIssue({
        code: "custom",
        message: "shell entrypoints are not allowed",
        path: ["argv", 0]
      });
    }
    const serializedArgv = runtime.argv.join("\n");
    if (!serializedArgv.includes("{model}")) {
      context.addIssue({
        code: "custom",
        message: "argv must contain the {model} template",
        path: ["argv"]
      });
    }
    const hasPromptFile = serializedArgv.includes("{promptFile}");
    if (
      (runtime.promptTransport === "file" && !hasPromptFile) ||
      (runtime.promptTransport === "stdin" && hasPromptFile)
    ) {
      context.addIssue({
        code: "custom",
        message: "argv does not match promptTransport",
        path: ["argv"]
      });
    }

    const secretSources = new Set<string>();
    const secretTargets = new Set<string>();
    runtime.credentialSecrets.forEach((secret, index) => {
      if (
        secretSources.has(secret.sourceEnv) ||
        secretTargets.has(secret.target)
      ) {
        context.addIssue({
          code: "custom",
          message: "credential secrets must have unique sources and targets",
          path: ["credentialSecrets", index]
        });
      }
      secretSources.add(secret.sourceEnv);
      secretTargets.add(secret.target);
    });

    const mountSources = new Set<string>();
    const mountTargets = new Set<string>();
    runtime.credentialMounts.forEach((mount, index) => {
      if (mountSources.has(mount.sourceEnv) || mountTargets.has(mount.target)) {
        context.addIssue({
          code: "custom",
          message: "credential mounts must have unique sources and targets",
          path: ["credentialMounts", index]
        });
      }
      mountSources.add(mount.sourceEnv);
      mountTargets.add(mount.target);
    });
  });

export interface HarnessDockerContext {
  containerName: string;
  environment: Readonly<Record<string, string | undefined>>;
  model: string;
  promptFile: string;
  secretFiles: Readonly<Record<string, string | undefined>>;
  workspaceDirectory: string;
}

async function requirePath(
  input: string,
  expected: "directory" | "file",
  label: string
): Promise<string> {
  try {
    const path = await realpath(input);
    const metadata = await stat(path);
    const matches = expected === "directory" ? metadata.isDirectory() : metadata.isFile();
    if (!matches || path.includes(",")) {
      throw new Error(`invalid ${expected}`);
    }
    return path;
  } catch (error) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      `${label} must reference an existing ${expected}`,
      [],
      error
    );
  }
}

function requiredEnvironmentValue(
  environment: Readonly<Record<string, string | undefined>>,
  name: string
): string {
  const value = environment[name];
  if (!value) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      `required harness credential is missing: ${name}`
    );
  }
  return value;
}

function requiredSecretFile(
  secretFiles: Readonly<Record<string, string | undefined>>,
  name: string
): string {
  const path = secretFiles[name];
  if (!path) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      `required harness credential file is missing: ${name}`
    );
  }
  return path;
}

export async function buildHarnessDockerArgs(
  runtime: HarnessDockerRuntime,
  context: HarnessDockerContext
): Promise<string[]> {
  if (!/^redactbench-[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(context.containerName)) {
    throw new RedactBenchError("CONFIG_INVALID", "invalid harness container name");
  }
  if (!context.model.trim() || context.model.includes("\0")) {
    throw new RedactBenchError("CONFIG_INVALID", "invalid harness model identifier");
  }

  const workspaceDirectory = await requirePath(
    context.workspaceDirectory,
    "directory",
    "harness workspace"
  );
  const promptFile = await requirePath(context.promptFile, "file", "harness prompt");

  // Docker recommends file-mounted secrets over container environment values,
  // which may be exposed through container metadata or linked environments.
  // https://docs.docker.com/engine/swarm/secrets/
  const credentialSecrets = await Promise.all(
    runtime.credentialSecrets.map(async (secret) => ({
      source: await requirePath(
        requiredSecretFile(context.secretFiles, secret.sourceEnv),
        "file",
        `credential secret ${secret.sourceEnv}`
      ),
      target: secret.target
    }))
  );
  const credentialMounts = await Promise.all(
    runtime.credentialMounts.map(async (mount) => ({
      source: await requirePath(
        requiredEnvironmentValue(context.environment, mount.sourceEnv),
        "directory",
        `credential profile ${mount.sourceEnv}`
      ),
      target: mount.target
    }))
  );

  const args = [
    "run",
    "--rm",
    "--init",
    "--name",
    context.containerName,
    "--network",
    runtime.network,
    "--read-only",
    "--cap-drop",
    "ALL",
    "--security-opt",
    "no-new-privileges",
    "--pids-limit",
    String(runtime.pidsLimit),
    "--memory",
    `${runtime.memoryMb}m`,
    "--memory-swap",
    `${runtime.memoryMb}m`,
    "--cpus",
    String(runtime.cpus),
    "--user",
    "65532:65532",
    "--workdir",
    "/workspace",
    "--tmpfs",
    "/tmp:rw,noexec,nosuid,size=256m",
    "--env",
    "CI=1",
    "--env",
    "HOME=/tmp/home",
    "--mount",
    `type=bind,src=${workspaceDirectory},dst=/workspace,bind-recursive=disabled`,
    ...(runtime.promptTransport === "file"
      ? [
          "--mount",
          `type=bind,src=${promptFile},dst=/run/redactbench/prompt.txt,readonly`
        ]
      : ["--interactive"]),
    ...credentialMounts.flatMap((mount) => [
      "--mount",
      `type=bind,src=${mount.source},dst=${mount.target},readonly,bind-recursive=disabled`
    ]),
    ...credentialSecrets.flatMap((secret) => [
      "--mount",
      `type=bind,src=${secret.source},dst=${secret.target},readonly`
    ]),
    runtime.image,
    ...runtime.argv.map((argument) =>
      argument
        .replaceAll("{model}", context.model)
        .replaceAll("{promptFile}", "/run/redactbench/prompt.txt")
        .replaceAll("{workspace}", "/workspace")
    )
  ];

  return args;
}

export type HarnessDockerRuntime = z.infer<typeof HarnessDockerRuntimeSchema>;
