import { isBun as IS_BUN, isDeno as IS_DENO } from "./runtime.ts";
import { dynamicImport } from "./dynamic-import.ts";

const nodeProcess = (globalThis as { process?: typeof import("node:process") }).process;
type RuntimeProcess = typeof import("node:process");

/**
 * Detect a real Node/Bun process object.
 * Browser bundles may inject `window.process = { env: {} }`, which is not enough
 * to safely call process APIs like cwd(), exit(), or on().
 */
export function testHasRuntimeProcess(processLike: unknown): processLike is RuntimeProcess {
  if (!processLike || typeof processLike !== "object") return false;
  const versions = (processLike as { versions?: { node?: string } }).versions;
  return typeof versions?.node === "string" && versions.node.length > 0;
}

const runtimeProcess = testHasRuntimeProcess(nodeProcess) ? nodeProcess : null;

function isWindowsPlatform(): boolean {
  if (IS_DENO) return Deno.build.os === "windows";
  const platform = runtimeProcess?.platform ??
    (globalThis as { process?: { platform?: string } }).process?.platform;
  return platform === "win32";
}

/** Get command-line arguments (cross-runtime: Deno.args or process.argv). */
export function getArgs(): string[] {
  if (IS_DENO) return Deno.args;
  if (runtimeProcess) return runtimeProcess.argv.slice(2);
  return [];
}

/** Exit the process with an optional code (cross-runtime: Deno.exit or process.exit). */
export function exit(code?: number): never {
  if (IS_DENO) Deno.exit(code);
  if (runtimeProcess) runtimeProcess.exit(code);
  throw new Error("exit() is not supported in this runtime");
}

export function cwd(): string {
  if (IS_DENO) return Deno.cwd();
  if (runtimeProcess) return runtimeProcess.cwd();
  throw new Error("cwd() is not supported in this runtime");
}

export function chdir(directory: string): void {
  if (IS_DENO) {
    Deno.chdir(directory);
    return;
  }
  if (runtimeProcess) {
    runtimeProcess.chdir(directory);
    return;
  }
  throw new Error("chdir() is not supported in this runtime");
}

export function env(): Record<string, string> {
  if (IS_DENO) return Deno.env.toObject();
  if (runtimeProcess) return runtimeProcess.env as Record<string, string>;
  return {};
}

// Lazy-loaded references to project-env/storage.ts functions.
// Uses globalThis to avoid circular imports (process.ts is low-level, project-env is high-level).
// IMPORTANT: Only cache when the real getter is found. If storage.ts hasn't loaded yet,
// re-check globalThis on every call to avoid permanently caching the fallback.
let _getProjectEnv: ((key: string) => string | undefined) | null = null;
let _isProjectEnvActive: (() => boolean) | null = null;

function getProjectEnvSafe(key: string): string | undefined {
  if (_getProjectEnv === null) {
    const mod = (globalThis as Record<string, unknown>).__vfProjectEnvGetter as
      | ((key: string) => string | undefined)
      | undefined;
    if (mod) {
      _getProjectEnv = mod;
    } else {
      return undefined;
    }
  }
  return _getProjectEnv(key);
}

function isProjectEnvActiveSafe(): boolean {
  if (_isProjectEnvActive === null) {
    const mod = (globalThis as Record<string, unknown>).__vfProjectEnvActiveChecker as
      | (() => boolean)
      | undefined;
    if (mod) {
      _isProjectEnvActive = mod;
    } else {
      return false;
    }
  }
  return _isProjectEnvActive();
}

export function getEnv(key: string): string | undefined {
  // Check per-request project env overlay first (AsyncLocalStorage)
  const projectValue = getProjectEnvSafe(key);
  if (projectValue !== undefined) return projectValue;

  // When a project env overlay is active (remote project request), do NOT
  // fall through to host process env. This prevents remote projects from
  // reading host-level secrets like AWS_SECRET_ACCESS_KEY, DATABASE_URL, etc.
  if (isProjectEnvActiveSafe()) return undefined;

  if (IS_DENO) return Deno.env.get(key);
  if (runtimeProcess) return runtimeProcess.env[key];
  return undefined;
}

