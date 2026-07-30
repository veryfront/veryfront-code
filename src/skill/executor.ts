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
import {
  getPathIdentity,
  lstat,
  type PathIdentity,
  readTextFile,
  realPath,
} from "#veryfront/platform/compat/fs.ts";
import { dirname, extname, isAbsolute, relative, resolve } from "#veryfront/compat/path";
import { createError, toError } from "#veryfront/errors";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import type { SkillScriptExecutor, SkillScriptExecutorInput, SkillScriptResult } from "./types.ts";
import {
  isValidSkillScriptEnvironmentKey,
  SKILL_ROOT_PATH_MAX_LENGTH,
  SKILL_SCRIPT_DEFAULT_TIMEOUT_MS,
  SKILL_SCRIPT_MAX_ARG_BYTES_TOTAL,
  SKILL_SCRIPT_MAX_ARG_LENGTH,
  SKILL_SCRIPT_MAX_ARGS,
  SKILL_SCRIPT_MAX_CONTENT_BYTES,
  SKILL_SCRIPT_MAX_ENV_BYTES_TOTAL,
  SKILL_SCRIPT_MAX_ENV_ENTRIES,
  SKILL_SCRIPT_MAX_ENV_KEY_LENGTH,
  SKILL_SCRIPT_MAX_ENV_VALUE_LENGTH,
  SKILL_SCRIPT_MAX_OUTPUT_BYTES,
  SKILL_SCRIPT_MAX_TIMEOUT_MS,
} from "./limits.ts";
import { readBoundedSkillTextFile } from "./bounded-text-file.ts";
import { isWellFormedUtf16 } from "./string-safety.ts";
const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const defineOwnProperty = Object.defineProperty;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const ownKeys = Reflect.ownKeys;
const stringIncludes = String.prototype.includes;
const TIMEOUT_EXIT_CODE = 124;
const OUTPUT_LIMIT_EXIT_CODE = 125;
const ABORT_EXIT_CODE = 130;
const TIMEOUT_SENTINEL = Symbol("skill-script-timeout");
const ABORT_SENTINEL = Symbol("skill-script-abort");
const UTF8_ENCODER = new TextEncoder();
const SANDBOX_PREPARATION_TIMEOUT_MS = 5_000;
const SANDBOX_CLEANUP_TIMEOUT_SECONDS = 5;
const SANDBOX_CLEANUP_MAX_OUTPUT_BYTES = 65_536;

type TerminationSentinel = typeof ABORT_SENTINEL | typeof TIMEOUT_SENTINEL;

function hasOwn(object: object, key: PropertyKey): boolean {
  return apply(hasOwnProperty, object, [key]) as boolean;
}

