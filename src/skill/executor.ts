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
import { dirname, extname } from "#veryfront/compat/path";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import { createFileSystem, readTextFile } from "#veryfront/platform/compat/fs.ts";
import { captureSnapshotReadCapability } from "#veryfront/platform/adapters/file-system-capabilities.ts";
import { createError, toError } from "#veryfront/errors";
import { logger } from "#veryfront/utils";
import type {
  SkillScriptExecutor,
  SkillScriptExecutorInput,
  SkillScriptResult,
  SkillScriptSnapshot,
  SkillScriptSnapshotFile,
} from "./types.ts";
import { isCanonicalAdapterRelativeSkillRoot } from "./types.ts";
import {
  SKILL_PATH_SEGMENT_MAX_LENGTH,
  SKILL_RELATIVE_PATH_MAX_LENGTH,
  SKILL_SCRIPT_MAX_CONTENT_BYTES,
  SKILL_SCRIPT_MAX_OUTPUT_BYTES,
  SKILL_SCRIPT_SNAPSHOT_MAX_BYTES,
  SKILL_SCRIPT_SNAPSHOT_MAX_FILES,
} from "./limits.ts";

const DEFAULT_SCRIPT_TIMEOUT_MS = 60_000;
const MAX_SCRIPT_TIMEOUT_MS = 300_000;
const TIMEOUT_EXIT_CODE = 124;
const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TIMEOUT_SENTINEL = Symbol("skill-script-timeout");
const utf8Decoder = new TextDecoder("utf-8", { fatal: true });
const utf8Encoder = new TextEncoder();
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const defineOwnProperty = Object.defineProperty;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const reflectApply = Reflect.apply;
const freeze = Object.freeze;
const arrayIsArray = Array.isArray;
const numberIsSafeInteger = Number.isSafeInteger;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const stringSplit = String.prototype.split;
const stringStartsWith = String.prototype.startsWith;

function appendOwnArrayElement<T>(values: T[], value: T): void {
  defineOwnProperty(values, values.length, {
    value,
    writable: true,
    enumerable: true,
    configurable: true,
  });
}

function readOwnDataProperty(value: object, key: PropertyKey, label: string): unknown {
  const descriptor = getOwnPropertyDescriptor(value, key);
  if (
    !descriptor ||
    !(reflectApply(hasOwnProperty, descriptor, ["value"]) as boolean)
  ) {
    throw new TypeError(`${label} must be an own data property`);
  }
  return descriptor.value;
}

function assertScriptSnapshotPath(path: string): void {
  if (
    path.length > SKILL_RELATIVE_PATH_MAX_LENGTH ||
    !(reflectApply(stringStartsWith, path, ["scripts/"]) as boolean) ||
    !isCanonicalAdapterRelativeSkillRoot(path)
  ) {
    throw new TypeError("Skill script snapshot paths must be canonical scripts/ paths");
  }
  const segments = reflectApply(stringSplit, path, ["/"]) as string[];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    if (segment.length > SKILL_PATH_SEGMENT_MAX_LENGTH) {
      throw new RangeError(
        `Skill script snapshot path segments may contain at most ${SKILL_PATH_SEGMENT_MAX_LENGTH} characters`,
      );
    }
  }
}

function captureScriptSnapshot(input: SkillScriptExecutorInput): SkillScriptSnapshot | undefined {
  if (isProxyWithoutHooks(input)) {
    throw new TypeError("Skill script executor input must not be a proxy");
  }
  const descriptor = getOwnPropertyDescriptor(input, "scriptSnapshot");
  if (descriptor === undefined) return undefined;
  if (!(reflectApply(hasOwnProperty, descriptor, ["value"]) as boolean)) {
    throw new TypeError("Skill script snapshot must be an own data property");
  }
  const rawSnapshot = descriptor.value;
  if (
    typeof rawSnapshot !== "object" || rawSnapshot === null ||
    isProxyWithoutHooks(rawSnapshot)
  ) {
    throw new TypeError("Skill script snapshot must be an object");
  }

  const entryPath = readOwnDataProperty(
    rawSnapshot,
    "entryPath",
    "Skill script snapshot entryPath",
  );
  const rawFiles = readOwnDataProperty(rawSnapshot, "files", "Skill script snapshot files");
  if (typeof entryPath !== "string") {
    throw new TypeError("Skill script snapshot entryPath must be a string");
  }
  assertScriptSnapshotPath(entryPath);
  if (!arrayIsArray(rawFiles) || isProxyWithoutHooks(rawFiles)) {
    throw new TypeError("Skill script snapshot files must be an array");
  }
  const length = readOwnDataProperty(rawFiles, "length", "Skill script snapshot files length");
  if (!numberIsSafeInteger(length) || (length as number) < 1) {
    throw new TypeError("Skill script snapshot must contain at least one file");
  }
  if ((length as number) > SKILL_SCRIPT_SNAPSHOT_MAX_FILES) {
    throw new RangeError(
      `Skill script snapshots may contain at most ${SKILL_SCRIPT_SNAPSHOT_MAX_FILES} files`,
    );
  }

  const files: SkillScriptSnapshotFile[] = [];
  const seen = new Set<string>();
  let entryContent: string | undefined;
  let totalBytes = 0;
  for (let index = 0; index < (length as number); index += 1) {
    const rawFile = readOwnDataProperty(
      rawFiles,
      index,
      `Skill script snapshot file ${index}`,
    );
    if (
      typeof rawFile !== "object" || rawFile === null ||
      isProxyWithoutHooks(rawFile)
    ) {
      throw new TypeError(`Skill script snapshot file ${index} must be an object`);
    }
    const path = readOwnDataProperty(
      rawFile,
      "path",
      `Skill script snapshot file ${index} path`,
    );
    const content = readOwnDataProperty(
      rawFile,
      "content",
      `Skill script snapshot file ${index} content`,
    );
    if (typeof path !== "string" || typeof content !== "string") {
      throw new TypeError(`Skill script snapshot file ${index} must contain string data`);
    }
    assertScriptSnapshotPath(path);
    if (reflectApply(setHas, seen, [path]) as boolean) {
      throw new TypeError(`Skill script snapshot contains duplicate path: ${path}`);
    }
    reflectApply(setAdd, seen, [path]);
    const contentBytes = utf8Encoder.encode(content).byteLength;
    if (contentBytes > SKILL_SCRIPT_MAX_CONTENT_BYTES) {
      throw new RangeError(
        `Skill script snapshot files may contain at most ${SKILL_SCRIPT_MAX_CONTENT_BYTES} bytes`,
      );
    }
    totalBytes += contentBytes;
    if (totalBytes > SKILL_SCRIPT_SNAPSHOT_MAX_BYTES) {
      throw new RangeError(
        `Skill script snapshots may contain at most ${SKILL_SCRIPT_SNAPSHOT_MAX_BYTES} bytes`,
      );
    }
    const capturedFile = freeze({ path, content });
    appendOwnArrayElement(files, capturedFile);
    if (path === entryPath) entryContent = content;
  }
  if (entryContent === undefined) {
    throw new TypeError("Skill script snapshot does not contain its entryPath");
  }
  if (input.scriptContent !== undefined && input.scriptContent !== entryContent) {
    throw new TypeError("Skill script snapshot entry does not match scriptContent");
  }
  return freeze({ entryPath, files: freeze(files) });
}

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

