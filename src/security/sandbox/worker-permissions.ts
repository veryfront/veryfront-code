/**
 * Worker Permission Builder
 *
 * Builds scoped Deno Worker permissions for per-project isolation.
 * Each project worker gets the minimum required permissions.
 *
 * @module security/sandbox/worker-permissions
 */

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
): WorkerPermissions {
  // In compiled binaries, user modules import from the VFS temp dir which
  // is outside the project directory. Rather than trying to enumerate all
  // read paths, grant full read access — the security boundary is enforced
  // by denying write/run/ffi/sys, not by restricting reads.
  if (_isCompiledBinary) {
    return {
      read: true,
      write: false,
      net: true,
      env: true,
      run: false,
      ffi: false,
      sys: false,
    };
  }

  return {
    read: readPaths.length > 0 ? readPaths : false,
    write: false,
    net: true,
    env: true,
    run: false,
    ffi: false,
    sys: false,
  };
}