function appendOwnArrayElement<T>(values: T[], value: T): void {
  defineOwnProperty(values, values.length, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

interface ExecutionBudget {
  readonly timeoutMs: number;
  remainingMs(): number;
}

function createExecutionBudget(timeoutMs: number): ExecutionBudget {
  const deadline = performance.now() + timeoutMs;
  return freeze({
    timeoutMs,
    remainingMs: () => Math.max(0, Math.ceil(deadline - performance.now())),
  });
}

function currentTermination(
  budget: ExecutionBudget,
  abortSignal?: AbortSignal,
): TerminationSentinel | undefined {
  if (abortSignal?.aborted) return ABORT_SENTINEL;
  if (budget.remainingMs() === 0) return TIMEOUT_SENTINEL;
  return undefined;
}

function terminationResult(
  settlement: TerminationSentinel,
  timeoutMs: number,
): SkillScriptResult {
  return settlement === ABORT_SENTINEL ? abortedResult() : timeoutResult(timeoutMs);
}

function throwCollectedFailures(failures: readonly unknown[], message: string): never {
  if (failures.length === 1) throw failures[0];
  throw new AggregateError([...failures], message);
}

function resolveTimeoutMs(timeoutMs?: number): number {
  if (timeoutMs === undefined || !Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return SKILL_SCRIPT_DEFAULT_TIMEOUT_MS;
  }
  return Math.min(Math.floor(timeoutMs), SKILL_SCRIPT_MAX_TIMEOUT_MS);
}

async function withTermination<T>(
  promise: Promise<T>,
  timeoutMs: number,
  abortSignal?: AbortSignal,
): Promise<T | typeof ABORT_SENTINEL | typeof TIMEOUT_SENTINEL> {
  if (abortSignal?.aborted) return ABORT_SENTINEL;

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<typeof TIMEOUT_SENTINEL>((resolve) => {
    timeoutId = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs);
  });
  let abortListener: (() => void) | undefined;
  const abortPromise = new Promise<typeof ABORT_SENTINEL>((resolve) => {
    if (!abortSignal) return;
    abortListener = () => resolve(ABORT_SENTINEL);
    abortSignal.addEventListener("abort", abortListener, { once: true });
  });

  try {
    return await Promise.race([promise, timeoutPromise, abortPromise]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
    if (abortListener) abortSignal?.removeEventListener("abort", abortListener);
  }
}

async function runWithinBudget<T>(
  budget: ExecutionBudget,
  abortSignal: AbortSignal | undefined,
  start: (remainingMs: number) => Promise<T>,
): Promise<T | TerminationSentinel> {
  const termination = currentTermination(budget, abortSignal);
  if (termination) return termination;

  const remainingMs = budget.remainingMs();
  const operation = start(remainingMs);
  const settlement = await withTermination(operation, remainingMs, abortSignal);
  if (settlement === ABORT_SENTINEL || settlement === TIMEOUT_SENTINEL) {
    operation.catch(() => {
      // Direct sandbox termination may reject the operation after its caller
      // has already received the bounded cancellation result.
    });
  }
  return settlement;
}

function timeoutResult(timeoutMs: number): SkillScriptResult {
  return {
    stdout: "",
    stderr: `Script execution timed out after ${timeoutMs}ms`,
    exitCode: TIMEOUT_EXIT_CODE,
  };
}

function abortedResult(): SkillScriptResult {
  return {
    stdout: "",
    stderr: "Script execution aborted",
    exitCode: ABORT_EXIT_CODE,
  };
}

function outputLimitResult(): SkillScriptResult {
  return {
    stdout: "",
    stderr: `Script output exceeded ${SKILL_SCRIPT_MAX_OUTPUT_BYTES} bytes`,
    exitCode: OUTPUT_LIMIT_EXIT_CODE,
  };
}

function shellEscapeArg(value: string): string {
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

function buildShellCommand(parts: string[]): string {
  return parts.map(shellEscapeArg).join(" ");
}

interface NormalizedSkillScriptExecutorInput {
  readonly scriptPath: string;
  readonly scriptContent?: string;
  readonly args: readonly string[];
  readonly env?: Readonly<Record<string, string>>;
  readonly cwd?: string;
  readonly validatedSourceRoot?: string;
  readonly timeoutMs: number;
  readonly abortSignal?: AbortSignal;
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !arrayIsArray(value);
}

function ownDataValue(record: Record<string, unknown>, key: string): unknown {
  const descriptor = getOwnPropertyDescriptor(record, key);
  if (!descriptor) return undefined;
  if (!hasOwn(descriptor, "value")) {
    throw new TypeError(`Skill script field "${key}" must be a data property`);
  }
  return descriptor.value;
}

function requireBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
  allowEmpty = false,
): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0)) {
    throw new TypeError(`${field} must be ${allowEmpty ? "a" : "a non-empty"} string`);
  }
  if (!isWellFormedUtf16(value) || apply(stringIncludes, value, ["\0"])) {
    throw new TypeError(`${field} must be valid text without NUL characters`);
  }
  if (value.length > maxLength) {
    throw new RangeError(`${field} must be at most ${maxLength} characters`);
  }
  return value;
}

function requireScriptContent(
  value: unknown,
  enforceToolLimits: boolean,
): string {
  const content = requireBoundedString(
    value,
    "Skill script content",
    enforceToolLimits ? SKILL_SCRIPT_MAX_CONTENT_BYTES : Number.MAX_SAFE_INTEGER,
    true,
  );
  if (
    enforceToolLimits &&
    UTF8_ENCODER.encode(content).byteLength > SKILL_SCRIPT_MAX_CONTENT_BYTES
  ) {
    throw new RangeError(
      `Skill script content must be at most ${SKILL_SCRIPT_MAX_CONTENT_BYTES} bytes`,
    );
  }
  return content;
}

