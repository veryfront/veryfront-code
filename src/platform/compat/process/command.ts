import { dynamicImport } from "../dynamic-import.ts";
import { getDenoRuntime, isBun as IS_BUN, isDeno as IS_DENO } from "../runtime.ts";
import { isWindowsPlatform, runtimeProcess } from "./runtime-process.ts";

export interface CommandResult {
  success: boolean;
  code: number;
  stdout?: string;
  stderr?: string;
  /** True when captured output exceeded the configured byte limit. */
  outputTruncated?: boolean;
}

export interface CommandOptions {
  args?: string[];
  cwd?: string;
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
   * Maximum combined stdout and stderr bytes retained when `capture` is true.
   *
   * @default 16777216
   */
  maxOutputBytes?: number;
}

const COMMAND_TIMEOUT_EXIT_CODE = 124;
const COMMAND_OUTPUT_LIMIT_EXIT_CODE = 125;
const FORCE_KILL_GRACE_MS = 250;
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

type TerminationReason = "output-limit" | "timeout";

function createTerminationResult(
  reason: TerminationReason,
  detail: number,
  stdout?: string,
  stderr?: string,
): CommandResult {
  const message = reason === "timeout"
    ? `Command timed out after ${detail}ms`
    : `Command output exceeded ${detail} bytes`;
  return {
    success: false,
    code: reason === "timeout" ? COMMAND_TIMEOUT_EXIT_CODE : COMMAND_OUTPUT_LIMIT_EXIT_CODE,
    stdout,
    stderr: `${stderr ?? ""}\n${message}`.trim(),
    outputTruncated: reason === "output-limit" || undefined,
  };
}

function createProcessGuard(
  timeoutMs: number | undefined,
  terminate: () => void,
  forceTerminate: () => void,
): {
  stop: (reason: TerminationReason) => void;
  reason: () => TerminationReason | null;
  clear: () => void;
} {
  let terminationReason: TerminationReason | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let forceKillId: ReturnType<typeof setTimeout> | undefined;

  if (timeoutMs && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      stop("timeout");
    }, timeoutMs);
  }

  return {
    stop,
    reason: () => terminationReason,
    clear: () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (forceKillId) clearTimeout(forceKillId);
    },
  };

  function stop(reason: TerminationReason): void {
    if (terminationReason !== null) return;
    terminationReason = reason;
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
  }
}

interface CaptureBudget {
  remaining: number;
  exceeded: boolean;
  onExceeded: () => void;
}

function createCaptureBudget(
  maxOutputBytes: number,
  onExceeded: () => void,
): CaptureBudget {
  return {
    remaining: maxOutputBytes,
    exceeded: false,
    onExceeded,
  };
}

function captureChunk(
  chunks: Uint8Array[],
  chunk: Uint8Array,
  budget: CaptureBudget,
): void {
  const available = budget.remaining;
  if (available > 0) {
    const retained = chunk.byteLength <= available ? chunk.slice() : chunk.slice(0, available);
    chunks.push(retained);
    budget.remaining -= retained.byteLength;
  }

  if (chunk.byteLength > available && !budget.exceeded) {
    budget.exceeded = true;
    budget.onExceeded();
  }
}

function decodeChunks(chunks: readonly Uint8Array[]): string {
  const total = chunks.reduce((acc, chunk) => acc + chunk.byteLength, 0);
  const merged = new Uint8Array(total);
  let offset = 0;

  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new TextDecoder().decode(merged);
}

async function readStreamToString(
  stream: ReadableStream<Uint8Array>,
  budget: CaptureBudget,
): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) captureChunk(chunks, value, budget);
  }

  return decodeChunks(chunks);
}

