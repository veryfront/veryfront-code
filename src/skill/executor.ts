/**
 * Skill Script Executor
 *
 * Executes skill scripts using cross-runtime subprocess execution.
 *
 * @module
 */

import { getEnv, runCommand } from "#veryfront/platform/compat/process.ts";
import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { isVeryfrontCloudEnabled } from "#veryfront/platform/cloud/resolver.ts";
import { dirname, extname } from "#veryfront/compat/path";
import { readTextFile, stat } from "#veryfront/platform/compat/fs.ts";
import { createError, toError } from "#veryfront/errors";
import { logger } from "#veryfront/utils";
import type { Sandbox as SandboxInstance } from "#veryfront/sandbox";
import type { SkillScriptExecutor, SkillScriptExecutorInput, SkillScriptResult } from "./types.ts";

const DEFAULT_SCRIPT_TIMEOUT_MS = 60_000;
const MAX_SCRIPT_TIMEOUT_MS = 300_000;
const TIMEOUT_EXIT_CODE = 124;
const ENV_KEY_REGEX = /^[A-Za-z_][A-Za-z0-9_]*$/;
const TIMEOUT_SENTINEL = Symbol("skill-script-timeout");
const ABORT_SENTINEL = Symbol("skill-script-abort");
const MAX_SCRIPT_PATH_LENGTH = 4_096;
const MAX_SCRIPT_CONTENT_BYTES = 4 * 1_048_576;
const MAX_SCRIPT_ARGUMENTS = 128;
const MAX_SCRIPT_ARGUMENT_LENGTH = 16_384;
const MAX_SCRIPT_ENV_ENTRIES = 128;
const MAX_SCRIPT_ENV_VALUE_LENGTH = 65_536;
const MAX_SCRIPT_ENV_TOTAL_LENGTH = 1_048_576;
const MAX_SCRIPT_OUTPUT_BYTES = 4 * 1_048_576;
const MAX_REQUEST_SCOPED_AUTH_TOKEN_LENGTH = 16_384;
const LOCAL_PROCESS_ENV_ALLOWLIST = [
  "PATH",
  "PATHEXT",
  "SYSTEMROOT",
  "WINDIR",
  "COMSPEC",
  "TMPDIR",
  "TMP",
  "TEMP",
  "LANG",
  "LC_ALL",
] as const;

type NormalizedExecutorInput = SkillScriptExecutorInput & {
  args: string[];
  env: Record<string, string> | undefined;
};

const EXECUTOR_INPUT_FIELDS = new Set([
  "scriptPath",
  "scriptContent",
  "args",
  "env",
  "cwd",
  "timeoutMs",
  "abortSignal",
]);

function executorInputError(message: string): never {
  throw toError(createError({ type: "agent", message }));
}

function resolveTimeoutMs(timeoutMs: unknown): number {
  if (timeoutMs === undefined) return DEFAULT_SCRIPT_TIMEOUT_MS;
  if (
    typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 ||
    timeoutMs > MAX_SCRIPT_TIMEOUT_MS
  ) {
    executorInputError(
      `Skill script timeout must be an integer between 1 and ${MAX_SCRIPT_TIMEOUT_MS} milliseconds.`,
    );
  }
  return timeoutMs;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  let reason: unknown;
  try {
    reason = signal.reason;
  } catch {
    // Use a stable cancellation error when a hostile signal hides its reason.
  }
  if (reason !== undefined) throw reason;
  throw new DOMException("Skill script execution was aborted", "AbortError");
}

type ExecutorDeadlineSentinel = typeof TIMEOUT_SENTINEL | typeof ABORT_SENTINEL;

function isExecutorDeadlineSentinel(value: unknown): value is ExecutorDeadlineSentinel {
  return value === TIMEOUT_SENTINEL || value === ABORT_SENTINEL;
}

class ExecutorDeadline {
  readonly #deadlineAt: number;
  readonly #signal: AbortSignal | undefined;
  readonly #terminalPromise: Promise<ExecutorDeadlineSentinel>;
  #abortHandler: (() => void) | undefined;
  #timeoutId: ReturnType<typeof setTimeout> | undefined;

