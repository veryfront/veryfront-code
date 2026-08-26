import { dynamicImport } from "../dynamic-import.ts";
import {
  addAbortSignalListenerOnce,
  isAbortSignalAborted,
  isAbortSignalWithoutHooks,
  removeAbortSignalListener,
} from "../abort-signal.ts";
import { getDenoRuntime, isBun as IS_BUN, isDeno as IS_DENO } from "../runtime.ts";
import { env as getProcessEnvironment } from "./env.ts";
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
  /**
   * Kill the command after this duration in milliseconds. Positive values are
   * floored to whole milliseconds and clamped to the portable timer maximum;
   * `undefined`, non-positive values, and NaN disable the timeout.
   */
  timeoutMs?: number;
  /** Terminate the command when the caller cancels. */
  signal?: AbortSignal;
  /**
   * Best-effort process-tree cleanup after the managed command settles.
   * Disabled by default so generic callers retain normal daemon/background
   * process behavior. Sandboxed or otherwise lifecycle-owning callers can
   * enable it to prevent ordinary descendants from outliving the command.
   */
  terminateProcessTreeOnExit?: boolean;
  /**
   * Maximum combined stdout and stderr bytes retained when `capture` is true.
   *
   * @default 16777216
   */
  maxOutputBytes?: number;
}

const COMMAND_TIMEOUT_EXIT_CODE = 124;
const COMMAND_OUTPUT_LIMIT_EXIT_CODE = 125;
const COMMAND_ABORT_EXIT_CODE = 130;
const FORCE_KILL_GRACE_MS = 250;
const DEFAULT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
const MAX_COMMAND_TIMEOUT_MS = 2_147_483_647;
const apply = Reflect.apply;
const uint8ArraySlice = Uint8Array.prototype.slice;

type TerminationReason = "abort" | "output-limit" | "timeout";
type TerminationSignal = "SIGKILL" | "SIGTERM";

interface BunCommandProcess {
  exited: Promise<number>;
  stdout: ReadableStream<Uint8Array> | null;
  stderr: ReadableStream<Uint8Array> | null;
  pid: number;
  kill?: (signal?: string | number) => void;
  unref?: () => void;
}

interface BunCommandRuntime {
  spawn: (options: {
    cmd: string[];
    cwd?: string;
    detached?: boolean;
    env?: Record<string, string>;
    stdout?: "pipe" | "inherit" | "ignore";
    stderr?: "pipe" | "inherit" | "ignore";
  }) => BunCommandProcess;
}

function createTerminationResult(
  reason: TerminationReason,
  detail: number,
  stdout?: string,
  stderr?: string,
  outputTruncated = reason === "output-limit",
): CommandResult {
  const message = reason === "timeout"
    ? `Command timed out after ${detail}ms`
    : reason === "output-limit"
    ? `Command output exceeded ${detail} bytes`
    : "Command aborted";
  return {
    success: false,
    code: reason === "timeout"
      ? COMMAND_TIMEOUT_EXIT_CODE
      : reason === "output-limit"
      ? COMMAND_OUTPUT_LIMIT_EXIT_CODE
      : COMMAND_ABORT_EXIT_CODE,
    stdout,
    stderr: `${stderr ?? ""}\n${message}`.trim(),
    outputTruncated: outputTruncated || undefined,
  };
}

function validateAbortSignal(signal: unknown): asserts signal is AbortSignal | undefined {
  if (signal === undefined) return;
  if (!isAbortSignalWithoutHooks(signal)) {
    throw new TypeError("signal must be an AbortSignal");
  }
}

function resolveCommandTimeoutMs(timeoutMs: unknown): number | undefined {
  if (typeof timeoutMs !== "number" || !(timeoutMs > 0)) return undefined;
  return Math.min(Math.floor(timeoutMs), MAX_COMMAND_TIMEOUT_MS);
}