function resolveShellCommand(
  cmd: string,
  args: readonly string[],
): { cmd: string; args: string[] } {
  if (isWindowsPlatform()) {
    return { cmd: "cmd", args: ["/d", "/s", "/c", cmd, ...args] };
  }
  if (args.length === 0) {
    return { cmd: "sh", args: ["-c", cmd] };
  }
  return {
    cmd: "sh",
    args: ["-c", 'exec "$@"', "sh", cmd, ...args],
  };
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
 */
export async function runCommand(
  cmd: string,
  options: CommandOptions = {},
): Promise<CommandResult> {
  const {
    args = [],
    cwd: cmdCwd,
    env: cmdEnv,
    clearEnv = false,
    capture = false,
    inherit = false,
    shell = false,
    timeoutMs,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  } = options;
  const effectiveTimeoutMs = timeoutMs && timeoutMs > 0 ? Math.floor(timeoutMs) : undefined;
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new RangeError("maxOutputBytes must be a positive safe integer");
  }

  // Determine stdio mode: inherit > capture > null
  const shouldCapture = capture && !inherit;
  const stdioMode = inherit ? "inherit" : shouldCapture ? "piped" : "null";

  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) {
    const denoCommand = shell ? resolveShellCommand(cmd, args) : { cmd, args };
    const command = new deno.Command(denoCommand.cmd, {
      args: [...denoCommand.args],
      cwd: cmdCwd,
      env: cmdEnv,
      clearEnv,
      stdin: inherit ? "inherit" : "null",
      stdout: stdioMode,
      stderr: stdioMode,
    });

    const child = command.spawn();
    const guard = createProcessGuard(
      effectiveTimeoutMs,
      () => child.kill("SIGTERM"),
      () => child.kill("SIGKILL"),
    );
    const captureBudget = createCaptureBudget(
      maxOutputBytes,
      () => guard.stop("output-limit"),
    );

    try {
      const [status, stdout, stderr] = await Promise.all([
        child.status,
        shouldCapture && child.stdout
          ? readStreamToString(child.stdout, captureBudget)
          : Promise.resolve(undefined),
        shouldCapture && child.stderr
          ? readStreamToString(child.stderr, captureBudget)
          : Promise.resolve(undefined),
      ]);

      const reason = guard.reason();
      if (reason) {
        return createTerminationResult(
          reason,
          reason === "timeout" ? effectiveTimeoutMs ?? 0 : maxOutputBytes,
          stdout,
          stderr,
        );
      }

      return {
        success: status.success,
        code: status.code,
        stdout,
        stderr,
      };
    } finally {
      guard.clear();
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

    const shellCommand = shell ? resolveShellCommand(cmd, args) : null;
    const bunCmd = shellCommand ? [shellCommand.cmd, ...shellCommand.args] : [cmd, ...args];

    const proc = bunGlobal.Bun.spawn({
      cmd: bunCmd,
      cwd: cmdCwd,
      env: clearEnv ? cmdEnv ?? {} : cmdEnv,
      stdout: bunStdio,
      stderr: bunStdio,
    });

    const guard = createProcessGuard(
      effectiveTimeoutMs,
      () => proc.kill?.("SIGTERM"),
      () => proc.kill?.("SIGKILL"),
    );
    const captureBudget = createCaptureBudget(
      maxOutputBytes,
      () => guard.stop("output-limit"),
    );

    try {
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        shouldCapture && proc.stdout
          ? readStreamToString(proc.stdout, captureBudget)
          : Promise.resolve(undefined),
        shouldCapture && proc.stderr
          ? readStreamToString(proc.stderr, captureBudget)
          : Promise.resolve(undefined),
      ]);

      const reason = guard.reason();
      if (reason) {
        return createTerminationResult(
          reason,
          reason === "timeout" ? effectiveTimeoutMs ?? 0 : maxOutputBytes,
          stdout,
          stderr,
        );
      }

      return { success: code === 0, code, stdout, stderr };
    } finally {
      guard.clear();
    }
  }

  if (!runtimeProcess) return { success: false, code: 1 };
  const process = runtimeProcess;

  const { spawn } = await dynamicImport<typeof import("node:child_process")>("node:child_process");

  const nodeStdio: [
    "ignore" | "inherit" | "pipe",
    "ignore" | "inherit" | "pipe",
    "ignore" | "inherit" | "pipe",
  ] = inherit
    ? ["inherit", "inherit", "inherit"]
    : capture
    ? ["ignore", "pipe", "pipe"]
    : ["ignore", "ignore", "ignore"];

  return await new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: cmdCwd,
      env: clearEnv ? cmdEnv ?? {} : cmdEnv ? { ...process.env, ...cmdEnv } : undefined,
      stdio: nodeStdio,
      shell,
    });

    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    const guard = createProcessGuard(
      effectiveTimeoutMs,
      () => child.kill("SIGTERM"),
      () => child.kill("SIGKILL"),
    );
    const captureBudget = createCaptureBudget(
      maxOutputBytes,
      () => guard.stop("output-limit"),
    );

    if (shouldCapture) {
      child.stdout?.on("data", (data: Uint8Array) => {
        captureChunk(stdoutChunks, data, captureBudget);
      });
      child.stderr?.on("data", (data: Uint8Array) => {
        captureChunk(stderrChunks, data, captureBudget);
      });
    }

    child.on("close", (code) => {
      guard.clear();
      const stdout = shouldCapture ? decodeChunks(stdoutChunks) : undefined;
      const stderr = shouldCapture ? decodeChunks(stderrChunks) : undefined;

      const reason = guard.reason();
      if (reason) {
        resolve(
          createTerminationResult(
            reason,
            reason === "timeout" ? effectiveTimeoutMs ?? 0 : maxOutputBytes,
            stdout,
            stderr,
          ),
        );
        return;
      }

      resolve({
        success: code === 0,
        code: code ?? 1,
        stdout,
        stderr,
      });
    });

    child.on("error", (spawnError: Error) => {
      guard.clear();
      const stdout = shouldCapture ? decodeChunks(stdoutChunks) : undefined;
      const stderr = shouldCapture ? decodeChunks(stderrChunks) : undefined;
      // Include the spawn error message so callers can distinguish ENOENT
      // ("command not found"), EACCES ("permission denied"), etc.
      resolve({
        success: false,
        code: 1,
        stdout,
        stderr: shouldCapture
          ? (stderr
            ? `${stderr}\nSpawn error: ${spawnError.message}`
            : `Spawn error: ${spawnError.message}`)
          : undefined,
      });
    });
  });
}
