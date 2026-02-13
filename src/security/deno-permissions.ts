/**
 * Deno Permission Profiles
 *
 * Typed permission flag constants for different execution contexts.
 * Replaces `--allow-all` with least-privilege profiles.
 *
 * @module security/deno-permissions
 */

/** Convert an array of permission flags to a single shell-friendly string. */
export function toFlagString(flags: readonly string[]): string {
  return flags.join(" ");
}

/**
 * SERVER — CLI server (dev, production, proxy, MCP, split-mode).
 * Needs full access except `--allow-hrtime` and future auto-granted permissions.
 */
export const SERVER_PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-net",
  "--allow-env",
  "--allow-run",
  "--allow-ffi",
  "--allow-sys",
] as const;

/**
 * BUILD — `deno compile` and build scripts that need the same breadth as the server.
 */
export const BUILD_PERMISSIONS = [...SERVER_PERMISSIONS] as const;

/**
 * TEST — all `deno test` tasks.
 */
export const TEST_PERMISSIONS = [...SERVER_PERMISSIONS] as const;

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
 * SCRIPT — setup, release, batch, rlm tools.
 * Like SERVER but without `--allow-ffi`.
 */
export const SCRIPT_PERMISSIONS = [
  "--allow-read",
  "--allow-write",
  "--allow-net",
  "--allow-env",
  "--allow-run",
  "--allow-sys",
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
