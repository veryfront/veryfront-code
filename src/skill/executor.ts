/**
 * Skill Script Executor
 *
 * Executes skill scripts using cross-runtime subprocess execution.
 *
 * @module
 */

import { getEnv, runCommand } from "#veryfront/platform/compat/process.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { getVeryfrontCloudAuthToken } from "#veryfront/platform/cloud/resolver.ts";
import { extname } from "#veryfront/compat/path";
import { createFileSystem, readTextFile } from "#veryfront/platform/compat/fs.ts";
import { captureSnapshotReadCapability } from "#veryfront/platform/adapters/file-system-capabilities.ts";
import { createError, toError } from "#veryfront/errors";
import { logger } from "#veryfront/utils";
import type { SkillScriptExecutor, SkillScriptExecutorInput, SkillScriptResult } from "./types.ts";
import { SKILL_SCRIPT_MAX_CONTENT_BYTES, SKILL_SCRIPT_MAX_OUTPUT_BYTES } from "./limits.ts";

const DEFAULT_SCRIPT_TIMEOUT_MS = 60_000;
const MAX_SCRIPT_TIMEOUT_MS = 300_000;
const TIMEOUT_EXIT_CODE = 124;
const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TIMEOUT_SENTINEL = Symbol("skill-script-timeout");
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });

async function resolveValidatedScriptContent(
  input: SkillScriptExecutorInput,
): Promise<string | undefined> {
  if (input.validatedSourceRoot === undefined) return input.scriptContent;

  const snapshot = captureSnapshotReadCapability(
    createFileSystem(),
    "Native skill script filesystem",
  );
  if (snapshot === undefined) {
    throw new TypeError("Native skill script filesystem must support snapshot reads");
  }

  const content = utf8Decoder.decode(
    await snapshot.read(
      input.scriptPath,
      input.validatedSourceRoot,
      SKILL_SCRIPT_MAX_CONTENT_BYTES,
    ),
  );
  if (input.scriptContent !== undefined && content !== input.scriptContent) {
    throw new TypeError("Skill script changed after validation");
  }
  return content;
}

function resolveTimeoutMs(timeoutMs?: number): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
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
  const suffix = crypto.randomUUID().slice(0, 8);
  return `/tmp/veryfront-skill-script-${Date.now()}-${suffix}${ext}`;
}

function getSandboxAuthOverride(): string | undefined {
  return getEnv("SANDBOX_AUTH_TOKEN")?.trim() || undefined;
}

function hasCloudScriptExecutionAuth(): boolean {
  return Boolean(getSandboxAuthOverride() || getVeryfrontCloudAuthToken());
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
    const scriptContent = await resolveValidatedScriptContent(input);
    const timeoutMs = resolveTimeoutMs(input.timeoutMs);
    const fs = createFileSystem();
    let executionPath = input.scriptPath;
    let materializationRoot: string | undefined;

    try {
      if (scriptContent !== undefined) {
        materializationRoot = await fs.makeTempDir({ prefix: "veryfront-skill-script-" });
        executionPath = `${materializationRoot}/script${extname(input.scriptPath)}`;
        await fs.writeTextFile(executionPath, scriptContent);
        await fs.chmod(executionPath, 0o700);
      }

      const { command: detectedCommand, args: detectedArgs } = detectRuntime(input.scriptPath);
      const command = detectedCommand === input.scriptPath ? executionPath : detectedCommand;
      const runtimeArgs = detectedArgs.map((arg) => arg === input.scriptPath ? executionPath : arg);
      const allArgs = [...runtimeArgs, ...(input.args ?? [])];

      // Directly executable scripts use the materialized path as the command,
      // so their caller-supplied arguments must not be prefixed with a path.
      const finalArgs = detectedCommand === input.scriptPath ? (input.args ?? []) : allArgs;

      const result = await runCommand(command, {
        args: finalArgs,
        cwd: input.cwd ?? materializationRoot,
        env: input.env,
        capture: true,
        timeoutMs,
        signal: input.abortSignal,
        maxOutputBytes: SKILL_SCRIPT_MAX_OUTPUT_BYTES,
        terminateProcessTreeOnExit: true,
      });

      return {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        exitCode: result.code,
      };
    } finally {
      if (materializationRoot !== undefined) {
        try {
          await fs.remove(materializationRoot, { recursive: true });
        } catch (error) {
          logger.warn("[skill/executor] Failed to remove materialized local script", error);
        }
      }
    }
  }
}

/**
 * Cloud script executor using sandbox.
 * Uses SANDBOX_AUTH_TOKEN as an explicit override, otherwise falls back to the
 * standard Veryfront Cloud bootstrap.
 */
class CloudScriptExecutor implements SkillScriptExecutor {
  async execute(input: SkillScriptExecutorInput): Promise<SkillScriptResult> {
    const timeoutMs = resolveTimeoutMs(input.timeoutMs);
    const scriptContent = await resolveValidatedScriptContent(input) ??
      await readTextFile(input.scriptPath);

    // Lazy import to avoid bundling sandbox in non-cloud environments
    const { Sandbox } = await import("#veryfront/sandbox");
    const authToken = getSandboxAuthOverride();
    const sandbox = await Sandbox.create(authToken ? { authToken } : undefined);
    try {
      const sandboxScriptPath = createSandboxScriptPath(input.scriptPath);

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
        commandPromise.catch(() => {
          // The command may reject after the timeout path has already returned.
        });
        // Kill any running processes before returning — withTimeout only
        // races the timer, it doesn't terminate the sandbox command.
        try {
          await sandbox.executeCommand("kill -9 -1 2>/dev/null || true");
        } catch {
          // expected: best-effort kill; sandbox.close() in finally will clean up
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
      } catch (error) {
        // Best-effort cleanup; log at warn so persistent failures (e.g. auth
        // revoked) leave a trace rather than silently leaking sandbox pods.
        logger.warn("[skill/executor] Failed to close sandbox", error);
      }
    }
  }
}

/**
 * Get the appropriate script executor.
 * Checks cloud auth availability on every call so request-scoped credentials
 * and environment overrides are respected.
 */
export function getSkillScriptExecutor(): SkillScriptExecutor {
  return hasCloudScriptExecutionAuth() ? new CloudScriptExecutor() : new LocalScriptExecutor();
}
