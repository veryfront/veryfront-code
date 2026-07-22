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
import { scaleMs } from "./timing.ts";
import { TIMEOUT_ERROR } from "#veryfront/errors";
import { isAlreadyExistsError, isNotFoundError } from "#veryfront/platform/compat/fs.ts";

export {
  chmod,
  createFileSystem,
  exists,
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

export {
  cwd,
  deleteEnv,
  env,
  getArgs,
  getEnv,
  setEnv,
} from "#veryfront/platform/compat/process.ts";

/** Atomically create a uniquely named temporary file. */
export async function makeTempFile(
  options?: { prefix?: string; suffix?: string },
): Promise<string> {
  if (isDeno) {
    // @ts-ignore - Deno global
    return await Deno.makeTempFile(options);
  }

  const [{ default: os }, { default: fs }, { default: path }, { randomUUID }] = await Promise.all([
    import("node:os"),
    import("node:fs/promises"),
    import("node:path"),
    import("node:crypto"),
  ]);

  const prefix = options?.prefix ?? "tmp-";
  const suffix = options?.suffix ?? "";
  validateTempAffix(prefix);
  validateTempAffix(suffix);

  for (let attempt = 0; attempt < 16; attempt++) {
    const tempPath = path.join(os.tmpdir(), `${prefix}${randomUUID()}${suffix}`);
    let handle: Awaited<ReturnType<typeof fs.open>>;
    try {
      handle = await fs.open(tempPath, "wx", 0o600);
    } catch (error) {
      if (isAlreadyExistsError(error)) continue;
      throw error;
    }

    try {
      await handle.close();
      return tempPath;
    } catch (error) {
      try {
        await fs.rm(tempPath, { force: true });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          "Temporary file handle close and cleanup both failed",
        );
      }
      throw error;
    }
  }

  throw new Error("Unable to allocate a unique temporary file after 16 attempts");
}

/** Atomically create a uniquely named temporary directory. */
export async function makeTempDirWithOptions(options?: {
  prefix?: string;
  dir?: string;
}): Promise<string> {
  if (isDeno) {
    // @ts-ignore - Deno global
    return await Deno.makeTempDir(options);
  }

  const [{ default: os }, { default: fs }, { default: path }] = await Promise.all([
    import("node:os"),
    import("node:fs/promises"),
    import("node:path"),
  ]);

  const baseDir = options?.dir ?? os.tmpdir();
  const prefix = options?.prefix ?? "tmp-";
  validateTempAffix(prefix);

  return await fs.mkdtemp(path.join(baseDir, prefix));
}

function validateTempAffix(value: string): void {
  if (/[\\/\0]/.test(value)) {
    throw new Error('Invalid character in prefix or suffix: "/"');
  }
}

/** Wait until a condition succeeds. */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options?: {
    timeout?: number;
    interval?: number;
    message?: string;
  },
): Promise<void> {
  const timeout = scaleMs(options?.timeout ?? 5000, 10);
  const interval = scaleMs(options?.interval ?? 100, 5);
  const message = options?.message ?? "Condition not met within timeout";
  const start = Date.now();

  while (Date.now() - start < timeout) {
    if (await condition()) return;
    // no cleanup needed: one-shot
    await new Promise<void>((resolve) => setTimeout(resolve, interval));
  }

  throw TIMEOUT_ERROR.create({ detail: `${message} (timeout: ${timeout}ms)` });
}

// no cleanup needed: one-shot
/** Wait for a duration in milliseconds. */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, scaleMs(ms)));
}

/** Exit the current process. */
export function exit(code: number): never {
  if (isDeno) {
    // @ts-ignore - Deno global
    Deno.exit(code);
  }

  process.exit(code);
}

/** Run a callback with a temporary directory and reliably remove it afterward. */
export async function withTempDir<T>(
  fn: (tempDir: string) => Promise<T>,
  options?: { prefix?: string },
): Promise<T> {
  const tempDir = await makeTempDirWithOptions({ prefix: options?.prefix ?? "test-" });
  return await runWithCleanup("temporary directory", tempDir, fn, async () => {
    try {
      if (isDeno) {
        // @ts-ignore - Deno global
        await Deno.remove(tempDir, { recursive: true });
      } else {
        const { default: fs } = await import("node:fs/promises");
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  });
}

/** Run a callback with a temporary file and reliably remove it afterward. */
export async function withTempFile<T>(
  fn: (tempFile: string) => Promise<T>,
  options?: { prefix?: string; suffix?: string },
): Promise<T> {
  const tempFile = await makeTempFile({ prefix: options?.prefix, suffix: options?.suffix });
  return await runWithCleanup("temporary file", tempFile, fn, async () => {
    try {
      if (isDeno) {
        // @ts-ignore - Deno global
        await Deno.remove(tempFile);
      } else {
        const { default: fs } = await import("node:fs/promises");
        await fs.rm(tempFile, { force: true });
      }
    } catch (error) {
      if (!isNotFoundError(error)) throw error;
    }
  });
}

async function runWithCleanup<T>(
  label: string,
  path: string,
  fn: (path: string) => Promise<T>,
  cleanup: () => Promise<void>,
): Promise<T> {
  let operationFailed = false;
  let operationError: unknown;
  let result: T | undefined;

  try {
    result = await fn(path);
  } catch (error) {
    operationFailed = true;
    operationError = error;
  }

  let cleanupFailure: Error | undefined;
  try {
    await cleanup();
  } catch (error) {
    cleanupFailure = new Error(`${label} cleanup failed`, { cause: error });
  }

  if (cleanupFailure) {
    if (operationFailed) {
      throw new AggregateError(
        [operationError, cleanupFailure],
        `${label} callback and cleanup both failed`,
      );
    }
    throw cleanupFailure;
  }
  if (operationFailed) throw operationError;
  return result as T;
}

/** Run a callback with an async-context-isolated environment overlay. */
export async function withEnv<T>(
  vars: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const { deleteEnv, getEnv, getEnvOverlayStorage, setEnv } = await import(
    "../platform/compat/process.ts"
  );

  const storage = getEnvOverlayStorage();
  if (storage?.run) {
    const active = storage.getStore();
    const scoped = active instanceof Map
      ? new Map<string, string | null>(active as Map<string, string | null>)
      : new Map<string, string | null>();
    for (const [key, value] of Object.entries(vars)) scoped.set(key, value);
    return await storage.run(scoped, fn);
  }

  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    original[key] = getEnv(key);
  }

  for (const [key, value] of Object.entries(vars)) {
    setEnv(key, value);
  }

  try {
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        deleteEnv(key);
      } else {
        setEnv(key, value);
      }
    }
  }
}