  constructor(timeoutMs: number, signal?: AbortSignal, startedAt = performance.now()) {
    this.#deadlineAt = startedAt + timeoutMs;
    this.#signal = signal;
    this.#terminalPromise = new Promise<ExecutorDeadlineSentinel>((resolve) => {
      this.#timeoutId = setTimeout(
        () => resolve(TIMEOUT_SENTINEL),
        Math.max(0, this.#deadlineAt - performance.now()),
      );
      if (!signal) return;
      if (signal.aborted) {
        resolve(ABORT_SENTINEL);
        return;
      }
      this.#abortHandler = () => resolve(ABORT_SENTINEL);
      signal.addEventListener("abort", this.#abortHandler, { once: true });
    });
  }

  async run<T>(operation: () => Promise<T>): Promise<T> {
    if (this.#signal?.aborted) throw ABORT_SENTINEL;
    if (this.remainingMilliseconds() <= 0) throw TIMEOUT_SENTINEL;
    const promise = operation();
    const result = await this.race(promise);
    if (isExecutorDeadlineSentinel(result)) throw result;
    return result;
  }

  async race<T>(
    promise: Promise<T>,
  ): Promise<T | ExecutorDeadlineSentinel> {
    return await Promise.race([promise, this.#terminalPromise]);
  }

  remainingSeconds(): number {
    return Math.max(Number.MIN_VALUE, this.remainingMilliseconds() / 1_000);
  }

  isExpired(): boolean {
    return this.remainingMilliseconds() <= 0;
  }

  dispose(): void {
    if (this.#timeoutId !== undefined) clearTimeout(this.#timeoutId);
    if (this.#signal && this.#abortHandler) {
      this.#signal.removeEventListener("abort", this.#abortHandler);
    }
  }

  private remainingMilliseconds(): number {
    return Math.max(0, this.#deadlineAt - performance.now());
  }
}

function safeErrorName(error: unknown): string {
  try {
    if (error instanceof Error && /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(error.name)) {
      return error.name;
    }
  } catch {
    // Keep the sanitized fallback name.
  }
  return "unknown";
}

function logSandboxCloseFailure(error: unknown): void {
  logger.warn("[skill/executor] Failed to close sandbox", { errorName: safeErrorName(error) });
}

function closeLateCreatedSandbox(createPromise: Promise<SandboxInstance>): void {
  void createPromise.then(async (sandbox) => {
    try {
      await sandbox.close();
    } catch (error) {
      logSandboxCloseFailure(error);
    }
  }).catch(() => {
    // Sandbox creation failures do not leave a session for this executor to close.
  });
}

function timeoutResult(timeoutMs: number): SkillScriptResult {
  return {
    stdout: "",
    stderr: `Script execution timed out after ${timeoutMs}ms`,
    exitCode: TIMEOUT_EXIT_CODE,
  };
}

function normalizeScriptResult(
  stdout: unknown,
  stderr: unknown,
  exitCode: unknown,
): SkillScriptResult {
  if (
    typeof stdout !== "string" || typeof stderr !== "string" ||
    typeof exitCode !== "number" || !Number.isSafeInteger(exitCode)
  ) {
    executorInputError("Skill script returned an invalid result.");
  }
  const outputBytes = new TextEncoder().encode(stdout).byteLength +
    new TextEncoder().encode(stderr).byteLength;
  if (outputBytes > MAX_SCRIPT_OUTPUT_BYTES) {
    executorInputError("Skill script output exceeds the supported size limit.");
  }
  return { stdout, stderr, exitCode };
}

function shellEscapeArg(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function buildShellCommand(parts: string[]): string {
  return parts.map(shellEscapeArg).join(" ");
}

function normalizeEnvironment(env: unknown): Record<string, string> | undefined {
  if (env === undefined) return undefined;
  if (typeof env !== "object" || env === null) {
    executorInputError("Skill script environment must be a plain object.");
  }
  let isArray = false;
  try {
    isArray = Array.isArray(env);
  } catch {
    executorInputError("Skill script environment must be readable.");
  }
  if (isArray) executorInputError("Skill script environment must be a plain object.");
  let keys: (string | symbol)[];
  try {
    keys = Reflect.ownKeys(env);
  } catch {
    executorInputError("Skill script environment must be readable.");
  }
  if (keys.length > MAX_SCRIPT_ENV_ENTRIES) {
    executorInputError("Skill script environment has too many entries.");
  }

  const normalized: Record<string, string> = Object.create(null);
  let totalLength = 0;
  for (const key of keys) {
    if (typeof key !== "string") {
      executorInputError("Skill script environment must use string keys.");
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(env, key);
    } catch {
      executorInputError("Skill script environment must be readable.");
    }
    if (!descriptor || !("value" in descriptor) || typeof descriptor.value !== "string") {
      executorInputError("Skill script environment must contain string data properties.");
    }
    const value = descriptor.value;
    if (!ENV_KEY_REGEX.test(key)) {
      executorInputError("Skill script environment contains an invalid variable name.");
    }
    if (value.length > MAX_SCRIPT_ENV_VALUE_LENGTH || value.includes("\0")) {
      executorInputError("Skill script environment contains an invalid value.");
    }
    totalLength += key.length + value.length;
    if (totalLength > MAX_SCRIPT_ENV_TOTAL_LENGTH) {
      executorInputError("Skill script environment is too large.");
    }
    Object.defineProperty(normalized, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  return normalized;
}

function createLocalProcessEnvironment(
  explicitEnv?: Record<string, string>,
): Record<string, string> {
  const environment: Record<string, string> = Object.create(null);
  for (const key of LOCAL_PROCESS_ENV_ALLOWLIST) {
    let value: string | undefined;
    try {
      value = getEnv(key);
    } catch {
      continue;
    }
    if (value !== undefined && value.length <= MAX_SCRIPT_ENV_VALUE_LENGTH) {
      Object.defineProperty(environment, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
  }
  if (explicitEnv) {
    for (const [key, value] of Object.entries(explicitEnv)) {
      Object.defineProperty(environment, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      });
    }
  }
  return environment;
}

function snapshotExecutorInput(input: SkillScriptExecutorInput): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    executorInputError("Skill script input must be a plain object.");
  }
  let isArray = false;
  try {
    isArray = Array.isArray(input);
  } catch {
    executorInputError("Skill script input must be readable.");
  }
  if (isArray) executorInputError("Skill script input must be a plain object.");
  let prototype: object | null;
  let keys: (string | symbol)[];
  try {
    prototype = Object.getPrototypeOf(input);
    keys = Reflect.ownKeys(input);
  } catch {
    executorInputError("Skill script input must be readable.");
  }
  if (prototype !== Object.prototype && prototype !== null) {
    executorInputError("Skill script input must be a plain object.");
  }
  if (keys.length > EXECUTOR_INPUT_FIELDS.size) {
    executorInputError("Skill script input contains unsupported fields.");
  }

  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    if (typeof key !== "string" || !EXECUTOR_INPUT_FIELDS.has(key)) {
      executorInputError("Skill script input contains unsupported fields.");
    }
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(input, key);
    } catch {
      executorInputError("Skill script input must be readable.");
    }
    if (!descriptor || !("value" in descriptor)) {
      executorInputError("Skill script input must contain data properties only.");
    }
    Object.defineProperty(snapshot, key, {
      configurable: true,
      enumerable: true,
      value: descriptor.value,
      writable: true,
    });
  }
  return snapshot;
}

function normalizeArguments(value: unknown): string[] {
  if (value === undefined) return [];
  let isArray = false;
  let lengthDescriptor: PropertyDescriptor | undefined;
  try {
    isArray = Array.isArray(value);
    if (isArray) lengthDescriptor = Reflect.getOwnPropertyDescriptor(value as object, "length");
  } catch {
    executorInputError("Skill script arguments must be readable.");
  }
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (!isArray || !Number.isSafeInteger(length) || length < 0 || length > MAX_SCRIPT_ARGUMENTS) {
    executorInputError("Skill script arguments exceed the supported count.");
  }

  const args: string[] = [];
  for (let index = 0; index < length; index += 1) {
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Reflect.getOwnPropertyDescriptor(value as object, String(index));
    } catch {
      executorInputError("Skill script arguments must be readable.");
    }
    if (!descriptor) {
      executorInputError("Skill script arguments must be a dense array.");
    }
    const argument = "value" in descriptor ? descriptor.value : undefined;
    if (
      typeof argument !== "string" || argument.length > MAX_SCRIPT_ARGUMENT_LENGTH ||
      argument.includes("\0")
    ) {
      executorInputError("Skill script contains an invalid argument.");
    }
    args.push(argument);
  }
  return args;
}

function normalizeAbortSignal(value: unknown): AbortSignal | undefined {
  if (value === undefined) return undefined;
  let isAbortSignal = false;
  try {
    isAbortSignal = value instanceof AbortSignal;
  } catch {
    // Use the stable validation error below.
  }
  if (!isAbortSignal) {
    executorInputError("Skill script abort signal is invalid.");
  }
  return value as AbortSignal;
}

function normalizeExecutorInput(input: SkillScriptExecutorInput): NormalizedExecutorInput {
  const snapshot = snapshotExecutorInput(input);
  const scriptPath = snapshot.scriptPath;
  if (
    typeof scriptPath !== "string" || !scriptPath ||
    scriptPath.length > MAX_SCRIPT_PATH_LENGTH || scriptPath.includes("\0")
  ) {
    executorInputError("Skill script path is invalid.");
  }

  const rawCwd = snapshot.cwd;
  let cwd: string | undefined;
  if (rawCwd !== undefined) {
    if (
      typeof rawCwd !== "string" || !rawCwd || rawCwd.length > MAX_SCRIPT_PATH_LENGTH ||
      rawCwd.includes("\0")
    ) {
      executorInputError("Skill script working directory is invalid.");
    }
    cwd = rawCwd;
  }

  const rawScriptContent = snapshot.scriptContent;
  let scriptContent: string | undefined;
  if (rawScriptContent !== undefined) {
    if (
      typeof rawScriptContent !== "string" ||
      rawScriptContent.length > MAX_SCRIPT_CONTENT_BYTES ||
      new TextEncoder().encode(rawScriptContent).byteLength > MAX_SCRIPT_CONTENT_BYTES
    ) {
      executorInputError("Skill script content exceeds the supported size limit.");
    }
    scriptContent = rawScriptContent;
  }

  const args = normalizeArguments(snapshot.args);
  const abortSignal = normalizeAbortSignal(snapshot.abortSignal);

  return {
    scriptPath,
    ...(scriptContent !== undefined ? { scriptContent } : {}),
    args,
    env: normalizeEnvironment(snapshot.env),
    ...(cwd !== undefined ? { cwd } : {}),
    timeoutMs: resolveTimeoutMs(snapshot.timeoutMs),
    ...(abortSignal !== undefined ? { abortSignal } : {}),
  };
}

function createSandboxScriptPath(scriptPath: string): string {
  const ext = extname(scriptPath) || ".sh";
  const suffix = crypto.randomUUID().slice(0, 8);
  return `/tmp/veryfront-skill-script-${Date.now()}-${suffix}${ext}`;
}

async function readBoundedScript(path: string): Promise<string> {
  let size: unknown;
  try {
    size = (await stat(path)).size;
  } catch {
    executorInputError("Unable to inspect the skill script.");
  }
  if (
    typeof size !== "number" || !Number.isSafeInteger(size) || size < 0 ||
    size > MAX_SCRIPT_CONTENT_BYTES
  ) {
    executorInputError("Skill script content exceeds the supported size limit.");
  }

  let content: string;
  try {
    content = await readTextFile(path);
  } catch {
    executorInputError("Unable to read the skill script.");
  }
  if (
    content.length > MAX_SCRIPT_CONTENT_BYTES ||
    new TextEncoder().encode(content).byteLength > MAX_SCRIPT_CONTENT_BYTES
  ) {
    executorInputError("Skill script content exceeds the supported size limit.");
  }
  return content;
}

function getSandboxAuthOverride(): string | undefined {
  return getEnv("SANDBOX_AUTH_TOKEN")?.trim() || undefined;
}

function isCloudScriptExecutionEnabled(): boolean {
  return Boolean(getSandboxAuthOverride()) || isVeryfrontCloudEnabled();
}

function normalizeRequestScopedAuthToken(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    executorInputError("Skill script request-scoped auth token is invalid.");
  }
  const normalized = value.trim();
  if (!normalized || normalized.length > MAX_REQUEST_SCOPED_AUTH_TOKEN_LENGTH) {
    executorInputError("Skill script request-scoped auth token is invalid.");
  }
  for (let index = 0; index < normalized.length; index += 1) {
    const code = normalized.charCodeAt(index);
    if (code <= 31 || code === 127) {
      executorInputError("Skill script request-scoped auth token is invalid.");
    }
  }
  return normalized;
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
    case ".bash":
      return { command: "bash", args: [scriptPath] };
    case ".js":
    case ".mjs":
    case ".cjs":
      return { command: "node", args: [scriptPath] };
    case ".ts":
    case ".mts":
    case ".cts":
      if (isDeno) {
        return {
          command: "deno",
          args: ["run", "--allow-read", "--allow-env", "--allow-net", "--allow-write", scriptPath],
        };
      }
      return { command: "node", args: [scriptPath] };
    default:
      return { command: scriptPath, args: [] };
  }
}

/**
 * Local script executor using runCommand() from the compat layer.
 */
export class LocalScriptExecutor implements SkillScriptExecutor {
  async execute(input: SkillScriptExecutorInput): Promise<SkillScriptResult> {
    const normalized = normalizeExecutorInput(input);
    throwIfAborted(normalized.abortSignal);
    const timeoutMs = normalized.timeoutMs!;
    const { command, args: runtimeArgs } = detectRuntime(normalized.scriptPath);
    const allArgs = [...runtimeArgs, ...normalized.args];

    // Remove the script path from args if it's already the command
    const finalArgs = command === normalized.scriptPath ? normalized.args : allArgs;

    const result = await runCommand(command, {
      args: finalArgs,
      cwd: normalized.cwd,
      env: createLocalProcessEnvironment(normalized.env),
      clearEnv: true,
      capture: true,
      timeoutMs,
      signal: normalized.abortSignal,
      maxOutputBytes: MAX_SCRIPT_OUTPUT_BYTES,
    });
    throwIfAborted(normalized.abortSignal);

    return normalizeScriptResult(result.stdout ?? "", result.stderr ?? "", result.code);
  }
}

/**
 * Cloud script executor using sandbox.
 * Uses SANDBOX_AUTH_TOKEN as an explicit override, otherwise falls back to the
 * standard Veryfront Cloud bootstrap.
 */
class CloudScriptExecutor implements SkillScriptExecutor {
  constructor(private readonly explicitAuthToken?: string) {}

  async execute(input: SkillScriptExecutorInput): Promise<SkillScriptResult> {
    const startedAt = performance.now();
    const normalized = normalizeExecutorInput(input);
    throwIfAborted(normalized.abortSignal);
    const timeoutMs = normalized.timeoutMs!;
    const deadline = new ExecutorDeadline(timeoutMs, normalized.abortSignal, startedAt);
    let sandbox: SandboxInstance | undefined;
    let result: SkillScriptResult | undefined;
    let failure: unknown;
    let terminal: ExecutorDeadlineSentinel | undefined;
    let cleanupTerminal: ExecutorDeadlineSentinel | undefined;
    let shouldTerminateProcesses = false;

    try {
      const scriptContent = normalized.scriptContent ??
        await deadline.run(() => readBoundedScript(normalized.scriptPath));

      // Lazy import to avoid bundling sandbox in non-cloud environments.
      const { Sandbox } = await deadline.run(() => import("#veryfront/sandbox"));
      const authToken = this.explicitAuthToken ?? getSandboxAuthOverride();
      const createPromise = Sandbox.create(authToken ? { authToken } : undefined);
      try {
        const created = await deadline.race(createPromise);
        if (isExecutorDeadlineSentinel(created)) throw created;
        sandbox = created;
      } catch (error) {
        if (isExecutorDeadlineSentinel(error)) {
          closeLateCreatedSandbox(createPromise);
        }
        throw error;
      }

      const sandboxScriptPath = createSandboxScriptPath(normalized.scriptPath);
      await deadline.run(() =>
        sandbox!.writeFiles([{ path: sandboxScriptPath, content: scriptContent }])
      );
      const sandboxCwd = dirname(sandboxScriptPath);
      await deadline.run(() =>
        sandbox!.executeCommand(
          buildShellCommand(["chmod", "+x", sandboxScriptPath]),
          { cwd: sandboxCwd, timeout_seconds: deadline.remainingSeconds() },
        )
      );

      const { command, args: runtimeArgs } = detectRuntime(sandboxScriptPath);
      const allArgs = [...runtimeArgs, ...normalized.args];
      const finalArgs = command === sandboxScriptPath ? normalized.args : allArgs;

      const cmdString = buildShellCommand([command, ...finalArgs]);
      try {
        const commandResult = await deadline.run(() =>
          sandbox!.executeCommand(cmdString, {
            cwd: sandboxCwd,
            timeout_seconds: deadline.remainingSeconds(),
            ...(normalized.env === undefined ? {} : { env: normalized.env }),
          })
        );
        result = normalizeScriptResult(
          commandResult.stdout,
          commandResult.stderr,
          commandResult.exitCode,
        );
      } catch (error) {
        if (isExecutorDeadlineSentinel(error)) {
          shouldTerminateProcesses = true;
        }
        throw error;
      }
    } catch (error) {
      if (isExecutorDeadlineSentinel(error)) {
        terminal = error;
      } else {
        failure = error;
      }
    }

    if (sandbox !== undefined) {
      if (shouldTerminateProcesses) {
        const killPromise = sandbox.executeCommand("kill -9 -1 2>/dev/null || true");
        try {
          await deadline.race(killPromise);
        } catch {
          // Expected: closing the sandbox below is the authoritative cleanup.
        }
      }

      const closePromise = sandbox.close();
      try {
        const closeResult = await deadline.race(closePromise);
        if (isExecutorDeadlineSentinel(closeResult)) {
          cleanupTerminal = closeResult;
          void closePromise.catch((error) => {
            logSandboxCloseFailure(error);
          });
        }
      } catch (error) {
        logSandboxCloseFailure(error);
      }
    }

    const aborted = normalized.abortSignal?.aborted === true ||
      terminal === ABORT_SENTINEL || cleanupTerminal === ABORT_SENTINEL;
    const expired = terminal === TIMEOUT_SENTINEL || cleanupTerminal === TIMEOUT_SENTINEL ||
      deadline.isExpired();
    deadline.dispose();

    if (aborted) throwIfAborted(normalized.abortSignal);
    if (failure !== undefined) throw failure;
    if (expired) return timeoutResult(timeoutMs);
    if (result === undefined) {
      executorInputError("Skill script execution did not return a result.");
    }
    return result;
  }
}

/**
 * Get the appropriate script executor.
 * Checks cloud auth availability on every call so request-scoped credentials
 * and environment overrides are respected.
 */
export function getSkillScriptExecutor(): SkillScriptExecutor {
  return isCloudScriptExecutionEnabled() ? new CloudScriptExecutor() : new LocalScriptExecutor();
}

/**
 * Select an isolated executor for source supplied by a filesystem adapter.
 * Adapter paths are not host filesystem capabilities and must never be passed
 * to the local process executor.
 */
export function getIsolatedSkillScriptExecutor(authToken?: string): SkillScriptExecutor {
  const requestScopedAuthToken = normalizeRequestScopedAuthToken(authToken);
  if (!requestScopedAuthToken) {
    executorInputError(
      "Adapter-backed skill scripts require a request-scoped auth token for isolated execution.",
    );
  }
  return new CloudScriptExecutor(requestScopedAuthToken);
}