function createSandboxScriptRoot(): string {
  const suffix = crypto.randomUUID().slice(0, 8);
  return `/tmp/veryfront-skill-script-${Date.now()}-${suffix}`;
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
    const scriptSnapshot = captureScriptSnapshot(input);
    const scriptContent = await resolveValidatedScriptContent(input);
    const timeoutMs = resolveTimeoutMs(input.timeoutMs);
    const fs = createFileSystem();
    let executionPath = input.scriptPath;
    let materializationRoot: string | undefined;

    try {
      if (scriptSnapshot !== undefined) {
        materializationRoot = await fs.makeTempDir({ prefix: "veryfront-skill-script-" });
        for (let index = 0; index < scriptSnapshot.files.length; index += 1) {
          const file = scriptSnapshot.files[index]!;
          const materializedPath = `${materializationRoot}/${file.path}`;
          await fs.mkdir(dirname(materializedPath), { recursive: true });
          await fs.writeTextFile(materializedPath, file.content);
        }
        executionPath = `${materializationRoot}/${scriptSnapshot.entryPath}`;
        await fs.chmod(executionPath, 0o700);
      } else if (scriptContent !== undefined) {
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
    const scriptSnapshot = captureScriptSnapshot(input);
    const timeoutMs = resolveTimeoutMs(input.timeoutMs);
    const scriptContent = await resolveValidatedScriptContent(input) ??
      await readTextFile(input.scriptPath);

    // Lazy import to avoid bundling sandbox in non-cloud environments
    const { Sandbox } = await import("#veryfront/sandbox");
    const authToken = getSandboxAuthOverride();
    const sandbox = await Sandbox.create(authToken ? { authToken } : undefined);
    try {
      const sandboxRoot = scriptSnapshot === undefined ? undefined : createSandboxScriptRoot();
      const sandboxScriptPath = scriptSnapshot === undefined
        ? createSandboxScriptPath(input.scriptPath)
        : `${sandboxRoot}/${scriptSnapshot.entryPath}`;
      const sandboxFiles: Array<{ path: string; content: string }> = [];
      if (scriptSnapshot === undefined) {
        appendOwnArrayElement(sandboxFiles, { path: sandboxScriptPath, content: scriptContent });
      } else {
        for (let index = 0; index < scriptSnapshot.files.length; index += 1) {
          const file = scriptSnapshot.files[index]!;
          appendOwnArrayElement(sandboxFiles, {
            path: `${sandboxRoot}/${file.path}`,
            content: file.content,
          });
        }
      }

      await sandbox.writeFiles(sandboxFiles);
      await sandbox.executeCommand(buildShellCommand(["chmod", "+x", sandboxScriptPath]));

      const { command, args: runtimeArgs } = detectRuntime(sandboxScriptPath);
      const allArgs = [...runtimeArgs, ...(input.args ?? [])];
      const finalArgs = command === sandboxScriptPath ? (input.args ?? []) : allArgs;

      const envAssignments = formatEnvAssignments(input.env);
      const commandParts = envAssignments.length > 0
        ? ["env", ...envAssignments, command, ...finalArgs]
        : [command, ...finalArgs];

      const invocation = buildShellCommand(commandParts);
      const cmdString = sandboxRoot === undefined
        ? invocation
        : `cd ${shellEscapeArg(sandboxRoot)} && ${invocation}`;
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