function normalizeScriptArgs(
  value: unknown,
  enforceToolLimits: boolean,
): readonly string[] {
  if (value === undefined) return [];
  if (!arrayIsArray(value)) {
    throw new TypeError("Skill script args must be an array");
  }
  if (isProxyWithoutHooks(value)) {
    throw new TypeError("Skill script args must not be a proxy");
  }
  if (enforceToolLimits && value.length > SKILL_SCRIPT_MAX_ARGS) {
    throw new RangeError(`Skill script args accepts at most ${SKILL_SCRIPT_MAX_ARGS} entries`);
  }

  const args: string[] = [];
  let totalBytes = 0;
  for (let index = 0; index < value.length; index++) {
    const descriptor = getOwnPropertyDescriptor(value, index);
    if (!descriptor || !hasOwn(descriptor, "value")) {
      throw new TypeError(`Skill script arg ${index} must be a data property`);
    }
    const arg = requireBoundedString(
      descriptor.value,
      `Skill script arg ${index}`,
      enforceToolLimits ? SKILL_SCRIPT_MAX_ARG_LENGTH : Number.MAX_SAFE_INTEGER,
      true,
    );
    if (enforceToolLimits) {
      totalBytes += UTF8_ENCODER.encode(arg).byteLength;
    }
    if (enforceToolLimits && totalBytes > SKILL_SCRIPT_MAX_ARG_BYTES_TOTAL) {
      throw new RangeError(
        `Skill script args must total at most ${SKILL_SCRIPT_MAX_ARG_BYTES_TOTAL} bytes`,
      );
    }
    appendOwnArrayElement(args, arg);
  }
  return freeze(args);
}

function normalizeScriptEnv(
  value: unknown,
  enforceToolLimits: boolean,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  if (!isObjectRecord(value)) {
    throw new TypeError("Skill script env must be an object");
  }
  if (isProxyWithoutHooks(value)) {
    throw new TypeError("Skill script env must not be a proxy");
  }

  const descriptors = getOwnPropertyDescriptors(value);
  const entries: Array<readonly [string, PropertyDescriptor]> = [];
  const descriptorKeys = ownKeys(descriptors);
  for (let index = 0; index < descriptorKeys.length; index += 1) {
    const key = descriptorKeys[index]!;
    const descriptor = descriptors[key as keyof typeof descriptors];
    if (!descriptor?.enumerable) continue;
    if (typeof key !== "string") {
      throw new TypeError("Skill script env keys must be strings");
    }
    appendOwnArrayElement(entries, [key, descriptor] as const);
  }
  if (enforceToolLimits && entries.length > SKILL_SCRIPT_MAX_ENV_ENTRIES) {
    throw new RangeError(
      `Skill script env accepts at most ${SKILL_SCRIPT_MAX_ENV_ENTRIES} entries`,
    );
  }

  const env: Record<string, string> = {};
  let totalBytes = 0;
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const key = entry[0];
    const descriptor = entry[1];
    if (!hasOwn(descriptor, "value")) {
      throw new TypeError(`Skill script env "${key}" must be a data property`);
    }
    if (!isValidSkillScriptEnvironmentKey(key)) {
      throw toError(
        createError({
          type: "agent",
          message: `Invalid environment variable name: "${key}"`,
        }),
      );
    }
    if (enforceToolLimits && key.length > SKILL_SCRIPT_MAX_ENV_KEY_LENGTH) {
      throw new RangeError(
        `Skill script environment names must be at most ${SKILL_SCRIPT_MAX_ENV_KEY_LENGTH} characters`,
      );
    }
    const envValue = requireBoundedString(
      descriptor.value,
      `Skill script environment value for "${key}"`,
      enforceToolLimits ? SKILL_SCRIPT_MAX_ENV_VALUE_LENGTH : Number.MAX_SAFE_INTEGER,
      true,
    );
    if (enforceToolLimits) {
      totalBytes += UTF8_ENCODER.encode(`${key}=${envValue}\0`).byteLength;
    }
    if (enforceToolLimits && totalBytes > SKILL_SCRIPT_MAX_ENV_BYTES_TOTAL) {
      throw new RangeError(
        `Skill script environment must total at most ${SKILL_SCRIPT_MAX_ENV_BYTES_TOTAL} bytes`,
      );
    }
    defineOwnProperty(env, key, {
      configurable: false,
      enumerable: true,
      value: envValue,
      writable: false,
    });
  }
  return freeze(env);
}

