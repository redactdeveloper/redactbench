import { readFile } from "node:fs/promises";
import { basename } from "node:path";

import { parse as parseYaml } from "yaml";
import type { ZodType } from "zod";

import { RedactBenchError } from "./errors.js";

const MAX_CONFIG_BYTES = 1_048_576;

function issuePath(path: readonly PropertyKey[]): string {
  return path.length === 0 ? "<root>" : path.map(String).join(".");
}

export async function loadYamlConfig<T>(filePath: string, schema: ZodType<T>): Promise<T> {
  const source = basename(filePath);
  let contents: string;

  try {
    contents = await readFile(filePath, "utf8");
  } catch (error) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      `${source}: could not read configuration`,
      [],
      error
    );
  }

  if (Buffer.byteLength(contents, "utf8") > MAX_CONFIG_BYTES) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      `${source}: configuration exceeds ${MAX_CONFIG_BYTES} bytes`
    );
  }

  let input: unknown;
  try {
    input = parseYaml(contents);
  } catch (error) {
    throw new RedactBenchError(
      "CONFIG_INVALID",
      `${source}: YAML is invalid`,
      [],
      error
    );
  }

  const result = schema.safeParse(input);
  if (!result.success) {
    const details = result.error.issues.map(
      (issue) => `${source}:${issuePath(issue.path)}: ${issue.message}`
    );
    throw new RedactBenchError("CONFIG_INVALID", details.join("\n"), details);
  }

  return result.data;
}
