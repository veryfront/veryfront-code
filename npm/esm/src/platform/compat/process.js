import * as dntShim from "../../../_dnt.shims.js";
import { isBun as IS_BUN, isDeno as IS_DENO } from "./runtime.js";
const nodeProcess = dntShim.dntGlobalThis.process;
const hasNodeProcess = !!nodeProcess?.versions?.node;
// Dynamic import helper to avoid static analysis by bundlers
// This prevents Bun from trying to resolve node:child_process at compile time
const dynamicImport = new Function("specifier", "return import(specifier)");
export function getArgs() {
    if (IS_DENO)
        return dntShim.Deno.args;
    if (hasNodeProcess)
        return nodeProcess.argv.slice(2);
    return [];
}
export function exit(code) {
    if (IS_DENO)
        dntShim.Deno.exit(code);
    if (hasNodeProcess)
        nodeProcess.exit(code);
    throw new Error("exit() is not supported in this runtime");
}
export function cwd() {
    if (IS_DENO)
        return dntShim.Deno.cwd();
    if (hasNodeProcess)
        return nodeProcess.cwd();
    throw new Error("cwd() is not supported in this runtime");
}
export function chdir(directory) {
    if (IS_DENO) {
        dntShim.Deno.chdir(directory);
        return;
    }
    if (hasNodeProcess) {
        nodeProcess.chdir(directory);
        return;
    }
    throw new Error("chdir() is not supported in this runtime");
}
export function env() {
    if (IS_DENO)
        return dntShim.Deno.env.toObject();
    if (hasNodeProcess)
        return nodeProcess.env;
    return {};
}
export function getEnv(key) {
    if (IS_DENO)
        return dntShim.Deno.env.get(key);
    if (hasNodeProcess)
        return nodeProcess.env[key];
    return undefined;
}
/**
 * Get an environment variable or throw if not set
 * @throws Error if the environment variable is not set
 */
export function requireEnv(key) {
    const value = getEnv(key);
    if (value === undefined)
        throw new Error(`Required environment variable "${key}" is not set`);
    return value;
}
export function setEnv(key, value) {
    if (IS_DENO) {
        dntShim.Deno.env.set(key, value);
        return;
    }
    if (hasNodeProcess) {
        nodeProcess.env[key] = value;
        return;
    }
    throw new Error("setEnv() is not supported in this runtime");
}
export function deleteEnv(key) {
    if (IS_DENO) {
        dntShim.Deno.env.delete(key);
        return;
    }
    if (hasNodeProcess) {
        delete nodeProcess.env[key];
        return;
    }
    throw new Error("deleteEnv() is not supported in this runtime");
}
/**
 * Get an AsyncLocalStorage-based env overlay storage if installed.
 * This enables per-async-context env isolation (e.g., in tests).
 */