const DEFAULT_ENV_TRUE_VALUES = ["1", "true", "yes"] as const;
const DEFAULT_ENV_FALSE_VALUES = ["0", "false", "no"] as const;

export interface EnvBooleanOptions {
  trueValues?: readonly string[];
  falseValues?: readonly string[];
  trim?: boolean;
  caseSensitive?: boolean;
}

function normalizeEnvToken(
  value: string,
  options: { trim: boolean; caseSensitive: boolean },
): string {
  const normalized = options.trim ? value.trim() : value;
  return options.caseSensitive ? normalized : normalized.toLowerCase();
}

export function getEnvString(key: string): string | undefined;
export function getEnvString(key: string, fallback: string): string;
export function getEnvString(key: string, fallback?: string): string | undefined {
  const value = getEnv(key);
  if (value === undefined) return fallback;
  return value;
}

export function getEnvNumber(key: string): number | undefined;
export function getEnvNumber(key: string, fallback: number): number;
export function getEnvNumber(key: string, fallback?: number): number | undefined {
  const value = getEnvString(key);
  if (value === undefined) return fallback;

  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return fallback ?? Number.NaN;
  return parsed;
}

export function getEnvBoolean(
  key: string,
  fallback = false,
  options: EnvBooleanOptions = {},
): boolean {
  const value = getEnvString(key);
  if (value === undefined) return fallback;

  const trim = options.trim ?? true;
  const caseSensitive = options.caseSensitive ?? false;
  const normalized = normalizeEnvToken(value, { trim, caseSensitive });

  const trueValues = options.trueValues ?? DEFAULT_ENV_TRUE_VALUES;
  for (const trueValue of trueValues) {
    if (normalized === normalizeEnvToken(trueValue, { trim, caseSensitive })) return true;
  }

  const falseValues = options.falseValues ?? DEFAULT_ENV_FALSE_VALUES;
  for (const falseValue of falseValues) {
    if (normalized === normalizeEnvToken(falseValue, { trim, caseSensitive })) return false;
  }

  return fallback;
}

export function setEnv(key: string, value: string): void {
  if (IS_DENO) {
    Deno.env.set(key, value);
    return;
  }
  if (runtimeProcess) {
    runtimeProcess.env[key] = value;
    return;
  }
  throw new Error("setEnv() is not supported in this runtime");
}

export function deleteEnv(key: string): void {
  if (IS_DENO) {
    Deno.env.delete(key);
    return;
  }
  if (runtimeProcess) {
    delete runtimeProcess.env[key];
    return;
  }
  throw new Error("deleteEnv() is not supported in this runtime");
}

type EnvOverlayStorage = {
  getStore: () => unknown;
  run?: <T>(store: unknown, fn: () => T) => T;
  enterWith?: (store: unknown) => void;
};

/**
 * Get an AsyncLocalStorage-based env overlay storage if installed.
 * This enables per-async-context env isolation (e.g., in tests).
 */
export function getEnvOverlayStorage(): EnvOverlayStorage | null {
  const globalAny = globalThis as Record<string, unknown>;
  const overlay =
    (globalAny["__vfTestDenoEnvOverlay"] as { storage?: EnvOverlayStorage } | undefined) ??
      (globalAny["__vfTestEnvOverlay"] as { storage?: EnvOverlayStorage } | undefined);

  const storage = overlay?.storage;
  if (!storage || typeof storage.getStore !== "function") return null;
  return storage;
}

export function pid(): number {
  if (IS_DENO) return Deno.pid;
  if (runtimeProcess) return runtimeProcess.pid;
  return 0;
}

export function memoryUsage(): {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
} {
  if (IS_DENO) {
    const { rss, heapTotal, heapUsed, external } = Deno.memoryUsage();
    return { rss, heapTotal, heapUsed, external };
  }

  if (!runtimeProcess) throw new Error("memoryUsage() is not supported in this runtime");

  const { rss, heapTotal, heapUsed, external } = runtimeProcess.memoryUsage();
  return { rss, heapTotal, heapUsed, external: external || 0 };
}

/**
 * Check if stdin is a TTY (terminal)
 */
export function isInteractive(): boolean {
  if (IS_DENO) return Deno.stdin.isTerminal();
  if (runtimeProcess) return runtimeProcess.stdin.isTTY ?? false;
  return false;
}

