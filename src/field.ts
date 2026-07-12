import { loadYamlConfig } from "./config.js";
import {
  BenchmarkFieldSchema,
  type BenchmarkField
} from "./field-contracts.js";

export * from "./field-contracts.js";

export async function loadBenchmarkField(filePath: string): Promise<BenchmarkField> {
  return loadYamlConfig(filePath, BenchmarkFieldSchema);
}