export function getEnvOverlayStorage() {
    const globalAny = dntShim.dntGlobalThis;
    const overlay = globalAny["__vfTestDenoEnvOverlay"] ??
        globalAny["__vfTestEnvOverlay"];
    const storage = overlay?.storage;
    if (!storage || typeof storage.getStore !== "function")
        return null;
    return storage;
}
export function pid() {
    if (IS_DENO)
        return dntShim.Deno.pid;
    if (hasNodeProcess)
        return nodeProcess.pid;
    return 0;
}
export function ppid() {
    if (IS_DENO && "ppid" in dntShim.Deno)
        return dntShim.Deno.ppid || 0;
    if (hasNodeProcess)
        return nodeProcess.ppid || 0;
    return 0;
}
export function memoryUsage() {
    if (IS_DENO) {
        const usage = dntShim.Deno.memoryUsage();
        return {
            rss: usage.rss,
            heapTotal: usage.heapTotal,
            heapUsed: usage.heapUsed,
            external: usage.external,
        };
    }
    if (!hasNodeProcess)
        throw new Error("memoryUsage() is not supported in this runtime");
    const usage = nodeProcess.memoryUsage();
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
export function isInteractive() {
    if (IS_DENO)
        return dntShim.Deno.stdin.isTerminal();
    if (hasNodeProcess)
        return nodeProcess.stdin.isTTY ?? false;
    return false;
}
/**
 * Check if stdout is a TTY (terminal)
 */
export function isStdoutTTY() {
    if (IS_DENO)
        return dntShim.Deno.stdout.isTerminal();
    if (hasNodeProcess)
        return nodeProcess.stdout.isTTY ?? false;
    return false;
}
/**
 * Get terminal size (columns and rows)
 * Returns default fallback values if terminal size cannot be determined
 */
export function getTerminalSize() {
    const defaultSize = { columns: 80, rows: 24 };
    if (IS_DENO) {
        try {
            const size = dntShim.Deno.consoleSize();
            return { columns: size.columns, rows: size.rows };
        }
        catch {
            return defaultSize;
        }
    }
    if (hasNodeProcess) {
        const cols = nodeProcess.stdout?.columns;
        const rows = nodeProcess.stdout?.rows;
        if (cols && rows)
            return { columns: cols, rows };
    }
    return defaultSize;
}
/**
 * Get network interfaces
 */
export async function getNetworkInterfaces() {
    if (IS_DENO) {
        return dntShim.Deno.networkInterfaces().map((iface) => ({
            name: iface.name,
            address: iface.address,
            family: iface.family,
        }));
    }
    // Bun and Node.js both support node:os
    if (!hasNodeProcess && !IS_BUN) {
        throw new Error("networkInterfaces() is not supported in this runtime");
    }
    // Use dynamicImport to avoid static analysis by bundlers
    const os = await dynamicImport("node:os");
    const interfaces = os.networkInterfaces();
    const result = [];
    for (const [name, addrs] of Object.entries(interfaces)) {
        if (!addrs)
            continue;
        for (const addr of addrs) {
            result.push({
                name,
                address: addr.address,
                family: addr.family,
            });
        }
    }
    return result;
}
/**
 * Get runtime version string
 */
export function getRuntimeVersion() {
    if (IS_DENO)
        return `Deno ${dntShim.Deno.version.deno}`;
    if ("Bun" in dntShim.dntGlobalThis) {
        return `Bun ${dntShim.dntGlobalThis.Bun.version}`;
    }
    if (hasNodeProcess)
        return `Node.js ${nodeProcess.version}`;
    return "unknown";
}
/**
 * Get the operating system type
 * Returns: "darwin" (macOS), "linux", "windows", or the raw platform string
 */
export function getOsType() {
    if (IS_DENO)
        return dntShim.Deno.build.os;
    if (hasNodeProcess) {
        // Node/Bun uses process.platform which returns "win32" for Windows
        const platform = nodeProcess.platform;
        return platform === "win32" ? "windows" : platform;
    }
    return "unknown";
}
/**
 * Register a signal handler (SIGINT, SIGTERM) for graceful shutdown
 */
export function onSignal(signal, handler) {
    if (IS_DENO) {
        dntShim.Deno.addSignalListener(signal, handler);
        return;
    }
    if (hasNodeProcess)
        nodeProcess.on(signal, handler);
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
export function onGlobalError(onError) {
    if (IS_DENO) {
        globalThis.addEventListener("error", (event) => {
            const error = event.error instanceof Error ? event.error : new Error(String(event.error));
            if (onError(error, "uncaughtException"))
                event.preventDefault();
        });
        globalThis.addEventListener("unhandledrejection", (event) => {
            const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));
            if (onError(error, "unhandledRejection"))
                event.preventDefault();
        });
        return;
    }
    if (!hasNodeProcess)
        return;
    nodeProcess.on("uncaughtException", (error) => {
        onError(error, "uncaughtException");
        // Note: In Node.js, uncaughtException doesn't exit by default if handler is registered
    });
    nodeProcess.on("unhandledRejection", (reason) => {
        const error = reason instanceof Error ? reason : new Error(String(reason));
        onError(error, "unhandledRejection");
    });
}
/**
 * Unreference a timer to prevent it from keeping the process alive
 */
export function unrefTimer(timerId) {
    if (IS_DENO && typeof dntShim.Deno.unrefTimer === "function") {
        dntShim.Deno.unrefTimer(timerId);
        return;
    }
    if (timerId && typeof timerId === "object" && "unref" in timerId) {
        timerId.unref();
    }
}
/**
 * Get the executable path of the current runtime
 */