/**
 * Check if stdout is a TTY (terminal)
 */
export function isStdoutTTY(): boolean {
  if (IS_DENO) return Deno.stdout.isTerminal();
  if (runtimeProcess) return runtimeProcess.stdout.isTTY ?? false;
  return false;
}

/**
 * Get terminal size (columns and rows)
 * Returns default fallback values if terminal size cannot be determined
 */
export function getTerminalSize(): { columns: number; rows: number } {
  const defaultSize = { columns: 80, rows: 24 };

  if (IS_DENO) {
    try {
      const { columns, rows } = Deno.consoleSize();
      return { columns, rows };
    } catch (_) {
      /* expected: Deno.consoleSize() fails when not attached to a terminal */
      return defaultSize;
    }
  }

  if (!runtimeProcess) return defaultSize;

  const columns = runtimeProcess.stdout?.columns;
  const rows = runtimeProcess.stdout?.rows;
  if (columns && rows) return { columns, rows };

  return defaultSize;
}

/**
 * Get runtime version string
 */
export function getRuntimeVersion(): string {
  if (IS_DENO) return `Deno ${Deno.version.deno}`;
  if ("Bun" in globalThis) {
    return `Bun ${(globalThis as unknown as { Bun: { version: string } }).Bun.version}`;
  }
  if (runtimeProcess) return `Node.js ${runtimeProcess.version}`;
  return "unknown";
}

/**
 * Get the operating system type
 * Returns: "darwin" (macOS), "linux", "windows", or the raw platform string
 */
export function getOsType(): string {
  if (IS_DENO) return Deno.build.os;
  if (runtimeProcess) {
    // Node/Bun uses process.platform which returns "win32" for Windows
    const platform = runtimeProcess.platform;
    return platform === "win32" ? "windows" : platform;
  }
  return "unknown";
}

/**
 * Register a signal handler (SIGINT, SIGTERM) for graceful shutdown
 */
export function onSignal(
  signal: "SIGINT" | "SIGTERM",
  handler: () => void,
): void {
  if (IS_DENO) {
    Deno.addSignalListener(signal, handler);
    return;
  }
  if (runtimeProcess) runtimeProcess.on(signal, handler);
}

/**
 * Register global error handlers for uncaught exceptions and unhandled promise rejections.
 * These handlers prevent the process from crashing due to application code errors.
 *
 * IMPORTANT: These handlers should be registered early in the application lifecycle
 * to catch errors that escape try/catch blocks.
 *
 * @param onError - Callback invoked with the error. Return true to prevent process exit.
 */
export function onGlobalError(
  onError: (error: Error, type: "uncaughtException" | "unhandledRejection") => boolean | void,
): void {
  if (IS_DENO) {
    globalThis.addEventListener("error", (event) => {
      const error = event.error instanceof Error ? event.error : new Error(String(event.error));
      if (onError(error, "uncaughtException")) event.preventDefault();
    });

    globalThis.addEventListener("unhandledrejection", (event) => {
      const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      if (onError(error, "unhandledRejection")) event.preventDefault();
    });

    return;
  }

  if (!runtimeProcess) return;

  const handleNodeGlobalError = (
    error: Error,
    type: "uncaughtException" | "unhandledRejection",
  ): void => {
    let shouldPreventExit = false;
    try {
      shouldPreventExit = onError(error, type) === true;
    } catch (handlerError) {
      const handlerException = handlerError instanceof Error
        ? handlerError
        : new Error(String(handlerError));
      console.error("Global error handler threw while processing", type, handlerException);
    }

    if (shouldPreventExit) return;

    // Node/Bun suppress default fatal behavior when a listener is registered.
    // If the callback did not explicitly handle the error, exit to preserve
    // expected fatal semantics for uncaught exceptions and unhandled rejections.
    runtimeProcess.exit(1);
  };

  runtimeProcess.on("uncaughtException", (error: Error) => {
    handleNodeGlobalError(error, "uncaughtException");
  });

  runtimeProcess.on("unhandledRejection", (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    handleNodeGlobalError(error, "unhandledRejection");
  });
}

/**
 * Unreference a timer to prevent it from keeping the process alive
 */
