#!/usr/bin/env node

import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";

const MAX_OUTPUT_BYTES = 16_777_216;
const TOOL_ROOT = process.env.REDACTBENCH_TOOL_ROOT ?? "/opt/harness/tool";

function parseArguments(input) {
  const values = { modelArguments: [] };
  for (let index = 0; index < input.length; index += 1) {
    const argument = input[index];
    if (["--harness", "--model", "--workspace", "--prompt-file"].includes(argument)) {
      const value = input[index + 1];
      if (!value) throw new Error(`Missing value for ${argument}`);
      values[argument.slice(2).replace("prompt-file", "promptFile")] = value;
      index += 1;
    } else {
      values.modelArguments.push(argument);
    }
  }
  if (!values.harness || !values.model || !values.workspace) {
    throw new Error("Harness, model and workspace are required");
  }
  return values;
}

async function copyProfile(source, target) {
  await rm(target, { force: true, recursive: true });
  await mkdir(dirname(target), { recursive: true });
  await cp(source, target, { force: false, recursive: true });
}

async function prepareHome(harness) {
  const home = "/tmp/home";
  await mkdir(home, { recursive: true });
  if (process.env.REDACTBENCH_SKIP_PROFILE === "1") return home;
  if (harness === "codex") await copyProfile("/auth/codex", `${home}/.codex`);
  if (harness === "grok-build") await copyProfile("/auth/grok", `${home}/.grok`);
  if (harness === "cursor") {
    await copyProfile("/auth/cursor", `${home}/.config/cursor`);
  }
  if (harness === "agy") await copyProfile("/auth/agy", `${home}/.gemini`);
  return home;
}

async function prepareOpenCode(home) {
  const providers = {};
  try {
    providers.zai = {
      key: (await readFile("/run/secrets/zai-api-key", "utf8")).trim(),
      type: "api"
    };
  } catch {
    // This provider credential is not mounted for the current entrant.
  }
  try {
    providers.openrouter = {
      key: (await readFile("/run/secrets/openrouter-api-key", "utf8")).trim(),
      type: "api"
    };
  } catch {
    // This provider credential is not mounted for the current entrant.
  }
  if (Object.keys(providers).length !== 1) {
    throw new Error("Exactly one OpenCode provider credential is required");
  }
  const auth = `${home}/.local/share/opencode/auth.json`;
  await mkdir(dirname(auth), { recursive: true });
  await writeFile(auth, JSON.stringify(providers), { mode: 0o600 });
  const config = `${home}/.config/opencode/opencode.json`;
  await mkdir(dirname(config), { recursive: true });
  await writeFile(config, JSON.stringify({
    permission: {
      external_directory: "deny",
      question: "deny",
      skill: "deny",
      task: "deny",
      webfetch: "deny",
      websearch: "deny"
    }
  }), { mode: 0o600 });
}

function commandFor(values, prompt) {
  const common = { cwd: values.workspace };
  switch (values.harness) {
    case "codex":
      return {
        ...common,
        argv: [
          `${TOOL_ROOT}/codex`,
          "exec",
          "--ephemeral",
          "--ignore-user-config",
          "--ignore-rules",
          "--sandbox",
          "workspace-write",
          "--ask-for-approval",
          "never",
          "--skip-git-repo-check",
          "--color",
          "never",
          "--json",
          "--model",
          values.model,
          ...values.modelArguments,
          "--cd",
          values.workspace,
          "-"
        ],
        stdin: prompt
      };
    case "grok-build":
      return {
        ...common,
        argv: [
          `${TOOL_ROOT}/grok`,
          "--model",
          values.model,
          ...values.modelArguments,
          "--cwd",
          values.workspace,
          "--always-approve",
          "--no-memory",
          "--no-subagents",
          "--disable-web-search",
          "--sandbox",
          "strict",
          "--no-plan",
          "--verbatim",
          "--output-format",
          "streaming-json",
          "--prompt-file",
          values.promptFile
        ]
      };
    case "cursor":
      return {
        ...common,
        argv: [
          `${TOOL_ROOT}/cursor/cursor-agent`,
          "--print",
          "--output-format",
          "stream-json",
          "--model",
          values.model,
          ...values.modelArguments,
          "--workspace",
          values.workspace,
          "--trust",
          "--force",
          "--sandbox",
          "enabled",
          prompt
        ]
      };
    case "agy":
      return {
        ...common,
        argv: [
          `${TOOL_ROOT}/agy`,
          "--print",
          "--model",
          values.model,
          ...values.modelArguments,
          "--mode",
          "accept-edits",
          "--dangerously-skip-permissions",
          "--sandbox",
          prompt
        ]
      };
    case "opencode":
      return {
        ...common,
        argv: [
          `${TOOL_ROOT}/opencode`,
          "run",
          "--pure",
          "--format",
          "json",
          "--model",
          values.model,
          ...values.modelArguments,
          "--dir",
          values.workspace,
          "--auto",
          prompt
        ]
      };
    default:
      throw new Error(`Unsupported harness: ${values.harness}`);
  }
}

