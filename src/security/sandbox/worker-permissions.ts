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

/**
 * Build scoped permissions for a project worker.
 *
 * - read: restricted to the project temp dir (transformed modules) and cache dirs
 * - write: denied (workers produce output via postMessage, not filesystem)
 * - net: allowed (data fetchers and API routes may call external APIs)
 * - env: denied (project env vars are passed via postMessage, not process env)
 * - run: denied (no subprocess spawning from user code)
 * - ffi: denied (no native code from user code)
 * - sys: denied (no system info access from user code)
 */
export function buildWorkerPermissions(
  readPaths: string[],
): WorkerPermissions {
  return {
    read: readPaths.length > 0 ? readPaths : false,
    write: false,
    net: true,
    env: false,
    run: false,
    ffi: false,
    sys: false,
  };
}
