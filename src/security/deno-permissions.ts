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
 * WORKFLOW_RUN — `ProcessRunExecutor` (RESTRICTED).
 * Runs user-authored code — no `--allow-run`, `--allow-ffi`, or `--allow-sys`.
 *
 * `--allow-env` is intentionally left unscoped here rather than pinned to a
 * static allowlist: the set of env vars a run legitimately needs (tenant
 * context, MODE/run IDs, operator-supplied vars such as REDIS_URL) is assembled
 * dynamically per execution and cannot be enumerated statically. The child uses
 * `clearEnv: true`, so it does not ordinarily inherit arbitrary host variables.
 * This profile still grants broad read, write, and network access and is only
 * suitable for trusted local code. It is not a secret-isolation boundary.
 */
export const WORKFLOW_RUN_PERMISSIONS = [
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
