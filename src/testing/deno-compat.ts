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

export async function makeTempFile(
  options?: { prefix?: string; suffix?: string },
): Promise<string> {
  if (isDeno) {
    // @ts-ignore - Deno global
    return await Deno.makeTempFile(options);
  }

  const [{ default: os }, { default: fs }, { default: path }] = await Promise.all([
    import("node:os"),
    import("node:fs/promises"),
    import("node:path"),
  ]);

  const prefix = options?.prefix ?? "tmp-";
  const suffix = options?.suffix ?? "";
  const randomPart = Math.random().toString(36).substring(2, 10);
  const filename = `${prefix}${randomPart}${suffix}`;
  const tempPath = path.join(os.tmpdir(), filename);

  await fs.writeFile(tempPath, "");
  return tempPath;
}

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
  const randomPart = Math.random().toString(36).substring(2, 10);
  const dirname = `${prefix}${randomPart}`;
  const tempPath = path.join(baseDir, dirname);

  await fs.mkdir(tempPath, { recursive: true });
  return tempPath;
}

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
    await new Promise<void>((resolve) => setTimeout(resolve, interval));
  }

  throw TIMEOUT_ERROR.create({ detail: `${message} (timeout: ${timeout}ms)` });
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, scaleMs(ms)));
}

export function exit(code: number): never {
  if (isDeno) {
    // @ts-ignore - Deno global
    Deno.exit(code);
  }

  process.exit(code);
}

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
        const { default: fs } = await import("node:fs/promises");
        await fs.rm(tempDir, { recursive: true, force: true });
      }
    } catch (_) {
      /* expected: temp dir may already be removed or inaccessible */
    }
  }
}

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
        const { default: fs } = await import("node:fs/promises");
        await fs.rm(tempFile, { force: true });
      }
    } catch (_) {
      /* expected: temp file may already be removed or inaccessible */
    }
  }
}

export async function withEnv<T>(
  vars: Record<string, string>,
  fn: () => Promise<T>,
): Promise<T> {
  const { getEnv, setEnv, deleteEnv } = await import("../platform/compat/process.ts");

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