function normalizeExecutorInput(
  input: SkillScriptExecutorInput,
): NormalizedSkillScriptExecutorInput {
  if (!isObjectRecord(input)) {
    throw new TypeError("Skill script executor input must be an object");
  }
  if (isProxyWithoutHooks(input)) {
    throw new TypeError("Skill script executor input must not be a proxy");
  }

  const rawValidatedSourceRoot = ownDataValue(input, "validatedSourceRoot");
  const validatedSourceRoot = rawValidatedSourceRoot === undefined
    ? undefined
    : requireBoundedString(
      rawValidatedSourceRoot,
      "Skill script validated source root",
      SKILL_ROOT_PATH_MAX_LENGTH,
    );
  const enforceToolLimits = validatedSourceRoot !== undefined;
  const scriptPath = requireBoundedString(
    ownDataValue(input, "scriptPath"),
    "Skill script path",
    enforceToolLimits ? SKILL_ROOT_PATH_MAX_LENGTH : Number.MAX_SAFE_INTEGER,
  );
  const rawScriptContent = ownDataValue(input, "scriptContent");
  const scriptContent = rawScriptContent === undefined
    ? undefined
    : requireScriptContent(rawScriptContent, enforceToolLimits);
  const rawCwd = ownDataValue(input, "cwd");
  const cwd = rawCwd === undefined ? undefined : requireBoundedString(
    rawCwd,
    "Skill script cwd",
    enforceToolLimits ? SKILL_ROOT_PATH_MAX_LENGTH : Number.MAX_SAFE_INTEGER,
  );
  const timeoutMs = resolveTimeoutMs(ownDataValue(input, "timeoutMs") as number | undefined);
  const rawAbortSignal = ownDataValue(input, "abortSignal");
  if (rawAbortSignal !== undefined && !(rawAbortSignal instanceof AbortSignal)) {
    throw new TypeError("Skill script abortSignal must be an AbortSignal");
  }
  const env = normalizeScriptEnv(ownDataValue(input, "env"), enforceToolLimits);

  return freeze({
    scriptPath,
    ...(scriptContent === undefined ? {} : { scriptContent }),
    args: normalizeScriptArgs(ownDataValue(input, "args"), enforceToolLimits),
    ...(env === undefined ? {} : { env }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(validatedSourceRoot === undefined ? {} : { validatedSourceRoot }),
    timeoutMs,
    ...(rawAbortSignal === undefined ? {} : { abortSignal: rawAbortSignal }),
  });
}

interface SandboxScriptLocation {
  readonly workingDirectory: string;
  readonly scriptPath: string;
}

function createSandboxScriptLocation(scriptPath: string): SandboxScriptLocation {
  const ext = extname(scriptPath) || ".sh";
  const suffix = crypto.randomUUID().slice(0, 8);
  const workingDirectory = `/tmp/veryfront-skill-script-${Date.now()}-${suffix}`;
  return freeze({
    workingDirectory,
    scriptPath: `${workingDirectory}/script${ext}`,
  });
}

function getSandboxAuthOverride(): string | undefined {
  return getEnv("SANDBOX_AUTH_TOKEN")?.trim() || undefined;
}

function hasCloudScriptExecutionAuth(): boolean {
  return Boolean(getSandboxAuthOverride() || getVeryfrontCloudAuthToken());
}

interface SkillExecutionSandbox {
  executeCommand(
    command: string,
    options?: {
      cwd?: string;
      env?: Record<string, string>;
      timeout_seconds?: number;
      maxOutputBytes?: number;
    },
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
  writeFiles(files: Array<{ path: string; content: string }>): Promise<void>;
  close(): Promise<void>;
}

async function terminateSandboxProcesses(
  sandbox: SkillExecutionSandbox,
): Promise<void> {
  const result = await sandbox.executeCommand(
    // The official sandbox runtime is Linux/Bash with its HTTP service as
    // container PID 1. Linux excludes both PID 1 and the kill(2) caller from
    // kill(-1, SIGKILL); forcing Bash's builtin makes the command shell the
    // caller so it can report the terminal exit event after killing peers.
    "builtin kill -KILL -1",
    {
      timeout_seconds: SANDBOX_CLEANUP_TIMEOUT_SECONDS,
      maxOutputBytes: SANDBOX_CLEANUP_MAX_OUTPUT_BYTES,
    },
  );
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim().slice(0, 2_000);
    throw new Error(
      `Sandbox process termination failed with exit code ${result.exitCode}${
        detail ? `: ${detail}` : ""
      }`,
    );
  }
}

async function runSandboxPreparationCommand(
  sandbox: SkillExecutionSandbox,
  command: string,
  operation: string,
  budget: ExecutionBudget,
  abortSignal?: AbortSignal,
): Promise<TerminationSentinel | undefined> {
  const settlement = await runWithinBudget(
    budget,
    abortSignal,
    (remainingMs) =>
      sandbox.executeCommand(
        command,
        {
          timeout_seconds: Math.max(
            1,
            Math.ceil(Math.min(SANDBOX_PREPARATION_TIMEOUT_MS, remainingMs) / 1_000),
          ),
          maxOutputBytes: SANDBOX_CLEANUP_MAX_OUTPUT_BYTES,
        },
      ),
  );
  if (settlement === ABORT_SENTINEL || settlement === TIMEOUT_SENTINEL) return settlement;
  const result = settlement;
  if (result.exitCode !== 0) {
    const detail = result.stderr.trim().slice(0, 2_000);
    throw new Error(
      `${operation} failed with exit code ${result.exitCode}${detail ? `: ${detail}` : ""}`,
    );
  }
  return undefined;
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
      // Never let local skill execution install an unpinned package from the
      // network. Node/Bun callers must provide tsx in their existing toolchain.
      return { command: "npx", args: ["--no-install", "tsx", scriptPath] };
    default:
      return { command: scriptPath, args: [] };
  }
}

