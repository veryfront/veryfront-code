import { isBun as IS_BUN, isDeno as IS_DENO } from "./runtime.ts";

const nodeProcess = (globalThis as { process?: typeof import("node:process") }).process;
const hasNodeProcess = !!nodeProcess?.versions?.node;

// Dynamic import helper to avoid static analysis by bundlers
// This prevents Bun from trying to resolve node:child_process at compile time
const dynamicImport = new Function("specifier", "return import(specifier)") as <T>(
  specifier: string,
) => Promise<T>;

function isWindowsPlatform(): boolean {
  if (IS_DENO) return Deno.build.os === "windows";
  const platform = nodeProcess?.platform ??
    (globalThis as { process?: { platform?: string } }).process?.platform;
  return platform === "win32";
}

export function getArgs(): string[] {
  if (IS_DENO) return Deno.args;
  if (hasNodeProcess) return nodeProcess!.argv.slice(2);
  return [];
}

export function exit(code?: number): never {
  if (IS_DENO) Deno.exit(code);
  if (hasNodeProcess) nodeProcess!.exit(code);
  throw new Error("exit() is not supported in this runtime");
}

export function cwd(): string {
  if (IS_DENO) return Deno.cwd();
  if (hasNodeProcess) return nodeProcess!.cwd();
  throw new Error("cwd() is not supported in this runtime");
}

export function chdir(directory: string): void {
  if (IS_DENO) {
    Deno.chdir(directory);
    return;
  }
  if (hasNodeProcess) {
    nodeProcess!.chdir(directory);
    return;
  }
  throw new Error("chdir() is not supported in this runtime");
}

export function env(): Record<string, string> {
  if (IS_DENO) return Deno.env.toObject();
  if (hasNodeProcess) return nodeProcess!.env as Record<string, string>;
  return {};
}

export function getEnv(key: string): string | undefined {
  if (IS_DENO) return Deno.env.get(key);
  if (hasNodeProcess) return nodeProcess!.env[key];
  return undefined;
}

/**
 * Get an environment variable or throw if not set
 * @throws Error if the environment variable is not set
 */
export function requireEnv(key: string): string {
  const value = getEnv(key);
  if (value === undefined) throw new Error(`Required environment variable "${key}" is not set`);
  return value;
}

export function setEnv(key: string, value: string): void {
  if (IS_DENO) {
    Deno.env.set(key, value);
    return;
  }
  if (hasNodeProcess) {
    nodeProcess!.env[key] = value;
    return;
  }
  throw new Error("setEnv() is not supported in this runtime");
}

export function deleteEnv(key: string): void {
  if (IS_DENO) {
    Deno.env.delete(key);
    return;
  }
  if (hasNodeProcess) {
    delete nodeProcess!.env[key];
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
  if (hasNodeProcess) return nodeProcess!.pid;
  return 0;
}

export function ppid(): number {
  if (IS_DENO && "ppid" in Deno) return Deno.ppid || 0;
  if (hasNodeProcess) return nodeProcess!.ppid || 0;
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

  if (!hasNodeProcess) throw new Error("memoryUsage() is not supported in this runtime");

  const { rss, heapTotal, heapUsed, external } = nodeProcess!.memoryUsage();
  return { rss, heapTotal, heapUsed, external: external || 0 };
}

/**
 * Check if stdin is a TTY (terminal)
 */
export function isInteractive(): boolean {
  if (IS_DENO) return Deno.stdin.isTerminal();
  if (hasNodeProcess) return nodeProcess!.stdin.isTTY ?? false;
  return false;
}

/**
 * Check if stdout is a TTY (terminal)
 */
export function isStdoutTTY(): boolean {
  if (IS_DENO) return Deno.stdout.isTerminal();
  if (hasNodeProcess) return nodeProcess!.stdout.isTTY ?? false;
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
    } catch {
      return defaultSize;
    }
  }

  if (!hasNodeProcess) return defaultSize;

  const columns = nodeProcess!.stdout?.columns;
  const rows = nodeProcess!.stdout?.rows;
  if (columns && rows) return { columns, rows };

  return defaultSize;
}

/**
 * Get network interfaces
 */
export async function getNetworkInterfaces(): Promise<
  Array<{ name: string; address: string; family: "IPv4" | "IPv6" }>
