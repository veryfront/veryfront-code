import { dynamicImport } from "../dynamic-import.ts";
import { getDenoRuntime, isBun as IS_BUN, isDeno as IS_DENO } from "../runtime.ts";
import { isWindowsPlatform, runtimeProcess } from "./runtime-process.ts";

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

  const deno = IS_DENO ? getDenoRuntime() : undefined;
  if (deno) {
    const command = new deno.Command(cmd, {
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
      env: cmdEnv ? { ...process.env, ...cmdEnv } : undefined,
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

    child.on("error", (spawnError: Error) => {
      timeout.clear();
      // Include the spawn error message so callers can distinguish ENOENT
      // ("command not found"), EACCES ("permission denied"), etc.
      resolve({
        success: false,
        code: 1,
        stdout: capture ? stdout : undefined,
        stderr: capture
          ? (stderr
            ? `${stderr}\nSpawn error: ${spawnError.message}`
            : `Spawn error: ${spawnError.message}`)
          : undefined,
      });
    });
  });
}