interface ValidatedLocalScriptContext {
  readonly lexicalRoot: string;
  readonly lexicalScriptDirectory: string;
  readonly lexicalScriptPath: string;
  readonly canonicalRoot: string;
  readonly canonicalScriptDirectory: string;
  readonly canonicalScriptPath: string;
  readonly rootIdentity: PathIdentity;
  readonly scriptDirectoryIdentity: PathIdentity;
  readonly scriptIdentity: PathIdentity;
}

function isPathContained(root: string, target: string): boolean {
  const pathFromRoot = relative(root, target);
  return pathFromRoot === "" ||
    (
      !isAbsolute(pathFromRoot) &&
      pathFromRoot !== ".." &&
      !pathFromRoot.startsWith("../") &&
      !pathFromRoot.startsWith("..\\")
    );
}

function isSameCanonicalPath(left: string, right: string): boolean {
  const leftToRight = relative(left, right);
  const rightToLeft = relative(right, left);
  return (leftToRight === "" || leftToRight === ".") &&
    (rightToLeft === "" || rightToLeft === ".");
}

function isSamePathIdentity(left: PathIdentity, right: PathIdentity): boolean {
  return left.device === right.device && left.inode === right.inode;
}

function requirePathIdentity(
  identity: PathIdentity | undefined,
  label: string,
): PathIdentity {
  if (!identity) {
    throw new Error(
      `Cannot safely validate the skill script because ${label} has no stable filesystem identity`,
    );
  }
  return identity;
}

function assertRegularFile(
  info: Awaited<ReturnType<typeof lstat>>,
  label: string,
): void {
  if (info.isSymlink || !info.isFile || info.isDirectory) {
    throw new TypeError(`${label} must be a regular file and not a symbolic link`);
  }
}

function assertDirectory(
  info: Awaited<ReturnType<typeof lstat>>,
  label: string,
): void {
  if (info.isSymlink || !info.isDirectory || info.isFile) {
    throw new TypeError(`${label} must be a directory and not a symbolic link`);
  }
}

async function captureValidatedLocalScriptContext(
  normalized: NormalizedSkillScriptExecutorInput,
): Promise<ValidatedLocalScriptContext> {
  if (!normalized.validatedSourceRoot) {
    throw new Error("Validated local skill execution requires a source root");
  }

  const lexicalRoot = resolve(normalized.validatedSourceRoot);
  const lexicalScriptPath = isAbsolute(normalized.scriptPath)
    ? resolve(normalized.scriptPath)
    : resolve(lexicalRoot, normalized.scriptPath);
  const lexicalScriptDirectory = dirname(lexicalScriptPath);

  const [rootInfo, scriptDirectoryInfo, scriptInfo] = await Promise.all([
    lstat(lexicalRoot),
    lstat(lexicalScriptDirectory),
    lstat(lexicalScriptPath),
  ]);
  assertDirectory(rootInfo, "Skill script working directory");
  assertDirectory(scriptDirectoryInfo, "Skill script directory");
  assertRegularFile(scriptInfo, "Skill script source");

  const [canonicalRoot, canonicalScriptDirectory, canonicalScriptPath] = await Promise.all([
    realPath(lexicalRoot),
    realPath(lexicalScriptDirectory),
    realPath(lexicalScriptPath),
  ]);
  if (
    !isPathContained(canonicalRoot, canonicalScriptDirectory) ||
    !isPathContained(canonicalRoot, canonicalScriptPath) ||
    !isSameCanonicalPath(canonicalScriptDirectory, dirname(canonicalScriptPath))
  ) {
    throw new TypeError("Skill script source must remain inside its working directory");
  }

  const [rootIdentity, scriptDirectoryIdentity, scriptIdentity] = await Promise.all([
    getPathIdentity(canonicalRoot),
    getPathIdentity(canonicalScriptDirectory),
    getPathIdentity(canonicalScriptPath),
  ]);

  return freeze({
    lexicalRoot,
    lexicalScriptDirectory,
    lexicalScriptPath,
    canonicalRoot,
    canonicalScriptDirectory,
    canonicalScriptPath,
    rootIdentity: requirePathIdentity(rootIdentity, "the skill root"),
    scriptDirectoryIdentity: requirePathIdentity(
      scriptDirectoryIdentity,
      "the script directory",
    ),
    scriptIdentity: requirePathIdentity(scriptIdentity, "the selected script"),
  });
}