> {
  if (IS_DENO) {
    return Deno.networkInterfaces().map((iface) => ({
      name: iface.name,
      address: iface.address,
      family: iface.family as "IPv4" | "IPv6",
    }));
  }

  // Bun and Node.js both support node:os
  if (!hasNodeProcess && !IS_BUN) {
    throw new Error("networkInterfaces() is not supported in this runtime");
  }

  // Use dynamicImport to avoid static analysis by bundlers
  const os = await dynamicImport<typeof import("node:os")>("node:os");
  const interfaces = os.networkInterfaces();
  const result: Array<{ name: string; address: string; family: "IPv4" | "IPv6" }> = [];

  for (const [name, addrs] of Object.entries(interfaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      result.push({
        name,
        address: addr.address,
        family: addr.family as "IPv4" | "IPv6",
      });
    }
  }

  return result;
}

/**
 * Get runtime version string
 */
export function getRuntimeVersion(): string {
  if (IS_DENO) return `Deno ${Deno.version.deno}`;
  if ("Bun" in globalThis) {
    return `Bun ${(globalThis as unknown as { Bun: { version: string } }).Bun.version}`;
  }
  if (hasNodeProcess) return `Node.js ${nodeProcess!.version}`;
  return "unknown";
}

/**
 * Get the operating system type
 * Returns: "darwin" (macOS), "linux", "windows", or the raw platform string
 */
export function getOsType(): string {
  if (IS_DENO) return Deno.build.os;
  if (hasNodeProcess) {
    // Node/Bun uses process.platform which returns "win32" for Windows
    const platform = nodeProcess!.platform;
    return platform === "win32" ? "windows" : platform;
  }
  return "unknown";
}

/**
 * Register a signal handler (SIGINT, SIGTERM) for graceful shutdown
 */
export function onSignal(signal: "SIGINT" | "SIGTERM", handler: () => void): void {
  if (IS_DENO) {
    Deno.addSignalListener(signal, handler);
    return;
  }
  if (hasNodeProcess) nodeProcess!.on(signal, handler);
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

  if (!hasNodeProcess) return;

  nodeProcess!.on("uncaughtException", (error: Error) => {
    onError(error, "uncaughtException");
    // Note: In Node.js, uncaughtException doesn't exit by default if handler is registered
  });

  nodeProcess!.on("unhandledRejection", (reason: unknown) => {
    const error = reason instanceof Error ? reason : new Error(String(reason));
    onError(error, "unhandledRejection");
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
  if (hasNodeProcess) return nodeProcess!.execPath;
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
  if (hasNodeProcess) {
    // process.uptime() returns process uptime in seconds
    return nodeProcess!.uptime?.() ?? 0;
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
  if (hasNodeProcess && nodeProcess!.stdout) {
    return { write: (data: string) => nodeProcess!.stdout.write(data) };
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

  if (hasNodeProcess && nodeProcess!.stdout) {
    return await new Promise((resolve, reject) => {
      nodeProcess!.stdout.write(data, (error) => {
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
  const { args = [], cwd: cmdCwd, env: cmdEnv, capture = false, inherit = false, shell = false } =
    options;

  // Determine stdio mode: inherit > capture > null
  const stdioMode = inherit ? "inherit" : capture ? "piped" : "null";

  if (IS_DENO) {
    const command = new Deno.Command(cmd, {
      args,
      cwd: cmdCwd,
      env: cmdEnv,
      stdout: stdioMode,
      stderr: stdioMode,
    });

    const output = await command.output();
    const decoder = new TextDecoder();

    return {
      success: output.success,
      code: output.code,
      stdout: capture ? decoder.decode(output.stdout) : undefined,
      stderr: capture ? decoder.decode(output.stderr) : undefined,
    };
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

    const code = await proc.exited;

    let stdout: string | undefined;
    let stderr: string | undefined;

    if (capture) {
      stdout = proc.stdout ? await readStreamToString(proc.stdout) : undefined;
      stderr = proc.stderr ? await readStreamToString(proc.stderr) : undefined;
    }

    return { success: code === 0, code, stdout, stderr };
  }

  if (!hasNodeProcess) return { success: false, code: 1 };

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
      env: cmdEnv ? { ...nodeProcess!.env, ...cmdEnv } : undefined,
      stdio: nodeStdio,
      shell,
    });

    let stdout = "";
    let stderr = "";
    const decoder = new TextDecoder();

    if (capture) {
      child.stdout?.on("data", (data: Uint8Array) => {
        stdout += decoder.decode(data);
      });
      child.stderr?.on("data", (data: Uint8Array) => {
        stderr += decoder.decode(data);
      });
    }

    child.on("close", (code) => {
      resolve({
        success: code === 0,
        code: code ?? 1,
        stdout: capture ? stdout : undefined,
        stderr: capture ? stderr : undefined,
      });
    });

    child.on("error", () => {
      resolve({ success: false, code: 1 });
    });
  });
}
