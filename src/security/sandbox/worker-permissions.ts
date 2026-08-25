/**
 * Worker Permission Builder
 *
 * Builds scoped Deno Worker permissions for per-project isolation.
 * Each project worker gets the minimum required permissions.
 *
 * @module security/sandbox/worker-permissions
 */

import { getFrameworkRootFromMeta } from "#veryfront/platform/compat/vfs-paths.ts";
import { join } from "#veryfront/compat/path/index.ts";

/**
 * Deno Worker permission object.
 * See: https://docs.deno.com/runtime/fundamentals/permissions/
 */
export interface WorkerPermissions {
  read: readonly string[] | boolean;
  write: boolean;
  net: boolean;
  env: readonly string[] | boolean;
  run: boolean;
  ffi: boolean;
  sys: boolean;
  /** Remote module loading is always denied; extension worker graphs must be local. */
  import: readonly string[] | boolean;
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
  const frameworkRoot = getFrameworkRootFromMeta(import.meta.url);
  return normalizeReadPaths([
    join(frameworkRoot, "src"),
    join(frameworkRoot, "dist", "framework-src"),
  ]);
}

/**
 * Build scoped permissions for a project worker.
 *
 * - read: restricted to exact project roots and immutable framework source dirs
 * - write: denied (workers produce output via postMessage, not filesystem)
 * - net: broker-scoped by ProjectWorker before user code starts
 * - env: denied; request-owned project env travels through handler contexts
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
  // Deno's env permission is read/write and process-global across Workers. A
  // project Worker must never receive it, even for an apparently read-only
  // allowlist. Request-owned project env is transported in the worker protocol
  // instead of mutating the host process environment.
  const env = false;

  if (isCompiledBinary) {
    const compiledReadPaths = options.compiledReadPaths ?? getDefaultCompiledReadPaths();
    if (compiledReadPaths.length === 0) {
      throw new TypeError("Compiled worker framework read scope is unavailable");
    }
    const scopedReadPaths = normalizeReadPaths([...normalizedReadPaths, ...compiledReadPaths]);
    return {
      read: scopedReadPaths.length > 0 ? scopedReadPaths : false,
      write: false,
      net: true,
      env,
      run: false,
      ffi: false,
      sys: false,
      import: false,
    };
  }

  return {
    read: normalizedReadPaths.length > 0 ? normalizedReadPaths : false,
    write: false,
    net: true,
    env,
    run: false,
    ffi: false,
    sys: false,
    import: false,
  };
}
