/**
 * Worker Permission Builder
 *
 * Builds scoped Deno Worker permissions for per-project isolation.
 * Each project worker gets the minimum required permissions.
 *
 * @module security/sandbox/worker-permissions
 */

import { getFrameworkRootFromMeta } from "#veryfront/platform/compat/vfs-paths.ts";
import { getHostEnv } from "#veryfront/platform/compat/process.ts";
import {
  getCacheBaseDir,
  getHttpBundleCacheDir,
  getMdxEsmCacheDir,
} from "#veryfront/utils/cache-dir.ts";

/**
 * Deno Worker permission object.
 * See: https://docs.deno.com/runtime/fundamentals/permissions/
 */
export interface WorkerPermissions {
  read: string[] | boolean;
  write: boolean;
  net: boolean;
  env: boolean;
  run: boolean;
  ffi: boolean;
  sys: boolean;
}

interface WorkerPermissionOptions {
  /** Override for tests that need to exercise compiled-binary behavior. */
  isCompiledBinary?: boolean;
  /** Override for tests that need deterministic compiled-binary support paths. */
  compiledReadPaths?: string[];
}

// Cache compiled binary check — Deno.execPath() is a syscall that never changes at runtime
const _isCompiledBinary = (() => {
  try {
    const exec = typeof Deno !== "undefined" ? Deno.execPath?.() : undefined;
    if (!exec) return false;
    const name = exec.split(/[/\\]/).pop()?.toLowerCase() ?? "";
    return name !== "deno" && name !== "deno.exe";
  } catch {
    return false;
  }
})();

function normalizeReadPaths(paths: Array<string | undefined>): string[] {
  const unique = new Set<string>();
  for (const path of paths) {
    if (!path) continue;
    const trimmed = path.trim();
    if (!trimmed) continue;
    unique.add(trimmed);
  }
  return [...unique];
}

function getDefaultCompiledReadPaths(): string[] {
  return normalizeReadPaths([
    getFrameworkRootFromMeta(import.meta.url),
    getCacheBaseDir(),
    getMdxEsmCacheDir(),
    getHttpBundleCacheDir(),
    getHostEnv("DENO_DIR"),
  ]);
}

/**
 * Build scoped permissions for a project worker.
 *
 * - read: restricted to the project temp dir (transformed modules) and cache dirs
 * - write: denied (workers produce output via postMessage, not filesystem)
 * - net: allowed (data fetchers and API routes may call external APIs)
 * - env: allowed (user code reads API keys and config from environment)
 * - run: denied (no subprocess spawning from user code)
 * - ffi: denied (no native code from user code)
 * - sys: denied (no system info access from user code)
 */
export function buildWorkerPermissions(
  readPaths: string[],
  options: WorkerPermissionOptions = {},
): WorkerPermissions {
  const isCompiledBinary = options.isCompiledBinary ?? _isCompiledBinary;
  const normalizedReadPaths = normalizeReadPaths(readPaths);

  if (isCompiledBinary) {
    const compiledReadPaths = options.compiledReadPaths ?? getDefaultCompiledReadPaths();
    const scopedReadPaths = normalizeReadPaths([...normalizedReadPaths, ...compiledReadPaths]);
    return {
      read: scopedReadPaths.length > 0 ? scopedReadPaths : false,
      write: false,
      net: true,
      env: true,
      run: false,
      ffi: false,
      sys: false,
    };
  }

  return {
    read: normalizedReadPaths.length > 0 ? normalizedReadPaths : false,
    write: false,
    net: true,
    env: true,
    run: false,
    ffi: false,
    sys: false,
  };
}
