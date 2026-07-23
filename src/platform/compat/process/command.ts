import { dynamicImport } from "../dynamic-import.ts";
import { getDenoRuntime, isBun as IS_BUN, isDeno as IS_DENO } from "../runtime.ts";
import { isWindowsPlatform, runtimeProcess } from "./runtime-process.ts";

/** Result of a cross-runtime child command. */
export interface CommandResult {
  /** Whether the command exited successfully. */
  success: boolean;
  /** Process exit code, or a Veryfront command termination code. */
  code: number;
  /** Captured standard output when capture is enabled. */
  stdout?: string;
  /** Captured standard error or termination diagnostic. */
  stderr?: string;
  /** True when the child process was stopped because captured output exceeded its byte limit. */
  outputLimitExceeded?: boolean;
}

/** Options for executing a bounded cross-runtime child command. */
export interface CommandOptions {
  /** Command arguments. */
  args?: string[];
  /** Child working directory. */
  cwd?: string;
  /** Environment entries applied to the child. */
  env?: Record<string, string>;
  /** Start from an empty environment before applying `env`. */
  clearEnv?: boolean;
  /** Capture stdout/stderr to return in result */
  capture?: boolean;
  /** Inherit stdio from parent process (shows output in terminal) */
  inherit?: boolean;
  /** Use shell to run the command (needed for .cmd files on Windows) */
  shell?: boolean;
  /** Kill the command if it exceeds this duration (milliseconds) */
  timeoutMs?: number;
  /**
   * Abort the command. An already-aborted signal prevents spawning. A signal
   * that aborts while the child is running terminates it and returns exit code
   * 130.
   */
  signal?: AbortSignal;
  /**
   * Maximum combined child stdout and stderr bytes retained when `capture` is
   * true. Defaults to 16 MiB and cannot exceed 64 MiB. The command is
   * terminated with exit code 125 when the limit is exceeded.
   */
  maxOutputBytes?: number;
}

const COMMAND_TIMEOUT_EXIT_CODE = 124;
const COMMAND_OUTPUT_LIMIT_EXIT_CODE = 125;
const COMMAND_ABORT_EXIT_CODE = 130;
const FORCE_KILL_GRACE_MS = 250;
const MAX_TIMER_DELAY_MS = 2_147_483_647;
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_CONFIGURED_OUTPUT_BYTES = 64 * 1024 * 1024;

function validateTimeout(timeoutMs: number | undefined): number | undefined {
  if (timeoutMs === undefined || timeoutMs === 0) return undefined;
  if (
    !Number.isSafeInteger(timeoutMs) ||
    timeoutMs < 0 ||
    timeoutMs > MAX_TIMER_DELAY_MS
  ) {
    throw new RangeError(
      `timeoutMs must be an integer between 0 and ${MAX_TIMER_DELAY_MS}`,
    );
  }
  return timeoutMs;
}

function validateMaxOutputBytes(maxOutputBytes: number | undefined): number {
  const value = maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_CONFIGURED_OUTPUT_BYTES
  ) {
    throw new RangeError(
      `maxOutputBytes must be an integer between 0 and ${MAX_CONFIGURED_OUTPUT_BYTES}`,
    );
  }
  return value;
}

function getShellCommand(cmd: string, args: string[]): { cmd: string; args: string[] } {
  if (isWindowsPlatform()) {
    return { cmd: "cmd.exe", args: ["/d", "/s", "/c", cmd, ...args] };
  }
  if (args.length === 0) return { cmd: "sh", args: ["-c", cmd] };
  return { cmd: "sh", args: ["-c", 'exec "$@"', "sh", cmd, ...args] };
}

function getCommandEnvironment(
  cmdEnv: Record<string, string> | undefined,
  clearEnv: boolean,
): Record<string, string> | undefined {
  if (clearEnv) return { ...cmdEnv };
  if (!cmdEnv) return undefined;

  const inheritedEnvironment: Record<string, string> = {};
  for (const [key, value] of Object.entries(runtimeProcess?.env ?? {})) {
    if (typeof value === "string") inheritedEnvironment[key] = value;
  }
  return { ...inheritedEnvironment, ...cmdEnv };
}

