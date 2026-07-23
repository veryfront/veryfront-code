/**
 * Deno API compatibility shims for cross-runtime testing.
 *
 * Provides portable implementations of common Deno testing APIs:
 * - Deno.makeTempDir() → makeTempDir()
 * - Deno.makeTempFile() → makeTempFile()
 * - Deno.writeTextFile() → writeTextFile()
 * - Deno.readTextFile() → readTextFile()
 * - Deno.remove() → remove()
 * - Deno.mkdir() → mkdir()
 * - Deno.stat() → stat()
 * - Deno.env.get/set/delete → getEnv/setEnv/deleteEnv
 *
 * @module
 */

import { isDeno } from "#veryfront/platform/compat/runtime.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { scaleMs } from "./timing.ts";
import { TIMEOUT_ERROR } from "#veryfront/errors";
import { sanitizeErrorText } from "#veryfront/errors/sanitization.ts";
import {
  assertEnvKey,
  assertEnvValue,
  createChildEnvOverlay,
  ensureEnvOverlayRuntime,
} from "./env-overlay.ts";
import {
  isAlreadyExistsError,
  isNotFoundError as isMissingPathError,
  remove as removePath,
} from "#veryfront/platform/compat/fs.ts";

const MAX_TEMP_FILE_CREATE_ATTEMPTS = 8;
const DEFAULT_WAIT_TIMEOUT_MS = 5_000;
const DEFAULT_WAIT_INTERVAL_MS = 100;
const MAX_WAIT_MESSAGE_LENGTH = 4_096;
const MAX_ENV_OVERRIDE_KEYS = 10_000;
const WAIT_DEADLINE_REACHED = Symbol("wait-deadline-reached");

export {
  chmod,
  createFileSystem,
  exists,
  type FileSystem,
  isAlreadyExistsError,
  isNotFoundError,
  makeTempDir,
  mkdir,
  readDir,
  readFile,
  readTextFile,
  remove,
  stat,
  writeFile,
  writeTextFile,
} from "#veryfront/platform/compat/fs.ts";

export type { FileInfo } from "#veryfront/platform/adapters/base.ts";

export {
  cwd,
  deleteEnv,
  env,
  getArgs,
  getEnv,
  setEnv,
} from "#veryfront/platform/compat/process.ts";

/** Create temp file. */
export async function makeTempFile(
  options?: { prefix?: string; suffix?: string },
): Promise<string> {
  const prefix = options?.prefix ?? "tmp-";
  const suffix = options?.suffix ?? "";
  validateTempAffix(prefix, "prefix");
  validateTempAffix(suffix, "suffix");

  if (isDeno) {
    return await Deno.makeTempFile({ ...options, prefix, suffix });
  }

  const [{ default: os }, { default: fs }, { default: path }, { randomUUID }] = await Promise.all([
    import("node:os"),
    import("node:fs/promises"),
    import("node:path"),
    import("node:crypto"),
  ]);

  for (let attempt = 0; attempt < MAX_TEMP_FILE_CREATE_ATTEMPTS; attempt++) {
    const filename = `${prefix}${randomUUID()}${suffix}`;
    const tempPath = path.join(os.tmpdir(), filename);
    try {
      await fs.writeFile(tempPath, "", { flag: "wx" });
      return tempPath;
    } catch (error) {
      if (!isAlreadyExistsError(error)) throw error;
    }
  }

  throw new Error(
    `Unable to create a unique temporary file after ${MAX_TEMP_FILE_CREATE_ATTEMPTS} attempts`,
  );
}

/** Create a temporary directory, optionally under a specific base directory. */
export async function makeTempDirWithOptions(options?: {
  prefix?: string;
  dir?: string;
}): Promise<string> {
  const prefix = options?.prefix ?? "tmp-";
  validateTempAffix(prefix, "prefix");

  if (isDeno) {
    return await Deno.makeTempDir({ ...options, prefix });
  }

  const [{ default: os }, { default: fs }, { default: path }] = await Promise.all([
    import("node:os"),
    import("node:fs/promises"),
    import("node:path"),
  ]);

  const baseDir = options?.dir ?? os.tmpdir();
  const joinedPrefix = path.join(baseDir, prefix);
  const tempPrefix = prefix.length === 0 && !joinedPrefix.endsWith(path.sep)
    ? `${joinedPrefix}${path.sep}`
    : joinedPrefix;
  return await fs.mkdtemp(tempPrefix);
}

