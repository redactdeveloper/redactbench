import type { CheckResult, EvaluatorCheck } from "./contracts.js";
import { isRedactBenchError } from "./errors.js";
import {
  runDockerCheck,
  type SandboxContext,
  type SandboxExecution,
  type SandboxRunner
} from "./sandbox/docker.js";
import {
  createIsolatedWorkspace,
  type IsolatedWorkspace
} from "./workspace.js";

export interface EvaluationResult {
  checks: CheckResult[];
  imageIds: string[];
  score: number;
}

export type WorkspaceFactory = (
  sourceDirectory: string
) => Promise<IsolatedWorkspace>;

function statusFor(execution: SandboxExecution): CheckResult["status"] {
  if (execution.timedOut) {
    return "timeout";
  }
  if (execution.outputLimitExceeded || execution.errorCode) {
    return "error";
  }
  if (execution.exitCode === 0) {
    return "passed";
  }
  return execution.exitCode === null ? "error" : "failed";
}

function checkResult(
  check: EvaluatorCheck,
  execution: SandboxExecution
): CheckResult {
  const result: CheckResult = {
    durationMs: execution.durationMs,
    exitCode: execution.exitCode,
    id: check.id,
    output: execution.output,
    status: statusFor(execution),
    weight: check.weight
  };
  if (check.label !== undefined) {
    result.label = check.label;
  }
  if (execution.errorCode !== undefined) {
    result.errorCode = execution.errorCode;
  }
  return result;
}

function failedExecution(error: unknown): SandboxExecution {
  return {
    durationMs: 0,
    errorCode: isRedactBenchError(error) ? error.code : "SANDBOX_ERROR",
    exitCode: null,
    imageId: null,
    output: isRedactBenchError(error) ? error.message : "Sandbox execution failed",
    outputLimitExceeded: false,
    timedOut: false
  };
}

export async function evaluateChecks(
  checks: readonly EvaluatorCheck[],
  context: SandboxContext,
  sandbox: SandboxRunner = runDockerCheck,
  workspaceFactory: WorkspaceFactory = createIsolatedWorkspace
): Promise<EvaluationResult> {
  const results: CheckResult[] = [];
  const imageIds = new Set<string>();

  for (const check of checks) {
    let execution: SandboxExecution;
    let isolatedWorkspace: IsolatedWorkspace | null = null;
    try {
      isolatedWorkspace = await workspaceFactory(context.workspaceDirectory);
      execution = await sandbox(check, {
        evaluatorDirectory: context.evaluatorDirectory,
        workspaceDirectory: isolatedWorkspace.directory
      });
    } catch (error) {
      execution = failedExecution(error);
    }
    if (isolatedWorkspace) {
      try {
        await isolatedWorkspace.cleanup();
      } catch (error) {
        execution = {
          ...failedExecution(error),
          imageId: execution.imageId
        };
      }
    }
    if (execution.imageId) {
      imageIds.add(execution.imageId);
    }
    results.push(checkResult(check, execution));
  }

  const totalWeight = checks.reduce((sum, check) => sum + check.weight, 0);
  const passedWeight = results.reduce(
    (sum, result) => sum + (result.status === "passed" ? result.weight : 0),
    0
  );

  return {
    checks: results,
    imageIds: [...imageIds].sort(),
    score: totalWeight === 0 ? 0 : passedWeight / totalWeight
  };
}
