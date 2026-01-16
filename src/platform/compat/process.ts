import { isDeno as IS_DENO } from "./runtime.ts";

const nodeProcess = (globalThis as { process?: typeof import("node:process") }).process;
const hasNodeProcess = !!nodeProcess?.versions?.node;

export function getArgs(): string[] {
  if (IS_DENO) {
    return Deno.args;
  }
  if (hasNodeProcess) {
    return nodeProcess!.argv.slice(2);
  }
  return [];
}

export function exit(code?: number): never {
  if (IS_DENO) {
    Deno.exit(code);
  }
  if (hasNodeProcess) {
    nodeProcess!.exit(code);
  }
  throw new Error("exit() is not supported in this runtime");
}

export function cwd(): string {
  if (IS_DENO) {
    return Deno.cwd();
  }
  if (hasNodeProcess) {
    return nodeProcess!.cwd();
  }
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
  if (IS_DENO) {
    return Deno.env.toObject();
  }
  if (hasNodeProcess) {
    return nodeProcess!.env as Record<string, string>;
  }
  return {};
}

export function getEnv(key: string): string | undefined {
  if (IS_DENO) {
    return Deno.env.get(key);
  }
  if (hasNodeProcess) {
    return nodeProcess!.env[key];
  }
  return undefined;
}

/**
 * Get an environment variable or throw if not set
 * @throws Error if the environment variable is not set
 */
export function requireEnv(key: string): string {
  const value = getEnv(key);
  if (value === undefined) {
    throw new Error(`Required environment variable "${key}" is not set`);
  }
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

export function pid(): number {
  if (IS_DENO) {
    return Deno.pid;
  }
  if (hasNodeProcess) {
    return nodeProcess!.pid;
  }
  return 0;
}

export function ppid(): number {
  if (IS_DENO && "ppid" in Deno) {
    return Deno.ppid || 0;
  }
  if (hasNodeProcess) {
    return nodeProcess!.ppid || 0;
  }
  return 0;
}

export function memoryUsage(): {
  rss: number;
  heapTotal: number;
  heapUsed: number;
  external: number;
} {
  if (IS_DENO) {
    const usage = Deno.memoryUsage();
    return {
      rss: usage.rss,
      heapTotal: usage.heapTotal,
      heapUsed: usage.heapUsed,
      external: usage.external,
    };
  }

  if (!hasNodeProcess) {
    throw new Error("memoryUsage() is not supported in this runtime");
  }

  const usage = nodeProcess!.memoryUsage();
  return {
    rss: usage.rss,
    heapTotal: usage.heapTotal,
    heapUsed: usage.heapUsed,
    external: usage.external || 0,
  };
}

/**
 * Check if stdin is a TTY (terminal)
 */
export function isInteractive(): boolean {
  if (IS_DENO) {
    return Deno.stdin.isTerminal();
  }
  if (hasNodeProcess) {
    return nodeProcess!.stdin.isTTY ?? false;
  }
  return false;
}

/**
 * Check if stdout is a TTY (terminal)
 */
export function isStdoutTTY(): boolean {
  if (IS_DENO) {
    return Deno.stdout.isTerminal();
  }
  if (hasNodeProcess) {
    return nodeProcess!.stdout.isTTY ?? false;
  }
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
      const size = Deno.consoleSize();
      return { columns: size.columns, rows: size.rows };
    } catch {
      return defaultSize;
    }
  }

  if (hasNodeProcess && nodeProcess!.stdout) {
    const cols = nodeProcess!.stdout.columns;
    const rows = nodeProcess!.stdout.rows;
    if (cols && rows) {
      return { columns: cols, rows };
    }
  }

  return defaultSize;
}

/**
 * Get network interfaces
 */
export async function getNetworkInterfaces(): Promise<
  Array<{ name: string; address: string; family: "IPv4" | "IPv6" }>
> {
  if (IS_DENO) {
    const interfaces = Deno.networkInterfaces();
    return interfaces.map((iface) => ({
      name: iface.name,
      address: iface.address,
      family: iface.family as "IPv4" | "IPv6",
    }));
  }

  if (!hasNodeProcess) {
    throw new Error("networkInterfaces() is not supported in this runtime");
  }

  const os = await import("node:os");
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
  if (IS_DENO) {
    return `Deno ${Deno.version.deno}`;
  }
  if ("Bun" in globalThis) {
    return `Bun ${(globalThis as unknown as { Bun: { version: string } }).Bun.version}`;
  }
  if (hasNodeProcess) {
    return `Node.js ${nodeProcess!.version}`;
  }
  return "unknown";
}