export function execPath() {
    if (IS_DENO)
        return dntShim.Deno.execPath();
    if (hasNodeProcess)
        return nodeProcess.execPath;
    return "";
}
/**
 * Get process uptime in seconds
 * Returns OS uptime on Deno, process uptime on Node.js
 */
export function uptime() {
    if (IS_DENO) {
        // Deno.osUptime() returns system uptime in seconds
        return dntShim.Deno.osUptime?.() ?? 0;
    }
    if (hasNodeProcess) {
        // process.uptime() returns process uptime in seconds
        return nodeProcess.uptime?.() ?? 0;
    }
    return 0;
}
/**
 * Get stdout stream for writing
 * Returns null if not available (e.g., in browser/workers)
 */
export function getStdout() {
    if (IS_DENO) {
        const encoder = new TextEncoder();
        return { write: (data) => dntShim.Deno.stdout.writeSync(encoder.encode(data)) };
    }
    if (hasNodeProcess && nodeProcess.stdout) {
        return { write: (data) => nodeProcess.stdout.write(data) };
    }
    return null;
}
/**
 * Write text directly to stdout (sync)
 * No-op if stdout is not available
 */
export function writeStdout(text) {
    getStdout()?.write(text);
}
/**
 * Write data to stdout asynchronously
 * Returns a promise that resolves when the write is complete
 */
export async function writeStdoutAsync(data) {
    if (IS_DENO)
        return await dntShim.Deno.stdout.write(data);
    if (hasNodeProcess && nodeProcess.stdout) {
        return await new Promise((resolve, reject) => {
            nodeProcess.stdout.write(data, (error) => {
                if (error)
                    reject(error);
                else
                    resolve(data.length);
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
export function promptSync(message) {
    if (typeof globalThis.prompt === "function")
        return globalThis.prompt(message ?? "") ?? null;
    return null;
}
async function readStreamToString(stream) {
    const reader = stream.getReader();
    const chunks = [];
    while (true) {
        const { done, value } = await reader.read();
        if (done)
            break;
        if (value)
            chunks.push(value);
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
export async function runCommand(cmd, options = {}) {
    const { args = [], cwd: cmdCwd, env: cmdEnv, capture = false, inherit = false, shell = false } = options;
    // Determine stdio mode: inherit > capture > null
    const stdioMode = inherit ? "inherit" : capture ? "piped" : "null";
    if (IS_DENO) {
        const command = new dntShim.Deno.Command(cmd, {
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
        const bunGlobal = dntShim.dntGlobalThis;
        const bunStdio = inherit ? "inherit" : capture ? "pipe" : "ignore";
        const proc = bunGlobal.Bun.spawn({
            cmd: shell ? ["sh", "-c", [cmd, ...args].join(" ")] : [cmd, ...args],
            cwd: cmdCwd,
            env: cmdEnv,
            stdout: bunStdio,
            stderr: bunStdio,
        });
        const code = await proc.exited;
        let stdout;
        let stderr;
        if (capture) {
            if (proc.stdout)
                stdout = await readStreamToString(proc.stdout);
            if (proc.stderr)
                stderr = await readStreamToString(proc.stderr);
        }
        return { success: code === 0, code, stdout, stderr };
    }
    if (!hasNodeProcess)
        return { success: false, code: 1 };
    const childProcess = await dynamicImport("node:child_process");
    const { spawn } = childProcess;
    const nodeStdio = inherit
        ? ["inherit", "inherit", "inherit"]
        : capture
            ? ["ignore", "pipe", "pipe"]
            : ["ignore", "ignore", "ignore"];
    return await new Promise((resolve) => {
        const child = spawn(cmd, args, {
            cwd: cmdCwd,
            env: cmdEnv ? { ...nodeProcess.env, ...cmdEnv } : undefined,
            stdio: nodeStdio,
            shell,
        });
        let stdout = "";
        let stderr = "";
        const decoder = new TextDecoder();
        if (capture) {
            child.stdout?.on("data", (data) => {
                stdout += decoder.decode(data);
            });
            child.stderr?.on("data", (data) => {
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