function validateTempAffix(value: string, label: string): void {
  if (
    typeof value !== "string" || value.includes("\0") || value.includes("/") ||
    value.includes("\\")
  ) {
    throw new TypeError(`Temporary path ${label} must not contain path separators`);
  }
}

/** Options for bounded condition polling. */
export interface WaitForOptions {
  /** Maximum total wait duration in milliseconds. */
  timeout?: number;
  /** Delay between condition attempts in milliseconds. */
  interval?: number;
  /** Bounded diagnostic detail included in the timeout error. */
  message?: string;
  /** Signal that stops polling before the timeout. */
  signal?: AbortSignal;
}

function abortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason;
  const error = new Error("Wait aborted");
  error.name = "AbortError";
  return error;
}

async function settleBeforeDeadline<T>(
  operation: Promise<T>,
  remainingMs: number,
  signal?: AbortSignal,
): Promise<T | typeof WAIT_DEADLINE_REACHED> {
  if (signal?.aborted) throw abortReason(signal);

  return await new Promise<T | typeof WAIT_DEADLINE_REACHED>((resolve, reject) => {
    let settled = false;
    const onAbort = () => finish(() => reject(abortReason(signal!)));
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const finish = (complete: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      complete();
    };

    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(
      () => finish(() => resolve(WAIT_DEADLINE_REACHED)),
      Math.max(0, remainingMs),
    );
    operation.then(
      (value) => finish(() => resolve(value)),
      (error) => finish(() => reject(error)),
    );
  });
}

async function waitForNextAttempt(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) throw abortReason(signal);
  await new Promise<void>((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      reject(abortReason(signal!));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
  });
}

/** Wait until a condition succeeds. */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options?: WaitForOptions,
): Promise<void> {
  if (typeof condition !== "function") throw new TypeError("Wait condition must be a function");

  const timeout = scaleMs(options?.timeout ?? DEFAULT_WAIT_TIMEOUT_MS, 0);
  const interval = scaleMs(options?.interval ?? DEFAULT_WAIT_INTERVAL_MS);
  const rawMessage = options?.message ?? "Condition not met within timeout";
  if (typeof rawMessage !== "string") throw new TypeError("Wait message must be a string");
  const message = sanitizeErrorText(rawMessage, MAX_WAIT_MESSAGE_LENGTH) ||
    "Condition not met within timeout";
  const signal = options?.signal;
  const deadline = performance.now() + timeout;

  while (true) {
    const remainingBeforeAttempt = Math.max(0, deadline - performance.now());
    const result = await settleBeforeDeadline(
      Promise.resolve().then(condition),
      remainingBeforeAttempt,
      signal,
    );
    if (result === WAIT_DEADLINE_REACHED) break;
    if (result) return;
    const remaining = deadline - performance.now();
    if (remaining <= 0) break;
    await waitForNextAttempt(Math.min(interval, remaining), signal);
  }

  throw TIMEOUT_ERROR.create({ detail: `${message} (timeout: ${timeout}ms)` });
}

/** Wait for a duration in milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, scaleMs(ms)));
}

/** Exit the current process. */
export function exit(code: number): never {
  if (isDeno) {
    Deno.exit(code);
  }

  process.exit(code);
}

async function runWithPathCleanup<T>(
  path: string,
  recursive: boolean,
  fn: (path: string) => T | Promise<T>,
): Promise<T> {
  let callbackResult: T | undefined;
  let callbackError: unknown;
  let callbackFailed = false;
  try {
    callbackResult = await fn(path);
  } catch (error) {
    callbackFailed = true;
    callbackError = error;
  }

  let cleanupError: unknown;
  let cleanupFailed = false;
  try {
    await removePath(path, recursive ? { recursive: true } : undefined);
  } catch (error) {
    if (!isMissingPathError(error)) {
      cleanupFailed = true;
      cleanupError = error;
    }
  }

  if (callbackFailed && cleanupFailed) {
    throw new AggregateError(
      [callbackError, cleanupError],
      "Temporary path callback and cleanup both failed",
    );
  }
  if (cleanupFailed) throw cleanupError;
  if (callbackFailed) throw callbackError;
  return callbackResult as T;
}

