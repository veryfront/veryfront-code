import * as dntShim from "../../../_dnt.shims.js";
export declare function getArgs(): string[];
export declare function exit(code?: number): never;
export declare function cwd(): string;
export declare function chdir(directory: string): void;
export declare function env(): Record<string, string>;
export declare function getEnv(key: string): string | undefined;
/**
 * Get an environment variable or throw if not set
 * @throws Error if the environment variable is not set
 */
export declare function requireEnv(key: string): string;
export declare function setEnv(key: string, value: string): void;
export declare function deleteEnv(key: string): void;
type EnvOverlayStorage = {
    getStore: () => unknown;
    run?: <T>(store: unknown, fn: () => T) => T;
    enterWith?: (store: unknown) => void;
};
/**
 * Get an AsyncLocalStorage-based env overlay storage if installed.
 * This enables per-async-context env isolation (e.g., in tests).
 */
export declare function getEnvOverlayStorage(): EnvOverlayStorage | null;
export declare function pid(): number;
export declare function ppid(): number;
export declare function memoryUsage(): {
    rss: number;
    heapTotal: number;
    heapUsed: number;
    external: number;
};
/**
 * Check if stdin is a TTY (terminal)
 */
export declare function isInteractive(): boolean;
/**
 * Check if stdout is a TTY (terminal)
 */
export declare function isStdoutTTY(): boolean;
/**
 * Get terminal size (columns and rows)
 * Returns default fallback values if terminal size cannot be determined
 */
export declare function getTerminalSize(): {
    columns: number;
    rows: number;
};
/**
 * Get network interfaces
 */
export declare function getNetworkInterfaces(): Promise<Array<{
    name: string;
    address: string;
    family: "IPv4" | "IPv6";
}>>;
/**
 * Get runtime version string
 */
export declare function getRuntimeVersion(): string;
/**
 * Get the operating system type
 * Returns: "darwin" (macOS), "linux", "windows", or the raw platform string
 */
export declare function getOsType(): string;
/**
 * Register a signal handler (SIGINT, SIGTERM) for graceful shutdown
 */
export declare function onSignal(signal: "SIGINT" | "SIGTERM", handler: () => void): void;
/**
 * Register global error handlers for uncaught exceptions and unhandled promise rejections.
 * These handlers prevent the process from crashing due to application code errors.
 *
 * IMPORTANT: These handlers should be registered early in the application lifecycle
 * to catch errors that escape try/catch blocks.
 *
 * @param onError - Callback invoked with the error. Return true to prevent process exit.
 */
export declare function onGlobalError(onError: (error: Error, type: "uncaughtException" | "unhandledRejection") => boolean | void): void;
/**
 * Unreference a timer to prevent it from keeping the process alive
 */
export declare function unrefTimer(timerId: ReturnType<typeof dntShim.setInterval>): void;
/**
 * Get the executable path of the current runtime
 */
export declare function execPath(): string;
/**
 * Get process uptime in seconds
 * Returns OS uptime on Deno, process uptime on Node.js
 */
export declare function uptime(): number;
/**
 * Get stdout stream for writing
 * Returns null if not available (e.g., in browser/workers)
 */
export declare function getStdout(): {
    write: (data: string) => void;
} | null;
/**
 * Write text directly to stdout (sync)
 * No-op if stdout is not available
 */
export declare function writeStdout(text: string): void;
/**
 * Write data to stdout asynchronously
 * Returns a promise that resolves when the write is complete
 */
export declare function writeStdoutAsync(data: Uint8Array): Promise<number>;
/**
 * Synchronous prompt function that works across Deno and Bun.
 * Displays a message and reads user input from stdin.
 *
 * Note: This relies on globalThis.prompt which is available in Deno and Bun.
 * Returns null in environments where prompt is not available (e.g., Node.js ESM).
 */
export declare function promptSync(message?: string): string | null;
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
export declare function runCommand(cmd: string, options?: CommandOptions): Promise<CommandResult>;
export {};
//# sourceMappingURL=process.d.ts.map