async function assertValidatedLocalScriptContextUnchanged(
  context: ValidatedLocalScriptContext,
): Promise<void> {
  const [rootInfo, scriptDirectoryInfo, scriptInfo] = await Promise.all([
    lstat(context.lexicalRoot),
    lstat(context.lexicalScriptDirectory),
    lstat(context.lexicalScriptPath),
  ]);
  assertDirectory(rootInfo, "Skill script working directory");
  assertDirectory(scriptDirectoryInfo, "Skill script directory");
  assertRegularFile(scriptInfo, "Skill script source");

  const [canonicalRoot, canonicalScriptDirectory, canonicalScriptPath] = await Promise.all([
    realPath(context.lexicalRoot),
    realPath(context.lexicalScriptDirectory),
    realPath(context.lexicalScriptPath),
  ]);
  if (
    !isSameCanonicalPath(canonicalRoot, context.canonicalRoot) ||
    !isSameCanonicalPath(canonicalScriptDirectory, context.canonicalScriptDirectory) ||
    !isSameCanonicalPath(canonicalScriptPath, context.canonicalScriptPath) ||
    !isPathContained(canonicalRoot, canonicalScriptDirectory) ||
    !isPathContained(canonicalRoot, canonicalScriptPath)
  ) {
    throw new Error("Skill script filesystem context changed while preparing execution");
  }

  const [rootIdentity, scriptDirectoryIdentity, scriptIdentity] = await Promise.all([
    getPathIdentity(canonicalRoot),
    getPathIdentity(canonicalScriptDirectory),
    getPathIdentity(canonicalScriptPath),
  ]);
  if (
    !isSamePathIdentity(
      context.rootIdentity,
      requirePathIdentity(rootIdentity, "the skill root"),
    ) ||
    !isSamePathIdentity(
      context.scriptDirectoryIdentity,
      requirePathIdentity(scriptDirectoryIdentity, "the script directory"),
    ) ||
    !isSamePathIdentity(
      context.scriptIdentity,
      requirePathIdentity(scriptIdentity, "the selected script"),
    )
  ) {
    throw new Error("Skill script filesystem identity changed while preparing execution");
  }
}

type PreparedValidatedLocalScript = Readonly<{
  scriptPath: string;
  scriptContent: string;
}>;

async function prepareValidatedLocalScript(
  normalized: NormalizedSkillScriptExecutorInput,
): Promise<PreparedValidatedLocalScript> {
  const context = await captureValidatedLocalScriptContext(normalized);
  const currentContent = await readBoundedLocalScript(context.lexicalScriptPath);
  if (
    normalized.scriptContent !== undefined &&
    currentContent !== normalized.scriptContent
  ) {
    throw new Error("Skill script content changed while preparing execution");
  }
  await assertValidatedLocalScriptContextUnchanged(context);
  return freeze({
    scriptPath: context.lexicalScriptPath,
    scriptContent: normalized.scriptContent ?? currentContent,
  });
}

/**
 * Local script executor using runCommand() from the compat layer.
 */
export class LocalScriptExecutor implements SkillScriptExecutor {
  async execute(input: SkillScriptExecutorInput): Promise<SkillScriptResult> {
    const normalized = normalizeExecutorInput(input);
    if (normalized.abortSignal?.aborted) return abortedResult();
    const budget = createExecutionBudget(normalized.timeoutMs);

    if (normalized.validatedSourceRoot === undefined) {
      return await executeLocalScriptAtPath(normalized, normalized.scriptPath, budget);
    }

    const preparation = await runWithinBudget(
      budget,
      normalized.abortSignal,
      () => prepareValidatedLocalScript(normalized),
    );
    if (preparation === ABORT_SENTINEL || preparation === TIMEOUT_SENTINEL) {
      return terminationResult(preparation, budget.timeoutMs);
    }

    // The final containment, content, and identity checks above happen before
    // the interpreter opens the validated path. Local skills are trusted
    // development code: a same-user writer can still race that later open, and
    // imported dependencies are resolved from the live source tree.
    return await executeLocalScriptAtPath(normalized, preparation.scriptPath, budget);
  }
}

