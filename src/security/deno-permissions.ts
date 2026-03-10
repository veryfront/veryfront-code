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
