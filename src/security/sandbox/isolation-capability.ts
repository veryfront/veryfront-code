/**
 * Whether this build can prepare an isolated API route module.
 *
 * @module security/sandbox/isolation-capability
 */

import { isCompiledBinary } from "#veryfront/utils";

let compiledOverrideForTests: boolean | undefined;

/** Shared by every surface that reports the limitation, including the logs. */
export const ISOLATED_API_PREPARATION_UNSUPPORTED_REASON =
  "Isolated API route preparation is unavailable in this compiled runtime: prepared " +
  "route source links framework imports to relative ./_vf_*.mjs specifiers that a " +
  "worker data: URL cannot resolve";

/**
 * Whether isolated API route preparation can succeed in this runtime.
 *
 * Not a statement about the transpiler: a compiled binary ships esbuild and
 * transpiles tenant API routes on every host-realm request. It is linkage that
 * fails. The compiled rewrite emits relative `./_vf_*.mjs` sidecars
 * (transforms/import-rewriter/route-adapter.ts), which resolve from the host's
 * temp `handler.mjs` but not from the worker's base64 `data:` URL
 * (security/sandbox/worker-script.ts). Do not delete the refusal without
 * closing that.
 *
 * @param compiled Override runtime detection, primarily for deterministic tests.
 */
export function isIsolatedApiPreparationSupported(
  compiled: boolean = compiledOverrideForTests ?? isCompiledBinary(),
): boolean {
  return !compiled;
}

/**
 * Force compiled-binary detection — testing only. Pass `undefined` to restore.
 *
 * `isCompiledBinary()` reads a module-load-time const and Deno has no module
 * mocking, so the compiled branch is otherwise unreachable in a unit test.
 * Callers that also read worker-pool isolation flags must follow this with
 * `__resetPoolForTests()`.
 */
export function __setCompiledBinaryForTests(value: boolean | undefined): void {
  compiledOverrideForTests = value;
}