async function executeLocalScriptAtPath(
  normalized: NormalizedSkillScriptExecutorInput,
  executableScriptPath: string,
  budget: ExecutionBudget,
): Promise<SkillScriptResult> {
  const termination = currentTermination(budget, normalized.abortSignal);
  if (termination) return terminationResult(termination, budget.timeoutMs);
  const { command, args: runtimeArgs } = detectRuntime(executableScriptPath);
  const allArgs = [...runtimeArgs, ...normalized.args];

  // Remove the script path from args if it's already the command.
  const finalArgs = command === executableScriptPath ? [...normalized.args] : allArgs;

  const result = await runCommand(command, {
    args: finalArgs,
    cwd: normalized.cwd,
    env: normalized.env,
    capture: true,
    timeoutMs: budget.remainingMs(),
    signal: normalized.abortSignal,
    ...(normalized.validatedSourceRoot === undefined ? {} : {
      maxOutputBytes: SKILL_SCRIPT_MAX_OUTPUT_BYTES,
      terminateProcessTreeOnExit: true,
    }),
  });

  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    exitCode: result.code,
  };
}

async function readBoundedLocalScript(path: string): Promise<string> {
  return await readBoundedSkillTextFile(
    path,
    undefined,
    SKILL_SCRIPT_MAX_CONTENT_BYTES,
  );
}

async function executeCloudScriptInSandbox(
  normalized: NormalizedSkillScriptExecutorInput,
  sandbox: SkillExecutionSandbox,
  isSandboxOutputLimitError: (error: unknown) => boolean,
  budget: ExecutionBudget,
): Promise<SkillScriptResult> {
  const initialTermination = currentTermination(budget, normalized.abortSignal);
  if (initialTermination) return terminationResult(initialTermination, budget.timeoutMs);

  // A host filesystem cwd cannot be reused inside the sandbox. Map it to a
  // fresh remote directory containing only the selected script.
  const sandboxLocation = createSandboxScriptLocation(normalized.scriptPath);
  const scriptContent = normalized.scriptContent;
  if (scriptContent === undefined) {
    throw new Error("Sandbox skill execution requires a validated script-content snapshot");
  }

  const directorySettlement = await runSandboxPreparationCommand(
    sandbox,
    buildShellCommand(["mkdir", "-p", sandboxLocation.workingDirectory]),
    "Creating the sandbox skill working directory",
    budget,
    normalized.abortSignal,
  );
  if (directorySettlement) return terminationResult(directorySettlement, budget.timeoutMs);

  const writeSettlement = await runWithinBudget(
    budget,
    normalized.abortSignal,
    () => sandbox.writeFiles([{ path: sandboxLocation.scriptPath, content: scriptContent }]),
  );
  if (writeSettlement === ABORT_SENTINEL || writeSettlement === TIMEOUT_SENTINEL) {
    return terminationResult(writeSettlement, budget.timeoutMs);
  }

  const permissionSettlement = await runSandboxPreparationCommand(
    sandbox,
    buildShellCommand(["chmod", "+x", sandboxLocation.scriptPath]),
    "Preparing the sandbox skill script",
    budget,
    normalized.abortSignal,
  );
  if (permissionSettlement) return terminationResult(permissionSettlement, budget.timeoutMs);

  const { command, args: runtimeArgs } = detectRuntime(sandboxLocation.scriptPath);
  const allArgs = [...runtimeArgs, ...normalized.args];
  const finalArgs = command === sandboxLocation.scriptPath ? normalized.args : allArgs;

  let settlement:
    | Awaited<ReturnType<SkillExecutionSandbox["executeCommand"]>>
    | TerminationSentinel;
  try {
    settlement = await runWithinBudget(
      budget,
      normalized.abortSignal,
      (remainingMs) =>
        sandbox.executeCommand(
          buildShellCommand([command, ...finalArgs]),
          {
            cwd: sandboxLocation.workingDirectory,
            ...(normalized.env === undefined ? {} : { env: { ...normalized.env } }),
            timeout_seconds: Math.max(1, Math.ceil(remainingMs / 1_000)),
            ...(normalized.validatedSourceRoot === undefined
              ? {}
              : { maxOutputBytes: SKILL_SCRIPT_MAX_OUTPUT_BYTES }),
          },
        ),
    );
  } catch (error) {
    if (!isSandboxOutputLimitError(error)) throw error;
    return outputLimitResult();
  }

  if (settlement === TIMEOUT_SENTINEL || settlement === ABORT_SENTINEL) {
    return terminationResult(settlement, budget.timeoutMs);
  }

  return {
    stdout: settlement.stdout,
    stderr: settlement.stderr,
    exitCode: settlement.exitCode,
  };
}