/**
 * Register a signal handler (SIGINT, SIGTERM) for graceful shutdown
 */
export function onSignal(signal: "SIGINT" | "SIGTERM", handler: () => void): void {
  if (IS_DENO) {
    Deno.addSignalListener(signal, handler);
  } else if (hasNodeProcess) {
    nodeProcess!.on(signal, handler);
  }
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
    // Deno uses global event listeners
    globalThis.addEventListener("error", (event) => {
      const error = event.error instanceof Error ? event.error : new Error(String(event.error));
      const shouldPreventExit = onError(error, "uncaughtException");
      if (shouldPreventExit) {
        event.preventDefault();
      }
    });

    globalThis.addEventListener("unhandledrejection", (event) => {
      const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
      const shouldPreventExit = onError(error, "unhandledRejection");
      if (shouldPreventExit) {
        event.preventDefault();
      }
    });
  } else if (hasNodeProcess) {
    // Node.js uses process event handlers
    nodeProcess!.on("uncaughtException", (error: Error) => {
      onError(error, "uncaughtException");
      // Note: In Node.js, uncaughtException doesn't exit by default if handler is registered
    });

    nodeProcess!.on("unhandledRejection", (reason: unknown) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));
      onError(error, "unhandledRejection");
    });
  }
}

/**
 * Unreference a timer to prevent it from keeping the process alive
 */
export function unrefTimer(timerId: ReturnType<typeof setInterval>): void {
  if (IS_DENO) {
    Deno.unrefTimer(timerId as number);
  } else if (timerId && typeof timerId === "object" && "unref" in timerId) {
    (timerId as { unref: () => void }).unref();
  }
}

/**
 * Get the executable path of the current runtime
 */
export function execPath(): string {
  if (IS_DENO) {
    return Deno.execPath();
  }
  if (hasNodeProcess) {
    return nodeProcess!.execPath;
  }
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
    return {
      write: (data: string) => {
        Deno.stdout.writeSync(encoder.encode(data));
      },
    };
  }
  if (hasNodeProcess && nodeProcess!.stdout) {
    return {
      write: (data: string) => {
        nodeProcess!.stdout.write(data);
      },
    };
  }
  return null;
}

/**
 * Write text directly to stdout
 * No-op if stdout is not available
 */
export function writeStdout(text: string): void {
  const stdout = getStdout();
  if (stdout) {
    stdout.write(text);
  }
}

// Cached Node.js modules for synchronous prompt
let cachedNodeFs: typeof import("node:fs") | null = null;

/**
 * Synchronous prompt function that works across Deno and Node.js
 * Displays a message and reads user input from stdin
 */
export function promptSync(message?: string): string | null {
  if (IS_DENO) {
    // Deno has a built-in prompt() function
    return prompt(message);
  }

  if (hasNodeProcess) {
    // Print the message
    if (message) {
      nodeProcess!.stdout.write(message + " ");
    }

    // Lazy load fs module
    if (!cachedNodeFs) {
      // Dynamic import converted to sync require for bundling
      // @ts-ignore - dynamic require for Node.js
      cachedNodeFs = globalThis.require?.("node:fs") || null;
      if (!cachedNodeFs) {
        // Try alternative approach
        try {
          // @ts-ignore: __require is injected by bundlers for Node.js require
          cachedNodeFs = __require("node:fs");
        } catch {
          return null;
        }
      }
    }

    if (!cachedNodeFs) {
      return null;
    }

    // Read synchronously using fs
    // This works by reading from file descriptor 0 (stdin)
    // Use Uint8Array for cross-platform compatibility
    const bufferSize = 1024;
    const uint8Array = new Uint8Array(bufferSize);
    let input = "";

    try {
      // Read from stdin (fd 0) synchronously
      const bytesRead = cachedNodeFs.readSync(0, uint8Array, 0, bufferSize, null);
      if (bytesRead > 0) {
        const decoder = new TextDecoder("utf-8");
        input = decoder.decode(uint8Array.subarray(0, bytesRead)).trim();
      }
    } catch {
      // If stdin is not available or EOF, return null
      return null;
    }

    return input || null;
  }

  return null;
}