/** Run a callback with a temporary directory, then remove the directory. */
export async function withTempDir<T>(
  fn: (tempDir: string) => T | Promise<T>,
  options?: { prefix?: string },
): Promise<T> {
  const tempDir = await makeTempDirWithOptions({ prefix: options?.prefix ?? "test-" });
  return await runWithPathCleanup(tempDir, true, fn);
}

/** Run a callback with a temporary file, then remove the file. */
export async function withTempFile<T>(
  fn: (tempFile: string) => T | Promise<T>,
  options?: { prefix?: string; suffix?: string },
): Promise<T> {
  const tempFile = await makeTempFile({ prefix: options?.prefix, suffix: options?.suffix });
  return await runWithPathCleanup(tempFile, false, fn);
}

/**
 * Run a callback with isolated environment variable overrides.
 *
 * Overrides must be enumerable own data properties. The helper rejects accessor-backed
 * values and records with more than 10,000 own keys before changing the environment.
 */
export async function withEnv<T>(
  vars: Record<string, string>,
  fn: () => T | Promise<T>,
): Promise<T> {
  if (!vars || typeof vars !== "object" || Array.isArray(vars)) {
    throw new TypeError("Environment variables must be a record");
  }
  if (typeof fn !== "function") throw new TypeError("Environment callback must be a function");

  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(vars);
  } catch {
    throw new TypeError("Environment variables must be an inspectable record");
  }
  if (keys.length > MAX_ENV_OVERRIDE_KEYS) {
    throw new RangeError(
      `Environment variables must contain at most ${MAX_ENV_OVERRIDE_KEYS} own keys`,
    );
  }

  const entries: Array<[string, string]> = [];
  for (const key of keys) {
    if (typeof key !== "string") continue;
    let descriptor: PropertyDescriptor | undefined;
    try {
      descriptor = Object.getOwnPropertyDescriptor(vars, key);
    } catch {
      throw new TypeError("Environment variables must be an inspectable record");
    }
    if (!descriptor?.enumerable) continue;
    if (!("value" in descriptor)) {
      throw new TypeError("Environment variable overrides must use data properties");
    }
    entries.push([key, descriptor.value as string]);
  }
  for (const [key, value] of entries) {
    assertEnvKey(key);
    if (typeof value !== "string") {
      throw new TypeError("Environment variable values must be strings");
    }
    assertEnvValue(value);
  }

  const run = async (): Promise<T> => {
    const original = new Map<string, string | undefined>();
    for (const [key] of entries) {
      original.set(key, getEnv(key));
    }

    let callbackResult: T | undefined;
    let operationError: unknown;
    let operationFailed = false;
    try {
      for (const [key, value] of entries) setEnv(key, value);
      callbackResult = await fn();
    } catch (error) {
      operationFailed = true;
      operationError = error;
    }

    const restorationErrors: unknown[] = [];
    for (const [key, value] of original.entries()) {
      try {
        if (value === undefined) {
          deleteEnv(key);
        } else {
          setEnv(key, value);
        }
      } catch (error) {
        restorationErrors.push(error);
      }
    }

    if (operationFailed && restorationErrors.length > 0) {
      throw new AggregateError(
        [operationError, ...restorationErrors],
        "Environment callback and restoration both failed",
      );
    }
    if (restorationErrors.length > 0) {
      throw new AggregateError(restorationErrors, "Environment restoration failed");
    }
    if (operationFailed) throw operationError;
    return callbackResult as T;
  };

  const storage = ensureEnvOverlayRuntime();
  if (!storage.run) return await run();
  return await storage.run(createChildEnvOverlay(), run);
}