function getSpawnErrorIdentifier(error: unknown): string | undefined {
  if ((typeof error !== "object" && typeof error !== "function") || error === null) {
    return undefined;
  }

  for (const property of ["code", "name"] as const) {
    try {
      const value = Reflect.get(error, property);
      if (
        typeof value === "string" &&
        value.length <= 64 &&
        /^[A-Za-z][A-Za-z0-9_]*$/.test(value)
      ) {
        return value;
      }
    } catch {
      // Ignore hostile error accessors and use the generic message.
    }
  }
  return undefined;
}

function createSpawnFailure(error: unknown, capture: boolean): CommandResult {
  const identifier = getSpawnErrorIdentifier(error);
  return {
    success: false,
    code: 1,
    stderr: capture ? `Unable to start command${identifier ? ` (${identifier})` : ""}` : undefined,
  };
}

function createTimeoutResult(
  timeoutMs: number,
  stdout?: string,
  stderr?: string,
): CommandResult {
  const diagnostic = `Command timed out after ${timeoutMs}ms`;
  return {
    success: false,
    code: COMMAND_TIMEOUT_EXIT_CODE,
    stdout,
    stderr: stderr ? `${stderr}\n${diagnostic}` : diagnostic,
  };
}

function createOutputLimitResult(
  maxOutputBytes: number,
  stdout?: string,
  stderr?: string,
): CommandResult {
  const diagnostic = `Command captured output exceeded ${maxOutputBytes} bytes`;
  return {
    success: false,
    code: COMMAND_OUTPUT_LIMIT_EXIT_CODE,
    stdout,
    stderr: stderr ? `${stderr}\n${diagnostic}` : diagnostic,
    outputLimitExceeded: true,
  };
}

function createAbortResult(stdout?: string, stderr?: string): CommandResult {
  const diagnostic = "Command aborted";
  return {
    success: false,
    code: COMMAND_ABORT_EXIT_CODE,
    stdout,
    stderr: stderr ? `${stderr}\n${diagnostic}` : diagnostic,
  };
}

interface ProcessAbort {
  hasAborted(): boolean;
  clear(): void;
}

function createProcessAbort(
  signal: AbortSignal | undefined,
  terminate: () => void,
  forceTerminate: () => void,
): ProcessAbort {
  let aborted = false;
  let forceKillId: ReturnType<typeof setTimeout> | undefined;

  const onAbort = () => {
    if (aborted) return;
    aborted = true;
    try {
      terminate();
    } catch {
      // The child may have exited between signal delivery and termination.
    }
    forceKillId = setTimeout(() => {
      try {
        forceTerminate();
      } catch {
        // The child may have exited during the graceful termination window.
      }
    }, FORCE_KILL_GRACE_MS);
  };

  if (signal) {
    signal.addEventListener("abort", onAbort, { once: true });
    // Close the race between the caller's pre-spawn check and listener setup.
    if (signal.aborted) onAbort();
  }

  return {
    hasAborted: () => aborted,
    clear: () => {
      signal?.removeEventListener("abort", onAbort);
      if (forceKillId) clearTimeout(forceKillId);
    },
  };
}

function createProcessTimeout(
  timeoutMs: number | undefined,
  terminate: () => void,
  forceTerminate: () => void,
): { hasTimedOut: () => boolean; clear: () => void } {
  let timedOut = false;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let forceKillId: ReturnType<typeof setTimeout> | undefined;

  if (timeoutMs && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      timedOut = true;
      try {
        terminate();
      } catch (_) {
        /* expected: best-effort terminate may fail if process already exited */
      }

      forceKillId = setTimeout(() => {
        try {
          forceTerminate();
        } catch (_) {
          /* expected: best-effort force terminate may fail if process already exited */
        }
      }, FORCE_KILL_GRACE_MS);
    }, timeoutMs);
  }

  return {
    hasTimedOut: () => timedOut,
    clear: () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (forceKillId) clearTimeout(forceKillId);
    },
  };
}

