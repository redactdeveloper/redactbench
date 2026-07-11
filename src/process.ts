import { spawn } from "node:child_process";

export interface ProcessOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxOutputBytes: number;
  onTerminate?: () => Promise<void> | void;
  stdin?: Buffer | string;
  timeoutMs: number;
}

export interface ProcessResult {
  durationMs: number;
  exitCode: number | null;
  outputLimitExceeded: boolean;
  spawnError: string | null;
  stderr: string;
  stdout: string;
  timedOut: boolean;
}

export async function runProcess(
  argv: readonly [string, ...string[]],
  options: ProcessOptions
): Promise<ProcessResult> {
  const startedAt = Date.now();
  const stdoutChunks: Buffer[] = [];
  const stderrChunks: Buffer[] = [];
  let capturedBytes = 0;
  let outputLimitExceeded = false;
  let timedOut = false;
  let terminationStarted = false;

  return await new Promise<ProcessResult>((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd: options.cwd,
      env: options.env ?? process.env,
      shell: false,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"]
    });

    if (options.stdin !== undefined && child.stdin) {
      child.stdin.on("error", () => undefined);
      child.stdin.end(options.stdin);
    }

    const terminate = (reason: "output" | "timeout") => {
      if (terminationStarted) {
        return;
      }
      terminationStarted = true;
      outputLimitExceeded = reason === "output";
      timedOut = reason === "timeout";
      void Promise.resolve(options.onTerminate?.()).finally(() => {
        child.kill("SIGKILL");
      });
    };

    const capture = (chunk: Buffer, destination: Buffer[]) => {
      const remaining = options.maxOutputBytes - capturedBytes;
      if (remaining > 0) {
        const accepted = chunk.subarray(0, remaining);
        destination.push(accepted);
        capturedBytes += accepted.byteLength;
      }
      if (chunk.byteLength > remaining) {
        terminate("output");
      }
    };

    child.stdout?.on("data", (chunk: Buffer) => capture(chunk, stdoutChunks));
    child.stderr?.on("data", (chunk: Buffer) => capture(chunk, stderrChunks));

    const timeout = setTimeout(() => terminate("timeout"), options.timeoutMs);
    let spawnError: string | null = null;
    child.once("error", (error) => {
      spawnError = error.message;
    });
    child.once("close", (exitCode) => {
      clearTimeout(timeout);
      resolve({
        durationMs: Math.max(0, Date.now() - startedAt),
        exitCode,
        outputLimitExceeded,
        spawnError,
        stderr: Buffer.concat(stderrChunks).toString("utf8"),
        stdout: Buffer.concat(stdoutChunks).toString("utf8"),
        timedOut
      });
    });
  });
}