function jsonLines(output) {
  const values = [];
  for (const line of output.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    try {
      values.push(JSON.parse(line));
    } catch {
      // Plain progress lines are valid and ignored by the normalizer.
    }
  }
  return values;
}

function stringsFrom(value, output = []) {
  if (typeof value === "string") output.push(value);
  else if (Array.isArray(value)) value.forEach((item) => stringsFrom(item, output));
  else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(value)) {
      if (["text", "content", "result", "message"].includes(key)) {
        stringsFrom(child, output);
      } else if (typeof child === "object") {
        stringsFrom(child, output);
      }
    }
  }
  return output;
}

function normalizedResult(stdout, ttftMs) {
  const events = jsonLines(stdout);
  const candidates = stringsFrom(events).filter((value) => value.trim());
  const text = candidates.at(-1)?.trim() || stdout.trim();
  let usage = null;
  for (const event of events) {
    const candidate = event.usage ?? event.data?.usage ?? event.message?.usage;
    if (!candidate) continue;
    const inputTokens = candidate.input_tokens ?? candidate.inputTokens;
    const outputTokens = candidate.output_tokens ?? candidate.outputTokens;
    if (Number.isInteger(inputTokens) && Number.isInteger(outputTokens)) {
      usage = {
        cachedInputTokens: candidate.cached_input_tokens ?? candidate.cachedInputTokens ?? 0,
        inputTokens,
        outputTokens
      };
    }
  }
  const requestId = events
    .map((event) => event.thread_id ?? event.session_id ?? event.sessionID ?? null)
    .find((value) => typeof value === "string") ?? null;
  return { providerRequestId: requestId, schemaVersion: 1, text, ttftMs, usage };
}

async function execute(command, environment) {
  const startedAt = Date.now();
  let firstOutputAt = null;
  let bytes = 0;
  const stdout = [];
  return await new Promise((resolve, reject) => {
    const child = spawn(command.argv[0], command.argv.slice(1), {
      cwd: command.cwd,
      env: environment,
      shell: false,
      stdio: [command.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"]
    });
    if (command.stdin !== undefined) child.stdin.end(command.stdin);
    child.stdout.on("data", (chunk) => {
      if (firstOutputAt === null) firstOutputAt = Date.now();
      bytes += chunk.length;
      if (bytes > MAX_OUTPUT_BYTES) child.kill("SIGKILL");
      else stdout.push(chunk);
    });
    child.stderr.on("data", () => {
      if (firstOutputAt === null) firstOutputAt = Date.now();
    });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code !== 0 || bytes > MAX_OUTPUT_BYTES) {
        reject(new Error(`Harness command failed with exit code ${code ?? "unknown"}`));
        return;
      }
      resolve(normalizedResult(
        Buffer.concat(stdout).toString("utf8"),
        firstOutputAt === null ? null : Math.max(0, firstOutputAt - startedAt)
      ));
    });
  });
}

async function main() {
  const values = parseArguments(process.argv.slice(2));
  const home = await prepareHome(values.harness);
  if (values.harness === "opencode") await prepareOpenCode(home);
  const prompt = values.promptFile
    ? await readFile(values.promptFile, "utf8")
    : await new Promise((resolve, reject) => {
        const chunks = [];
        process.stdin.on("data", (chunk) => chunks.push(chunk));
        process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        process.stdin.on("error", reject);
      });
  const environment = {
    CI: "1",
    HOME: home,
    LANG: "C.UTF-8",
    PATH: "/opt/harness/tool:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
    XDG_CACHE_HOME: `${home}/.cache`,
    XDG_CONFIG_HOME: `${home}/.config`,
    XDG_DATA_HOME: `${home}/.local/share`
  };
  if (values.harness === "codex") environment.CODEX_HOME = `${home}/.codex`;
  const result = await execute(commandFor(values, prompt), environment);
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Harness failed"}\n`);
  process.exitCode = 1;
});
