/**
 * Skill Script Executor
 *
 * Executes skill scripts using cross-runtime subprocess execution.
 *
 * @module
 */

import { getEnv, runCommand } from "#veryfront/platform/compat/process.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { extname } from "#veryfront/compat/path";
import { readTextFile } from "#veryfront/platform/compat/fs.ts";
import { createError, toError } from "#veryfront/errors/veryfront-error.ts";
import type { SkillScriptExecutor, SkillScriptExecutorInput, SkillScriptResult } from "./types.ts";

const DEFAULT_SCRIPT_TIMEOUT_MS = 60_000;
const MAX_SCRIPT_TIMEOUT_MS = 300_000;
const TIMEOUT_EXIT_CODE = 124;
const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TIMEOUT_SENTINEL = Symbol("skill-script-timeout");

function resolveTimeoutMs(timeoutMs?: number): number {
  if (!Number.isFinite(timeoutMs) || !timeoutMs || timeoutMs <= 0) {
    return DEFAULT_SCRIPT_TIMEOUT_MS;
  }
  return Math.min(Math.floor(timeoutMs), MAX_SCRIPT_TIMEOUT_MS);
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof TIMEOUT_SENTINEL> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timeoutId = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function timeoutResult(timeoutMs: number): SkillScriptResult {
  return {
    stdout: "",
    stderr: `Script execution timed out after ${timeoutMs}ms`,
    exitCode: TIMEOUT_EXIT_CODE,
  };
}

function shellEscapeArg(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function buildShellCommand(parts: string[]): string {
  return parts.map(shellEscapeArg).join(" ");
}

function formatEnvAssignments(env?: Record<string, string>): string[] {
  if (!env) return [];
  return Object.entries(env).map(([key, value]) => {
    if (!ENV_KEY_REGEX.test(key)) {
      throw toError(
        createError({
          type: "agent",
          message: `Invalid environment variable name: "${key}"`,
        }),
      );
    }
    return `${key}=${value}`;
  });
}

function createSandboxScriptPath(scriptPath: string): string {
  const ext = extname(scriptPath) || ".sh";
  const suffix = Math.random().toString(36).slice(2, 10);
  return `/tmp/veryfront-skill-script-${Date.now()}-${suffix}${ext}`;
}

/**
 * Detect the runtime command for a script based on file extension.
 */
export function detectRuntime(scriptPath: string): { command: string; args: string[] } {
  const ext = extname(scriptPath).toLowerCase();

  switch (ext) {
    case ".py":
      return { command: "python3", args: [scriptPath] };
    case ".sh":
      return { command: "bash", args: [scriptPath] };
    case ".js":
      return { command: "node", args: [scriptPath] };
    case ".ts":
      if (isDeno) {
        return {
          command: "deno",
          args: ["run", "--allow-read", "--allow-env", "--allow-net", "--allow-write", scriptPath],
        };
      }
      return { command: "npx", args: ["tsx", scriptPath] };
    default:
      return { command: scriptPath, args: [] };
  }
}

/**
 * Local script executor using runCommand() from the compat layer.
 */
export class LocalScriptExecutor implements SkillScriptExecutor {
  async execute(input: SkillScriptExecutorInput): Promise<SkillScriptResult> {
    const timeoutMs = resolveTimeoutMs(input.timeoutMs);
    const { command, args: runtimeArgs } = detectRuntime(input.scriptPath);
    const allArgs = [...runtimeArgs, ...(input.args ?? [])];

    // Remove the script path from args if it's already the command
    const finalArgs = command === input.scriptPath ? (input.args ?? []) : allArgs;

    const result = await runCommand(command, {
      args: finalArgs,
      cwd: input.cwd,
      env: input.env,
      capture: true,
      timeoutMs,
    });

    return {
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? "",
      exitCode: result.code,
    };
  }
}

/**
 * Cloud script executor using sandbox.
 * Requires SANDBOX_AUTH_TOKEN environment variable.
 */
export class CloudScriptExecutor implements SkillScriptExecutor {
  async execute(input: SkillScriptExecutorInput): Promise<SkillScriptResult> {
    const timeoutMs = resolveTimeoutMs(input.timeoutMs);
    // NOTE: In SSR contexts, getEnv() reads through the project-env overlay
    // (AsyncLocalStorage-backed). If the token is set at host level only,
    // the overlay may not surface it. Ensure SANDBOX_AUTH_TOKEN is available
    // in the request-scoped environment when running under SSR.
    const authToken = getEnv("SANDBOX_AUTH_TOKEN");
    if (!authToken) {
      throw toError(
        createError({
          type: "agent",
          message: "Cloud script execution requires SANDBOX_AUTH_TOKEN environment variable",
        }),
      );
    }

    // Lazy import to avoid bundling sandbox in non-cloud environments
    const { Sandbox } = await import("#veryfront/sandbox");
    const sandbox = await Sandbox.create({ authToken });
    try {
      const sandboxScriptPath = createSandboxScriptPath(input.scriptPath);
      const scriptContent = input.scriptContent ?? await readTextFile(input.scriptPath);

      await sandbox.writeFiles([{ path: sandboxScriptPath, content: scriptContent }]);
      await sandbox.executeCommand(buildShellCommand(["chmod", "+x", sandboxScriptPath]));

      const { command, args: runtimeArgs } = detectRuntime(sandboxScriptPath);
      const allArgs = [...runtimeArgs, ...(input.args ?? [])];
      const finalArgs = command === sandboxScriptPath ? (input.args ?? []) : allArgs;

      const envAssignments = formatEnvAssignments(input.env);
      const commandParts = envAssignments.length > 0
        ? ["env", ...envAssignments, command, ...finalArgs]
        : [command, ...finalArgs];

      const cmdString = buildShellCommand(commandParts);
      const commandPromise = sandbox.executeCommand(cmdString);
      const result = await withTimeout(commandPromise, timeoutMs);

      if (result === TIMEOUT_SENTINEL) {
        // Kill any running processes before returning — withTimeout only
        // races the timer, it doesn't terminate the sandbox command.
        try {
          await sandbox.executeCommand("kill -9 -1 2>/dev/null || true");
        } catch {
          // Best-effort kill; sandbox.close() in finally will clean up.
        }
        return timeoutResult(timeoutMs);
      }

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        exitCode: result.exitCode,
      };
    } finally {
      try {
        await sandbox.close();
      } catch {
        // Best-effort cleanup.
      }
    }
  }
}

/**
 * Get the appropriate script executor.
 * Checks SANDBOX_AUTH_TOKEN on every call so request-scoped env overlays
 * (e.g. project-env AsyncLocalStorage) are respected.
 */
export function getSkillScriptExecutor(): SkillScriptExecutor {
  return getEnv("SANDBOX_AUTH_TOKEN") ? new CloudScriptExecutor() : new LocalScriptExecutor();
}