interface OutputCaptureBudget {
  take(chunk: Uint8Array): Uint8Array | undefined;
  hasExceeded(): boolean;
  clear(): void;
}

function createOutputCaptureBudget(
  maxOutputBytes: number,
  terminate: () => void,
  forceTerminate: () => void,
): OutputCaptureBudget {
  let capturedBytes = 0;
  let exceeded = false;
  let forceKillId: ReturnType<typeof setTimeout> | undefined;

  return {
    take(chunk: Uint8Array): Uint8Array | undefined {
      if (exceeded || chunk.byteLength === 0) return undefined;
      const remaining = maxOutputBytes - capturedBytes;
      if (chunk.byteLength <= remaining) {
        capturedBytes += chunk.byteLength;
        return chunk;
      }

      const retained = remaining > 0 ? chunk.slice(0, remaining) : undefined;
      capturedBytes += retained?.byteLength ?? 0;
      exceeded = true;
      try {
        terminate();
      } catch {
        // The child may have exited between producing output and termination.
      }
      forceKillId = setTimeout(() => {
        try {
          forceTerminate();
        } catch {
          // The child may have exited during the graceful termination window.
        }
      }, FORCE_KILL_GRACE_MS);
      return retained;
    },
    hasExceeded: () => exceeded,
    clear: () => {
      if (forceKillId) clearTimeout(forceKillId);
    },
  };
}

async function readStreamToString(
  stream: ReadableStream<Uint8Array>,
  budget: OutputCaptureBudget,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      const retained = budget.take(value);
      if (retained) chunks.push(retained);
    }
  }

  const total = chunks.reduce((acc, c) => acc + c.length, 0);
  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }

  return new TextDecoder().decode(merged);
}

/**
 * Run a command and return the result.
 * Works across Deno, Node.js, and Bun.
 *
 * @param cmd - Command to run
 * @param options - Command options
 * @param options.capture - Capture stdout/stderr to return in result
 * @param options.inherit - Inherit stdio from parent (shows output in terminal)
 * @param options.shell - Use shell to run command (needed for .cmd on Windows)
 * @param options.signal - Abort signal that prevents or terminates execution
 * @param options.maxOutputBytes - Maximum combined captured stdout and stderr bytes
 */
