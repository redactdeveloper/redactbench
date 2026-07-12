import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  buildHarnessDockerArgs,
  HarnessDockerRuntimeSchema
} from "../src/harness/docker.js";

const runtimeInput = {
  schemaVersion: 1,
  execution: "docker",
  harness: "opencode",
  image: "redactbench/harness-opencode:local",
  argv: ["opencode", "run", "--model", "{model}", "--prompt-file", "{promptFile}"],
  promptTransport: "file",
  network: "redactbench-egress",
  credentialSecrets: [
    {
      sourceEnv: "OPENROUTER_API_KEY",
      target: "/run/secrets/openrouter-api-key"
    }
  ],
  credentialMounts: [
    {
      sourceEnv: "OPENCODE_CONFIG_DIR",
      target: "/auth/opencode"
    }
  ]
} as const;

describe("HarnessDockerRuntimeSchema", () => {
  it("accepts a bounded Docker runtime without secret values", () => {
    const runtime = HarnessDockerRuntimeSchema.parse(runtimeInput);

    expect(runtime).toMatchObject({
      cpus: 2,
      execution: "docker",
      memoryMb: 4096,
      pidsLimit: 256,
      timeoutMs: 1_800_000
    });
  });

  it.each([
    ["host execution", { execution: "host" }],
    ["host network", { network: "host" }],
    ["default bridge", { network: "bridge" }],
    ["shell command", { argv: "opencode run" }],
    [
      "shell entrypoint",
      { argv: ["sh", "-c", "echo {model} {promptFile}"] }
    ],
    ["unknown template", { argv: ["opencode", "{secret}"] }],
    [
      "credential target outside auth",
      { credentialMounts: [{ sourceEnv: "HOME", target: "/home/runner" }] }
    ],
    ["inline credential", { apiKey: "must-not-be-configured" }]
  ])("rejects %s", (_label, override) => {
    expect(
      HarnessDockerRuntimeSchema.safeParse({ ...runtimeInput, ...override }).success
    ).toBe(false);
  });

  it("requires the configured prompt transport to match argv", () => {
    expect(
      HarnessDockerRuntimeSchema.safeParse({
        ...runtimeInput,
        argv: ["opencode", "run", "--model", "{model}"]
      }).success
    ).toBe(false);
    expect(
      HarnessDockerRuntimeSchema.safeParse({
        ...runtimeInput,
        argv: ["opencode", "run", "--model", "{model}"],
        promptTransport: "stdin"
      }).success
    ).toBe(true);
  });

  it("allows an isolated per-run egress network name", () => {
    expect(
      HarnessDockerRuntimeSchema.safeParse({
        ...runtimeInput,
        network: "redactbench-egress-dryrun-42"
      }).success
    ).toBe(true);
  });
});

describe("buildHarnessDockerArgs", () => {
  it("mounts only the allowed inputs and never serializes a secret value", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-harness-"));
    const workspace = join(root, "workspace");
    const auth = join(root, "auth");
    const prompt = join(root, "prompt.txt");
    const secretFile = join(root, "openrouter-api-key");
    await Promise.all([
      mkdir(workspace),
      mkdir(auth),
      writeFile(prompt, "untrusted benchmark prompt\n"),
      writeFile(secretFile, "secret-value-must-not-enter-argv", { mode: 0o600 })
    ]);

    try {
      const args = await buildHarnessDockerArgs(
        HarnessDockerRuntimeSchema.parse(runtimeInput),
        {
          containerName: "redactbench-opencode-attempt",
          environment: {
            OPENCODE_CONFIG_DIR: auth
          },
          model: "hy3-high",
          promptFile: prompt,
          secretFiles: { OPENROUTER_API_KEY: secretFile },
          workspaceDirectory: workspace
        }
      );
      const serialized = args.join(" ");

      expect(args[0]).toBe("run");
      expect(serialized).toContain("--network redactbench-egress");
      expect(serialized).toContain("--read-only");
      expect(serialized).toContain("--cap-drop ALL");
      expect(serialized).toContain("--security-opt no-new-privileges");
      expect(serialized).toContain("--user 65532:65532");
      expect(serialized).toContain(`src=${workspace},dst=/workspace`);
      expect(serialized).toContain(`src=${prompt},dst=/run/redactbench/prompt.txt,readonly`);
      expect(serialized).toContain(`src=${auth},dst=/auth/opencode,readonly`);
      expect(serialized).toContain(
        `src=${secretFile},dst=/run/secrets/openrouter-api-key,readonly`
      );
      expect(serialized).not.toContain("--env OPENROUTER_API_KEY");
      expect(serialized).toContain("--model hy3-high");
      expect(serialized).toContain("--prompt-file /run/redactbench/prompt.txt");
      expect(serialized).not.toContain("secret-value-must-not-enter-argv");
      expect(serialized).not.toContain("/evaluator");
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });

  it("fails closed when a declared credential is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "redactbench-harness-missing-"));
    const workspace = join(root, "workspace");
    const auth = join(root, "auth");
    const prompt = join(root, "prompt.txt");
    await Promise.all([mkdir(workspace), mkdir(auth), writeFile(prompt, "prompt\n")]);

    try {
      await expect(
        buildHarnessDockerArgs(HarnessDockerRuntimeSchema.parse(runtimeInput), {
          containerName: "redactbench-opencode-attempt",
          environment: { OPENCODE_CONFIG_DIR: auth },
          model: "hy3-high",
          promptFile: prompt,
          secretFiles: {},
          workspaceDirectory: workspace
        })
      ).rejects.toThrow(/OPENROUTER_API_KEY/u);
    } finally {
      await rm(root, { force: true, recursive: true });
    }
  });
});
