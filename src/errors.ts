export type RedactBenchErrorCode =
  | "ATTEMPT_ERROR"
  | "CHECK_TIMEOUT"
  | "CONFIG_INVALID"
  | "PATCH_REJECTED"
  | "PROVIDER_ERROR"
  | "SANDBOX_ERROR";

export class RedactBenchError extends Error {
  readonly code: RedactBenchErrorCode;
  readonly details: readonly string[];

  constructor(
    code: RedactBenchErrorCode,
    message: string,
    details: readonly string[] = [],
    cause?: unknown
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "RedactBenchError";
    this.code = code;
    this.details = details;
  }
}

export function isRedactBenchError(error: unknown): error is RedactBenchError {
  return error instanceof RedactBenchError;
}
