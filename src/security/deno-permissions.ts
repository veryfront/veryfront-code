/**
 * Deno Permission Profiles
 *
 * Typed permission flag constants for different execution contexts.
 * Used internally by CLI and build tooling — not part of the public API.
 *
 * @module security/deno-permissions
 */

/**
 * SERVER — CLI server (dev, production, proxy, MCP, split-mode).
 * Also used by build and test tasks that need equivalent access.
 */
export const SERVER_PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-net",
  "--allow-env",
  "--allow-run",
  "--allow-sys",
  "--unstable-worker-options",
  "--unstable-net",
] as const;

/**
 * WORKFLOW_JOB — `ProcessJobExecutor` (RESTRICTED).
 * Runs user-authored code — no `--allow-run`, `--allow-ffi`, or `--allow-sys`.
 */
export const WORKFLOW_JOB_PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-net",
  "--allow-env",
] as const;

/**
 * BUILD_HELPER — manifest generators, framework source prep.
 * Only needs filesystem + env access.
 */
export const BUILD_HELPER_PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-env",
] as const;

/**
 * RENDER_WORKER — Per-project Worker for isolated code execution.
 * Read-only filesystem (transformed modules), network (data fetchers),
 * env (API keys and config). No subprocess/ffi/sys.
 */
export const RENDER_WORKER_PERMISSIONS = [
  "--allow-read",
  "--allow-net",
  "--allow-env",
] as const;
