import { getDenoRuntime, isBun as IS_BUN, isDeno as IS_DENO } from "../runtime.ts";
import { runtimeProcess } from "./runtime-process.ts";

/** Get command-line arguments (cross-runtime: Deno.args or process.argv). */
export function getArgs(): string[] {
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) return deno.args;
  if (runtimeProcess) return runtimeProcess.argv.slice(2);
  return [];
}

/** Exit the process with an optional code (cross-runtime: Deno.exit or process.exit). */
export function exit(code?: number): never {
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) deno.exit(code);
  if (runtimeProcess) runtimeProcess.exit(code);
  throw new Error("exit() is not supported in this runtime");
}

/** Return the current working directory. */
export function cwd(): string {
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) return deno.cwd();
  if (runtimeProcess) return runtimeProcess.cwd();
  throw new Error("cwd() is not supported in this runtime");
}

export function chdir(directory: string): void {
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) {
    deno.chdir(directory);
    return;
  }
  if (runtimeProcess) {
    runtimeProcess.chdir(directory);
    return;
  }
  throw new Error("chdir() is not supported in this runtime");
}

export function pid(): number {
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) return deno.pid;
  if (runtimeProcess) return runtimeProcess.pid;
  return 0;
}

export function memoryUsage(): {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
} {
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) {
    const { rss, heapTotal, heapUsed, external } = deno.memoryUsage();
    return { rss, heapTotal, heapUsed, external };
  }

  if (!runtimeProcess) {
    throw new Error("memoryUsage() is not supported in this runtime");
  }

  const { rss, heapTotal, heapUsed, external } = runtimeProcess.memoryUsage();
  return { rss, heapTotal, heapUsed, external: external || 0 };
}

/**
 * Check if stdin is a TTY (terminal)
 */
export function isInteractive(): boolean {
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) return deno.stdin.isTerminal();
  if (runtimeProcess) return runtimeProcess.stdin.isTTY ?? false;
  return false;
}

/**
 * Check if stdout is a TTY (terminal)
 */
export function isStdoutTTY(): boolean {
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) return deno.stdout.isTerminal();
  if (runtimeProcess) return runtimeProcess.stdout.isTTY ?? false;
  return false;
}

/**
 * Get terminal size (columns and rows)
 * Returns default fallback values if terminal size cannot be determined
 */
export function getTerminalSize(): { columns: number; rows: number } {
  const defaultSize = { columns: 80, rows: 24 };

  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) {
    try {
      const { columns, rows } = deno.consoleSize();
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
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) return `Deno ${deno.version.deno}`;
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
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) return deno.build.os;
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
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) {
    deno.addSignalListener(signal, handler);
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
    // Intentionally permanent: process-level handlers must persist for the entire runtime
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
  const process = runtimeProcess;

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
    process.exit(1);
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
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno && typeof deno.unrefTimer === "function" && typeof timerId === "number") {
    deno.unrefTimer(timerId as number);
    return;
  }

  if (timerId && typeof timerId === "object") {
    const unref = (timerId as { unref?: unknown }).unref;
    if (typeof unref === "function") {
      unref.call(timerId);
    }
  }
}

/**
 * Get the executable path of the current runtime
 */
export function execPath(): string {
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) return deno.execPath();
  if (runtimeProcess) return runtimeProcess.execPath;
  return "";
}

/**
 * Get process uptime in seconds
 * Returns OS uptime on Deno, process uptime on Node.js
 */
export function uptime(): number {
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) {
    // Deno.osUptime() returns system uptime in seconds
    return deno.osUptime?.() ?? 0;
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
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) {
    const encoder = new TextEncoder();
    return { write: (data: string) => deno.stdout.writeSync(encoder.encode(data)) };
  }
  const stdout = runtimeProcess?.stdout;
  if (stdout) {
    return { write: (data: string) => stdout.write(data) };
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
  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) return await deno.stdout.write(data);

  const stdout = runtimeProcess?.stdout;
  if (stdout) {
    return await new Promise((resolve, reject) => {
      stdout.write(data, (error) => {
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

  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) {
    const n = deno.stdin.readSync(buf);
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