export async function runCommand(
  cmd: string,
  options: CommandOptions = {},
): Promise<CommandResult> {
  const {
    args: inputArgs = [],
    cwd: cmdCwd,
    env: inputEnv,
    clearEnv = false,
    capture = false,
    inherit = false,
    shell = false,
    timeoutMs,
    signal,
    maxOutputBytes,
  } = options;
  const args = [...inputArgs];
  const cmdEnv = inputEnv ? { ...inputEnv } : undefined;
  const effectiveTimeoutMs = validateTimeout(timeoutMs);
  const effectiveMaxOutputBytes = validateMaxOutputBytes(maxOutputBytes);
  const shouldCapture = capture && !inherit;
  if (signal?.aborted) return createAbortResult();

  // Determine stdio mode: inherit > capture > null
  const stdioMode = inherit ? "inherit" : shouldCapture ? "piped" : "null";

  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) {
    const commandSpec = shell ? getShellCommand(cmd, args) : { cmd, args };
    const command = new deno.Command(commandSpec.cmd, {
      args: commandSpec.args,
      cwd: cmdCwd,
      env: cmdEnv,
      clearEnv,
      stdin: inherit ? "inherit" : "null",
      stdout: stdioMode,
      stderr: stdioMode,
    });

    let child: Deno.ChildProcess;
    try {
      child = command.spawn();
    } catch (error) {
      return createSpawnFailure(error, shouldCapture);
    }
    const timeout = createProcessTimeout(
      effectiveTimeoutMs,
      () => child.kill("SIGTERM"),
      () => child.kill("SIGKILL"),
    );
    const processAbort = createProcessAbort(
      signal,
      () => child.kill("SIGTERM"),
      () => child.kill("SIGKILL"),
    );
    const outputBudget = createOutputCaptureBudget(
      effectiveMaxOutputBytes,
      () => child.kill("SIGTERM"),
      () => child.kill("SIGKILL"),
    );

    try {
      const [status, stdout, stderr] = await Promise.all([
        child.status,
        shouldCapture && child.stdout
          ? readStreamToString(child.stdout, outputBudget)
          : Promise.resolve(undefined),
        shouldCapture && child.stderr
          ? readStreamToString(child.stderr, outputBudget)
          : Promise.resolve(undefined),
      ]);

      if (outputBudget.hasExceeded()) {
        return createOutputLimitResult(effectiveMaxOutputBytes, stdout, stderr);
      }
      if (processAbort.hasAborted()) {
        return createAbortResult(stdout, stderr);
      }
      if (timeout.hasTimedOut()) {
        return createTimeoutResult(effectiveTimeoutMs ?? 0, stdout, stderr);
      }

      return {
        success: status.success,
        code: status.code,
        stdout,
        stderr,
      };
    } finally {
      timeout.clear();
      processAbort.clear();
      outputBudget.clear();
    }
  }

  if (IS_BUN) {
    const bunGlobal = globalThis as unknown as {
      Bun: {
        spawn: (options: {
          cmd: string[];
          cwd?: string;
          env?: Record<string, string>;
          stdout?: "pipe" | "inherit" | "ignore";
          stderr?: "pipe" | "inherit" | "ignore";
        }) => {
          exited: Promise<number>;
          stdout: ReadableStream<Uint8Array> | null;
          stderr: ReadableStream<Uint8Array> | null;
          kill?: (signal?: string | number) => void;
        };
      };
    };

    const bunStdio = inherit ? "inherit" : shouldCapture ? "pipe" : "ignore";

    const commandSpec = shell ? getShellCommand(cmd, args) : { cmd, args };
    let proc: ReturnType<typeof bunGlobal.Bun.spawn>;
    try {
      proc = bunGlobal.Bun.spawn({
        cmd: [commandSpec.cmd, ...commandSpec.args],
        cwd: cmdCwd,
        env: getCommandEnvironment(cmdEnv, clearEnv),
        stdout: bunStdio,
        stderr: bunStdio,
      });
    } catch (error) {
      return createSpawnFailure(error, shouldCapture);
    }

    const timeout = createProcessTimeout(
      effectiveTimeoutMs,
      () => proc.kill?.("SIGTERM"),
      () => proc.kill?.("SIGKILL"),
    );
    const processAbort = createProcessAbort(
      signal,
      () => proc.kill?.("SIGTERM"),
      () => proc.kill?.("SIGKILL"),
    );
    const outputBudget = createOutputCaptureBudget(
      effectiveMaxOutputBytes,
      () => proc.kill?.("SIGTERM"),
      () => proc.kill?.("SIGKILL"),
    );

    try {
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        shouldCapture && proc.stdout
          ? readStreamToString(proc.stdout, outputBudget)
          : Promise.resolve(undefined),
        shouldCapture && proc.stderr
          ? readStreamToString(proc.stderr, outputBudget)
          : Promise.resolve(undefined),
      ]);

      if (outputBudget.hasExceeded()) {
        return createOutputLimitResult(effectiveMaxOutputBytes, stdout, stderr);
      }
      if (processAbort.hasAborted()) {
        return createAbortResult(stdout, stderr);
      }
      if (timeout.hasTimedOut()) {
        return createTimeoutResult(effectiveTimeoutMs ?? 0, stdout, stderr);
      }

      return { success: code === 0, code, stdout, stderr };
    } finally {
      timeout.clear();
      processAbort.clear();
      outputBudget.clear();
    }
  }

  if (!runtimeProcess) return { success: false, code: 1 };

  const { spawn } = await dynamicImport<typeof import("node:child_process")>("node:child_process");

  const nodeStdio: [
    "ignore" | "inherit" | "pipe",
    "ignore" | "inherit" | "pipe",
    "ignore" | "inherit" | "pipe",
  ] = inherit
    ? ["inherit", "inherit", "inherit"]
    : shouldCapture
    ? ["ignore", "pipe", "pipe"]
    : ["ignore", "ignore", "ignore"];

  return await new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      const commandSpec = shell ? getShellCommand(cmd, args) : { cmd, args };
      child = spawn(commandSpec.cmd, commandSpec.args, {
        cwd: cmdCwd,
        env: getCommandEnvironment(cmdEnv, clearEnv),
        stdio: nodeStdio,
      });
    } catch (error) {
      resolve(createSpawnFailure(error, shouldCapture));
      return;
    }

    let stdout = "";
    let stderr = "";
    let settled = false;
    const stdoutDecoder = new TextDecoder();
    const stderrDecoder = new TextDecoder();
    const timeout = createProcessTimeout(
      effectiveTimeoutMs,
      () => child.kill("SIGTERM"),
      () => child.kill("SIGKILL"),
    );
    const processAbort = createProcessAbort(
      signal,
      () => child.kill("SIGTERM"),
      () => child.kill("SIGKILL"),
    );
    const outputBudget = createOutputCaptureBudget(
      effectiveMaxOutputBytes,
      () => child.kill("SIGTERM"),
      () => child.kill("SIGKILL"),
    );

    if (shouldCapture) {
      child.stdout?.on("data", (data: Uint8Array) => {
        const retained = outputBudget.take(data);
        if (retained) stdout += stdoutDecoder.decode(retained, { stream: true });
      });
      child.stderr?.on("data", (data: Uint8Array) => {
        const retained = outputBudget.take(data);
        if (retained) stderr += stderrDecoder.decode(retained, { stream: true });
      });
    }

    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      timeout.clear();
      processAbort.clear();
      outputBudget.clear();
      if (shouldCapture) {
        stdout += stdoutDecoder.decode();
        stderr += stderrDecoder.decode();
      }

      if (outputBudget.hasExceeded()) {
        resolve(
          createOutputLimitResult(
            effectiveMaxOutputBytes,
            shouldCapture ? stdout : undefined,
            shouldCapture ? stderr : undefined,
          ),
        );
        return;
      }

      if (processAbort.hasAborted()) {
        resolve(
          createAbortResult(
            shouldCapture ? stdout : undefined,
            shouldCapture ? stderr : undefined,
          ),
        );
        return;
      }

      if (timeout.hasTimedOut()) {
        resolve(
          createTimeoutResult(
            effectiveTimeoutMs ?? 0,
            shouldCapture ? stdout : undefined,
            shouldCapture ? stderr : undefined,
          ),
        );
        return;
      }

      resolve({
        success: code === 0,
        code: code ?? 1,
        stdout: shouldCapture ? stdout : undefined,
        stderr: shouldCapture ? stderr : undefined,
      });
    });

    child.on("error", (spawnError: Error) => {
      if (settled) return;
      settled = true;
      timeout.clear();
      processAbort.clear();
      outputBudget.clear();
      resolve(
        outputBudget.hasExceeded()
          ? createOutputLimitResult(
            effectiveMaxOutputBytes,
            shouldCapture ? stdout : undefined,
            shouldCapture ? stderr : undefined,
          )
          : processAbort.hasAborted()
          ? createAbortResult(
            shouldCapture ? stdout : undefined,
            shouldCapture ? stderr : undefined,
          )
          : createSpawnFailure(spawnError, shouldCapture),
      );
    });
  });
}
