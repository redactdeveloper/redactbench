import {
  loadBenchmarkDefinition,
  type BenchmarkDefinition
} from "../definition.js";

export async function validateCommand(
  suiteFile: string,
  modelsFile: string
): Promise<BenchmarkDefinition> {
  return await loadBenchmarkDefinition(suiteFile, modelsFile);
}