/**
 * Cloud script executor using sandbox.
 * Uses SANDBOX_AUTH_TOKEN as an explicit override, otherwise falls back to the
 * standard Veryfront Cloud bootstrap.
 */
class CloudScriptExecutor implements SkillScriptExecutor {
  async execute(input: SkillScriptExecutorInput): Promise<SkillScriptResult> {
    const normalized = normalizeExecutorInput(input);
    if (normalized.abortSignal?.aborted) return abortedResult();
    const budget = createExecutionBudget(normalized.timeoutMs);

    let cloudInput = normalized;
    if (normalized.scriptContent === undefined) {
      const contentSettlement = await runWithinBudget<
        string | PreparedValidatedLocalScript
      >(
        budget,
        normalized.abortSignal,
        () =>
          normalized.validatedSourceRoot
            ? prepareValidatedLocalScript(normalized)
            : readTextFile(normalized.scriptPath),
      );
      if (contentSettlement === ABORT_SENTINEL || contentSettlement === TIMEOUT_SENTINEL) {
        return terminationResult(contentSettlement, budget.timeoutMs);
      }
      cloudInput = typeof contentSettlement === "string"
        ? freeze({ ...normalized, scriptContent: contentSettlement })
        : freeze({
          ...normalized,
          scriptPath: contentSettlement.scriptPath,
          scriptContent: contentSettlement.scriptContent,
        });
    }

    // Lazy import to avoid bundling sandbox in non-cloud environments
    const { isSandboxOutputLimitError, Sandbox } = await import("#veryfront/sandbox");
    const beforeProvisioning = currentTermination(budget, normalized.abortSignal);
    if (beforeProvisioning) return terminationResult(beforeProvisioning, budget.timeoutMs);

    const authToken = getSandboxAuthOverride();
    const provisioningTimeoutMs = budget.remainingMs();
    let sandbox: SkillExecutionSandbox;
    try {
      sandbox = await Sandbox.create({
        ...(authToken ? { authToken } : {}),
        startupTimeoutMs: provisioningTimeoutMs,
        controlRequestTimeoutMs: provisioningTimeoutMs,
        pollIntervalMs: Math.max(1, Math.min(2_000, provisioningTimeoutMs)),
      });
    } catch (error) {
      const provisioningTermination = currentTermination(budget, normalized.abortSignal);
      if (provisioningTermination) {
        return terminationResult(provisioningTermination, budget.timeoutMs);
      }
      throw error;
    }

    const failures: unknown[] = [];
    let executionResult: SkillScriptResult | undefined;
    try {
      executionResult = await executeCloudScriptInSandbox(
        cloudInput,
        sandbox,
        isSandboxOutputLimitError,
        budget,
      );
    } catch (error) {
      const executionTermination = currentTermination(budget, normalized.abortSignal);
      if (executionTermination) {
        executionResult = terminationResult(executionTermination, budget.timeoutMs);
      } else {
        appendOwnArrayElement(failures, error);
      }
    }

    const mustTerminateSandboxProcesses = cloudInput.validatedSourceRoot !== undefined ||
      failures.length > 0 ||
      executionResult === undefined ||
      executionResult.exitCode !== 0;
    if (mustTerminateSandboxProcesses) {
      try {
        // Validated tool execution owns no durable background services.
        // Termination is mandatory after every tool settlement: a successful
        // entrypoint can otherwise leave redirected background descendants
        // running until the later asynchronous session deletion completes.
        await terminateSandboxProcesses(sandbox);
      } catch (error) {
        appendOwnArrayElement(failures, error);
      }
    }

    try {
      await sandbox.close();
    } catch (error) {
      appendOwnArrayElement(failures, error);
    }

    if (failures.length > 0) {
      throwCollectedFailures(
        failures,
        "Sandbox skill execution and lifecycle cleanup failed",
      );
    }
    if (!executionResult) {
      throw new Error("Sandbox skill execution completed without a result");
    }
    return executionResult;
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