/** @internal Exported so Windows tree-termination arguments can be tested on every host. */
export function buildWindowsTaskkillArgs(pid: number, force: boolean): string[] {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    throw new RangeError("Windows taskkill pid must be a positive safe integer");
  }
  return ["/PID", String(pid), "/T", ...(force ? ["/F"] : [])];
}

function tryDirectSignal(
  signalDirect: (signal: TerminationSignal) => void,
  signal: TerminationSignal,
): void {
  try {
    signalDirect(signal);
  } catch {
    // The target may have exited before taskkill failure became observable.
  }
}

function tryForceSettledProcessTree(
  signalTree: (signal: TerminationSignal) => void,
): void {
  try {
    signalTree("SIGKILL");
  } catch {
    // A settled command with no remaining descendants has no process group or
    // live direct handle. Cleanup is intentionally idempotent in that case.
  }
}

function signalWindowsTreeWithDeno(
  deno: typeof Deno,
  pid: number | undefined,
  force: boolean,
  signalDirect: (signal: TerminationSignal) => void,
): void {
  const signal = force ? "SIGKILL" : "SIGTERM";
  if (!Number.isSafeInteger(pid) || (pid ?? 0) <= 0) {
    tryDirectSignal(signalDirect, signal);
    return;
  }

  try {
    const taskkill = new deno.Command("taskkill", {
      args: buildWindowsTaskkillArgs(pid as number, force),
      stdin: "null",
      stdout: "null",
      stderr: "null",
    }).spawn();
    void taskkill.status.then((status) => {
      if (!status.success) tryDirectSignal(signalDirect, signal);
    }).catch(() => tryDirectSignal(signalDirect, signal));
  } catch {
    tryDirectSignal(signalDirect, signal);
  }
}

function signalWindowsTreeWithBun(
  bun: BunCommandRuntime,
  pid: number | undefined,
  force: boolean,
  signalDirect: (signal: TerminationSignal) => void,
): void {
  const signal = force ? "SIGKILL" : "SIGTERM";
  if (!Number.isSafeInteger(pid) || (pid ?? 0) <= 0) {
    tryDirectSignal(signalDirect, signal);
    return;
  }

  try {
    const taskkill = bun.spawn({
      cmd: ["taskkill", ...buildWindowsTaskkillArgs(pid as number, force)],
      stdout: "ignore",
      stderr: "ignore",
    });
    taskkill.unref?.();
    void taskkill.exited.then((code) => {
      if (code !== 0) tryDirectSignal(signalDirect, signal);
    }).catch(() => tryDirectSignal(signalDirect, signal));
  } catch {
    tryDirectSignal(signalDirect, signal);
  }
}

function signalWindowsTreeWithNode(
  spawn: typeof import("node:child_process").spawn,
  pid: number | undefined,
  force: boolean,
  signalDirect: (signal: TerminationSignal) => void,
): void {
  const signal = force ? "SIGKILL" : "SIGTERM";
  if (!Number.isSafeInteger(pid) || (pid ?? 0) <= 0) {
    tryDirectSignal(signalDirect, signal);
    return;
  }

  try {
    const taskkill = spawn("taskkill", buildWindowsTaskkillArgs(pid as number, force), {
      stdio: "ignore",
      windowsHide: true,
    });
    taskkill.once("error", () => tryDirectSignal(signalDirect, signal));
    taskkill.once("close", (code) => {
      if (code !== 0) tryDirectSignal(signalDirect, signal);
    });
  } catch {
    tryDirectSignal(signalDirect, signal);
  }
}

function signalProcessTree(
  pid: number | undefined,
  signal: TerminationSignal,
  detachedProcessGroup: boolean,
  signalGroup: (processGroupId: number, signal: TerminationSignal) => void,
  signalDirect: (signal: TerminationSignal) => void,
): void {
  if (detachedProcessGroup && Number.isSafeInteger(pid) && (pid ?? 0) > 0) {
    try {
      signalGroup(-(pid as number), signal);
      return;
    } catch (_) {
      // The child may have exited before its process group became observable.
      // Fall through to the direct handle so cancellation remains best effort.
    }
  }
  signalDirect(signal);
}