export function unrefTimer(timerId: ReturnType<typeof setInterval>): void {
  if (IS_DENO && typeof Deno.unrefTimer === "function") {
    Deno.unrefTimer(timerId as number);
    return;
  }

  if (timerId && typeof timerId === "object" && "unref" in timerId) {
    (timerId as { unref: () => void }).unref();
  }
}

/**
 * Get the executable path of the current runtime
 */
export function execPath(): string {
  if (IS_DENO) return Deno.execPath();
  if (runtimeProcess) return runtimeProcess.execPath;
  return "";
}

/**
 * Get process uptime in seconds
 * Returns OS uptime on Deno, process uptime on Node.js
 */
export function uptime(): number {
  if (IS_DENO) {
    // Deno.osUptime() returns system uptime in seconds
    return Deno.osUptime?.() ?? 0;
  }
  if (runtimeProcess) {
    // process.uptime() returns process uptime in seconds
    return runtimeProcess.uptime?.() ?? 0;
  }
  return 0;
}

/**
 * Get stdout stream for writing
 * Returns null if not available (e.g., in browser/workers)
 */
export function getStdout(): { write: (data: string) => void } | null {
  if (IS_DENO) {
    const encoder = new TextEncoder();
    return { write: (data: string) => Deno.stdout.writeSync(encoder.encode(data)) };
  }
  if (runtimeProcess?.stdout) {
    return { write: (data: string) => runtimeProcess.stdout.write(data) };
  }
  return null;
}

/**
 * Write text directly to stdout (sync)
 * No-op if stdout is not available
 */
export function writeStdout(text: string): void {
  getStdout()?.write(text);
}

/**
 * Write data to stdout asynchronously
 * Returns a promise that resolves when the write is complete
 */
export async function writeStdoutAsync(data: Uint8Array): Promise<number> {
  if (IS_DENO) return await Deno.stdout.write(data);

  if (runtimeProcess?.stdout) {
    return await new Promise((resolve, reject) => {
      runtimeProcess.stdout.write(data, (error) => {
        if (error) reject(error);
        else resolve(data.length);
      });
    });
  }

  return 0;
}

/**
 * Synchronous prompt function that works across Deno and Bun.
 * Displays a message and reads user input from stdin.
 *
 * Note: This relies on globalThis.prompt which is available in Deno and Bun.
 * Returns null in environments where prompt is not available (e.g., Node.js ESM).
 */
export function promptSync(message?: string): string | null {
  if (typeof globalThis.prompt !== "function") return null;
  return globalThis.prompt(message ?? "") ?? null;
}

/**
 * Read a single byte from stdin synchronously.
 * Requires raw mode to be enabled for character-by-character reading.
 * Returns null on EOF or if stdin is not available.
 */
export function readStdinByteSync(): number | null {
  const buf = new Uint8Array(1);

  if (IS_DENO) {
    const n = Deno.stdin.readSync(buf);
    return n ? buf[0] ?? null : null;
  }

  if (IS_BUN) {
    // Bun: read one byte from the file descriptor directly
    const BunGlobal =
      (globalThis as { Bun?: { stdin?: { read?: (n: number) => Uint8Array | null } } })
        .Bun;
    const chunk = BunGlobal?.stdin?.read?.(1);
    if (chunk && chunk.length > 0) {
      const first = chunk.at(0);
      return first ?? null;
    }
    return null;
  }

  return null;
}

// ============================================================================
// Command Execution
// ============================================================================

export interface CommandResult {
  success: boolean;
  code: number;
  stdout?: string;
  stderr?: string;
}

export interface CommandOptions {
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  /** Capture stdout/stderr to return in result */
  capture?: boolean;
  /** Inherit stdio from parent process (shows output in terminal) */
  inherit?: boolean;
  /** Use shell to run the command (needed for .cmd files on Windows) */
  shell?: boolean;
  /** Kill the command if it exceeds this duration (milliseconds) */
  timeoutMs?: number;
}

const COMMAND_TIMEOUT_EXIT_CODE = 124;
const FORCE_KILL_GRACE_MS = 250;

