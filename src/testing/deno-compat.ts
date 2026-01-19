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

import { isDeno } from "../platform/compat/runtime.ts";
import { scaleMs } from "./timing.ts";

// ============================================================================
// Re-export from existing compat modules
// ============================================================================

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
} from "../platform/compat/fs.ts";

export { cwd, deleteEnv, env, getArgs, getEnv, setEnv } from "../platform/compat/process.ts";

// ============================================================================
// Additional temp file utilities not in the main compat layer
// ============================================================================

/**
 * Creates a temporary file.
 *
 * @param options - Options for temp file creation
 * @returns Path to the created temp file
 */
export async function makeTempFile(
  options?: { prefix?: string; suffix?: string },
): Promise<string> {
  if (isDeno) {
    // @ts-ignore - Deno global
    return await Deno.makeTempFile(options);
  }

  // Node.js/Bun implementation
  const [os, fs, path] = await Promise.all([
    import("node:os"),
    import("node:fs/promises"),
    import("node:path"),
  ]);

  const prefix = options?.prefix ?? "tmp-";
  const suffix = options?.suffix ?? "";
  const randomPart = Math.random().toString(36).substring(2, 10);
  const filename = `${prefix}${randomPart}${suffix}`;
  const tempPath = path.default.join(os.default.tmpdir(), filename);

  // Create empty file
  await fs.default.writeFile(tempPath, "");

  return tempPath;
}

/**
 * Creates a temporary directory with an optional prefix and returns its path.
 * This is a convenience re-export with additional options support.
 *
 * @param options - Options for temp directory creation
 * @returns Path to the created temp directory
 */
export async function makeTempDirWithOptions(options?: {
  prefix?: string;
  dir?: string;
}): Promise<string> {
  if (isDeno) {
    // @ts-ignore - Deno global
    return await Deno.makeTempDir(options);
  }

  // Node.js/Bun implementation
  const [os, fs, path] = await Promise.all([
    import("node:os"),
    import("node:fs/promises"),
    import("node:path"),
  ]);

  const baseDir = options?.dir ?? os.default.tmpdir();
  const prefix = options?.prefix ?? "tmp-";
  const randomPart = Math.random().toString(36).substring(2, 10);
  const dirname = `${prefix}${randomPart}`;
  const tempPath = path.default.join(baseDir, dirname);

  await fs.default.mkdir(tempPath, { recursive: true });

  return tempPath;
}

// ============================================================================
// Deno-specific test utilities
// ============================================================================

/**
 * Wait for a condition to be true with timeout.
 * Useful for async test assertions.
 *
 * @param condition - Function that returns true when condition is met
 * @param options - Options for polling
 */
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
    if (await condition()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }

  throw new Error(`${message} (timeout: ${timeout}ms)`);
}

/**
 * Delay execution for a specified number of milliseconds.
 *
 * @param ms - Milliseconds to delay
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, scaleMs(ms)));
}

/**
 * Portable way to exit the process (for test runners).
 *
 * @param code - Exit code
 */
export function exit(code: number): never {
  if (isDeno) {
    // @ts-ignore - Deno global
    Deno.exit(code);
  } else {
    process.exit(code);
  }
  throw new Error("unreachable");
}

// ============================================================================
// Test isolation helpers
// ============================================================================

/**
 * Runs a function with a temporary directory, cleaning up afterward.
 *
 * @param fn - Function to run with the temp directory path
 * @param options - Options for temp directory creation
 */
export async function withTempDir<T>(
  fn: (tempDir: string) => Promise<T>,
  options?: { prefix?: string },
): Promise<T> {
  const tempDir = await makeTempDirWithOptions({ prefix: options?.prefix ?? "test-" });

  try {
    return await fn(tempDir);
  } finally {
    try {
      if (isDeno) {
        // @ts-ignore - Deno global
        await Deno.remove(tempDir, { recursive: true });
      } else {
        const fs = await import("node:fs/promises");
        await fs.default.rm(tempDir, { recursive: true, force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Runs a function with a temporary file, cleaning up afterward.
 *
 * @param fn - Function to run with the temp file path
 * @param options - Options for temp file creation
 */
export async function withTempFile<T>(
  fn: (tempFile: string) => Promise<T>,
  options?: { prefix?: string; suffix?: string },
): Promise<T> {
  const tempFile = await makeTempFile({ prefix: options?.prefix, suffix: options?.suffix });

  try {
    return await fn(tempFile);
  } finally {
    try {
      if (isDeno) {
        // @ts-ignore - Deno global
        await Deno.remove(tempFile);
      } else {
        const fs = await import("node:fs/promises");
        await fs.default.rm(tempFile, { force: true });
      }
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Sets environment variables for the duration of a function, restoring them afterward.
 *
 * @param vars - Environment variables to set
 * @param fn - Function to run with the environment variables
 */
export async function withEnv<T>(
  vars: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const { getEnv, setEnv, deleteEnv } = await import("../platform/compat/process.ts");

  // Save original values
  const original: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) {
    original[key] = getEnv(key);
  }

  // Set new values
  for (const [key, value] of Object.entries(vars)) {
    setEnv(key, value);
  }

  try {
    return await fn();
  } finally {
    // Restore original values
    for (const [key, value] of Object.entries(original)) {
      if (value === undefined) {
        deleteEnv(key);
      } else {
        setEnv(key, value);
      }
    }
  }
}