function createProcessGuard(
  timeoutMs: number | undefined,
  signal: AbortSignal | undefined,
  terminate: () => void,
  forceTerminate: () => void,
  releaseAfterForce: () => void,
): {
  stop: (reason: TerminationReason) => void;
  reason: () => TerminationReason | null;
  clear: () => void;
} {
  let terminationReason: TerminationReason | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let forceKillId: ReturnType<typeof setTimeout> | undefined;
  let forceTerminationCompleted = false;
  const abortListener = () => stop("abort");

  if (timeoutMs && timeoutMs > 0) {
    timeoutId = setTimeout(() => {
      stop("timeout");
    }, timeoutMs);
  }
  if (signal) {
    addAbortSignalListenerOnce(signal, abortListener);
    if (isAbortSignalAborted(signal)) stop("abort");
  }

  return {
    stop,
    reason: () => terminationReason,
    clear: () => {
      if (timeoutId) clearTimeout(timeoutId);
      if (signal) removeAbortSignalListener(signal, abortListener);
      if (terminationReason === null) {
        if (forceKillId) clearTimeout(forceKillId);
        return;
      }

      // The directly managed process may settle after SIGTERM while a child in
      // its process group remains alive. Do not cancel escalation on that
      // abnormal settlement; force it immediately before releasing lifecycle
      // ownership.
      forceTerminateOnce();
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

    forceKillId = setTimeout(forceTerminateOnce, FORCE_KILL_GRACE_MS);
  }

  function forceTerminateOnce(): void {
    if (forceTerminationCompleted) return;
    forceTerminationCompleted = true;
    if (forceKillId) {
      clearTimeout(forceKillId);
      forceKillId = undefined;
    }
    try {
      forceTerminate();
    } catch (_) {
      /* expected: best-effort force terminate may fail if process already exited */
    } finally {
      releaseAfterForce();
    }
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
    // Invoke the typed-array intrinsic directly: Buffer#slice() returns a view
    // and can retain a much larger pooled backing allocation.
    const retained = apply(uint8ArraySlice, chunk, [
      0,
      Math.min(chunk.byteLength, available),
    ]);
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

interface StreamCapture {
  readonly result: Promise<string>;
  cancel(reason?: unknown): void;
}

function captureStreamToString(
  stream: ReadableStream<Uint8Array>,
  budget: CaptureBudget,
): StreamCapture {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let cancelled = false;

  return {
    result: (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (value) captureChunk(chunks, value, budget);
        }
      } catch (error) {
        if (!cancelled) throw error;
      } finally {
        reader.releaseLock();
      }
      return decodeChunks(chunks);
    })(),
    cancel: (reason?: unknown) => {
      if (cancelled) return;
      cancelled = true;
      try {
        const cancellation = reader.cancel(reason);
        void cancellation.catch(() => {});
      } catch {
        // The stream may already have closed between termination and release.
      }
    },
  };
}