function createTimeoutResult(
  timeoutMs: number,
  stdout?: string,
  stderr?: string,
): CommandResult {
  return {
    success: false,
    code: COMMAND_TIMEOUT_EXIT_CODE,
    stdout,
    stderr: `${stderr ?? ""}\nCommand timed out after ${timeoutMs}ms`.trim(),
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

async function readStreamToString(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
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
 */
export async function runCommand(
  cmd: string,
  options: CommandOptions = {},
): Promise<CommandResult> {
  const {
    args = [],
    cwd: cmdCwd,
    env: cmdEnv,
    capture = false,
    inherit = false,
    shell = false,
    timeoutMs,
  } = options;
  const effectiveTimeoutMs = timeoutMs && timeoutMs > 0 ? Math.floor(timeoutMs) : undefined;

  // Determine stdio mode: inherit > capture > null
  const stdioMode = inherit ? "inherit" : capture ? "piped" : "null";

  if (IS_DENO) {
    const command = new Deno.Command(cmd, {
      args,
      cwd: cmdCwd,
      env: cmdEnv,
      stdin: inherit ? "inherit" : "null",
      stdout: stdioMode,
      stderr: stdioMode,
    });

    const child = command.spawn();
    const timeout = createProcessTimeout(
      effectiveTimeoutMs,
      () => child.kill("SIGTERM"),
      () => child.kill("SIGKILL"),
    );

    try {
      const [status, stdout, stderr] = await Promise.all([
        child.status,
        capture && child.stdout ? readStreamToString(child.stdout) : Promise.resolve(undefined),
        capture && child.stderr ? readStreamToString(child.stderr) : Promise.resolve(undefined),
      ]);

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

    const bunStdio = inherit ? "inherit" : capture ? "pipe" : "ignore";

    const isWindows = isWindowsPlatform();
    const bunCmd = shell
      ? args.length === 0
        ? isWindows ? ["cmd", "/c", cmd] : ["sh", "-c", cmd]
        : isWindows
        ? ["cmd", "/c", cmd, ...args]
        : ["sh", "-c", 'exec "$@"', "sh", cmd, ...args]
      : [cmd, ...args];

    const proc = bunGlobal.Bun.spawn({
      cmd: bunCmd,
      cwd: cmdCwd,
      env: cmdEnv,
      stdout: bunStdio,
      stderr: bunStdio,
    });

    const timeout = createProcessTimeout(
      effectiveTimeoutMs,
      () => proc.kill?.("SIGTERM"),
      () => proc.kill?.("SIGKILL"),
    );

    try {
      const [code, stdout, stderr] = await Promise.all([
        proc.exited,
        capture && proc.stdout ? readStreamToString(proc.stdout) : Promise.resolve(undefined),
        capture && proc.stderr ? readStreamToString(proc.stderr) : Promise.resolve(undefined),
      ]);

      if (timeout.hasTimedOut()) {
        return createTimeoutResult(effectiveTimeoutMs ?? 0, stdout, stderr);
      }

      return { success: code === 0, code, stdout, stderr };
    } finally {
      timeout.clear();
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
    : capture
    ? ["ignore", "pipe", "pipe"]
    : ["ignore", "ignore", "ignore"];

  return await new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: cmdCwd,
      env: cmdEnv ? { ...runtimeProcess.env, ...cmdEnv } : undefined,
      stdio: nodeStdio,
      shell,
    });

    let stdout = "";
    let stderr = "";
    const decoder = new TextDecoder();
    const timeout = createProcessTimeout(
      effectiveTimeoutMs,
      () => child.kill("SIGTERM"),
      () => child.kill("SIGKILL"),
    );

    if (capture) {
      child.stdout?.on("data", (data: Uint8Array) => {
        stdout += decoder.decode(data);
      });
      child.stderr?.on("data", (data: Uint8Array) => {
        stderr += decoder.decode(data);
      });
    }

    child.on("close", (code) => {
      timeout.clear();

      if (timeout.hasTimedOut()) {
        resolve(
          createTimeoutResult(
            effectiveTimeoutMs ?? 0,
            capture ? stdout : undefined,
            capture ? stderr : undefined,
          ),
        );
        return;
      }

      resolve({
        success: code === 0,
        code: code ?? 1,
        stdout: capture ? stdout : undefined,
        stderr: capture ? stderr : undefined,
      });
    });

    child.on("error", () => {
      timeout.clear();
      resolve({ success: false, code: 1 });
    });
  });
}