function resolveShellCommand(
  cmd: string,
  args: readonly string[],
): { cmd: string; args: string[] } {
  if (isWindowsPlatform()) {
    return { cmd: "cmd.exe", args: ["/d", "/s", "/c", cmd, ...args] };
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
    signal,
    terminateProcessTreeOnExit = false,
    maxOutputBytes = DEFAULT_MAX_OUTPUT_BYTES,
  } = options;
  validateAbortSignal(signal);
  if (typeof terminateProcessTreeOnExit !== "boolean") {
    throw new TypeError("terminateProcessTreeOnExit must be a boolean");
  }
  const effectiveTimeoutMs = resolveCommandTimeoutMs(timeoutMs);
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes <= 0) {
    throw new RangeError("maxOutputBytes must be a positive safe integer");
  }
  if (signal && isAbortSignalAborted(signal)) {
    return createTerminationResult("abort", 0);
  }

  // Determine stdio mode: inherit > capture > null
  const shouldCapture = capture && !inherit;
  const stdioMode = inherit ? "inherit" : shouldCapture ? "piped" : "null";
  const detachedProcessGroup = !isWindowsPlatform() &&
    (
      effectiveTimeoutMs !== undefined ||
      signal !== undefined ||
      shouldCapture ||
      terminateProcessTreeOnExit
    );

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
      detached: detachedProcessGroup,
    });

    const child = command.spawn();
    const windowsPlatform = isWindowsPlatform();
    const directSignal = (terminationSignal: TerminationSignal) => child.kill(terminationSignal);
    const signalChild = (terminationSignal: TerminationSignal) =>
      windowsPlatform
        ? signalWindowsTreeWithDeno(
          deno,
          child.pid,
          terminationSignal === "SIGKILL",
          directSignal,
        )
        : signalProcessTree(
          child.pid,
          terminationSignal,
          detachedProcessGroup,
          (processGroupId, groupSignal) => deno.kill(processGroupId, groupSignal),
          directSignal,
        );
    const captures: { stdout?: StreamCapture; stderr?: StreamCapture } = {};
    const guard = createProcessGuard(
      effectiveTimeoutMs,
      signal,
      () => signalChild("SIGTERM"),
      () => signalChild("SIGKILL"),
      () => {
        const reason = new Error("Command capture closed after forced termination");
        captures.stdout?.cancel(reason);
        captures.stderr?.cancel(reason);
      },
    );
    const captureBudget = createCaptureBudget(
      maxOutputBytes,
      () => guard.stop("output-limit"),
    );
    captures.stdout = shouldCapture && child.stdout
      ? captureStreamToString(child.stdout, captureBudget)
      : undefined;
    captures.stderr = shouldCapture && child.stderr
      ? captureStreamToString(child.stderr, captureBudget)
      : undefined;

    try {
      const [status, stdout, stderr] = await Promise.all([
        child.status,
        captures.stdout?.result ?? Promise.resolve(undefined),
        captures.stderr?.result ?? Promise.resolve(undefined),
      ]);

      const reason = guard.reason();
      if (reason) {
        return createTerminationResult(
          reason,
          reason === "timeout" ? effectiveTimeoutMs ?? 0 : maxOutputBytes,
          stdout,
          stderr,
          captureBudget.exceeded,
        );
      }

      return {
        success: status.success,
        code: status.code,
        stdout,
        stderr,
      };
    } finally {
      if (terminateProcessTreeOnExit && guard.reason() === null) {
        tryForceSettledProcessTree(signalChild);
      }
      guard.clear();
    }
  }

  if (IS_BUN) {
    const bunGlobal = globalThis as typeof globalThis & {
      Bun: BunCommandRuntime;
    };

    const bunStdio = inherit ? "inherit" : shouldCapture ? "pipe" : "ignore";

    const shellCommand = shell ? resolveShellCommand(cmd, args) : null;
    const bunCmd = shellCommand ? [shellCommand.cmd, ...shellCommand.args] : [cmd, ...args];

    const proc = bunGlobal.Bun.spawn({
      cmd: bunCmd,
      cwd: cmdCwd,
      detached: detachedProcessGroup,
      env: clearEnv ? cmdEnv ?? {} : cmdEnv ? { ...getProcessEnvironment(), ...cmdEnv } : undefined,
      stdout: bunStdio,
      stderr: bunStdio,
    });

    const windowsPlatform = isWindowsPlatform();
    const directSignal = (terminationSignal: TerminationSignal) => proc.kill?.(terminationSignal);
    const signalChild = (terminationSignal: TerminationSignal) =>
      windowsPlatform
        ? signalWindowsTreeWithBun(
          bunGlobal.Bun,
          proc.pid,
          terminationSignal === "SIGKILL",
          directSignal,
        )
        : signalProcessTree(
          proc.pid,
          terminationSignal,
          detachedProcessGroup,
          (processGroupId, groupSignal) => {
            if (!runtimeProcess) throw new Error("Runtime process unavailable");
            runtimeProcess.kill(processGroupId, groupSignal);
          },
          directSignal,
        );
    const captures: { stdout?: StreamCapture; stderr?: StreamCapture } = {};
    const guard = createProcessGuard(
      effectiveTimeoutMs,
      signal,
      () => signalChild("SIGTERM"),
      () => signalChild("SIGKILL"),
      () => {
        const reason = new Error("Command capture closed after forced termination");
        captures.stdout?.cancel(reason);
        captures.stderr?.cancel(reason);
      },
    );
    const captureBudget = createCaptureBudget(
      maxOutputBytes,
      () => guard.stop("output-limit"),
    );
    captures.stdout = shouldCapture && proc.stdout
      ? captureStreamToString(proc.stdout, captureBudget)
      : undefined;
    captures.stderr = shouldCapture && proc.stderr
      ? captureStreamToString(proc.stderr, captureBudget)
      : undefined;

    try {
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        captures.stdout?.result ?? Promise.resolve(undefined),
        captures.stderr?.result ?? Promise.resolve(undefined),
      ]);

      const reason = guard.reason();
      if (reason) {
        return createTerminationResult(
          reason,
          reason === "timeout" ? effectiveTimeoutMs ?? 0 : maxOutputBytes,
          stdout,
          stderr,
          captureBudget.exceeded,
        );
      }

      return { success: code === 0, code, stdout, stderr };
    } finally {
      if (terminateProcessTreeOnExit && guard.reason() === null) {
        tryForceSettledProcessTree(signalChild);
      }
      guard.clear();
    }
  }

  if (!runtimeProcess) return { success: false, code: 1 };
  const process = runtimeProcess;

  const { spawn } = await dynamicImport<typeof import("node:child_process")>("node:child_process");
  if (signal && isAbortSignalAborted(signal)) {
    return createTerminationResult("abort", 0);
  }

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
      detached: detachedProcessGroup,
    });

    const stdoutChunks: Uint8Array[] = [];
    const stderrChunks: Uint8Array[] = [];
    const windowsPlatform = isWindowsPlatform();
    const directSignal = (terminationSignal: TerminationSignal) => child.kill(terminationSignal);
    const signalChild = (terminationSignal: TerminationSignal) =>
      windowsPlatform
        ? signalWindowsTreeWithNode(
          spawn,
          child.pid,
          terminationSignal === "SIGKILL",
          directSignal,
        )
        : signalProcessTree(
          child.pid,
          terminationSignal,
          detachedProcessGroup,
          (processGroupId, groupSignal) => process.kill(processGroupId, groupSignal),
          directSignal,
        );
    const guard = createProcessGuard(
      effectiveTimeoutMs,
      signal,
      () => signalChild("SIGTERM"),
      () => signalChild("SIGKILL"),
      () => {
        child.stdout?.destroy();
        child.stderr?.destroy();
      },
    );
    const captureBudget = createCaptureBudget(
      maxOutputBytes,
      () => guard.stop("output-limit"),
    );
    let resultSettled = false;

    const settleProcessOwnership = (): boolean => {
      if (resultSettled) return false;
      resultSettled = true;
      if (terminateProcessTreeOnExit && guard.reason() === null) {
        tryForceSettledProcessTree(signalChild);
      }
      guard.clear();
      return true;
    };

    if (shouldCapture) {
      child.stdout?.on("data", (data: Uint8Array) => {
        captureChunk(stdoutChunks, data, captureBudget);
      });
      child.stderr?.on("data", (data: Uint8Array) => {
        captureChunk(stderrChunks, data, captureBudget);
      });
    }

    child.on("close", (code) => {
      if (!settleProcessOwnership()) return;
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
            captureBudget.exceeded,
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
      if (!settleProcessOwnership()) return;
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
