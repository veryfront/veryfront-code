/**
 * Whether this build can prepare an isolated API route module.
 *
 * This is a capability report, not a policy.
 *
 * It is deliberately not a statement about the transpiler. The compiled binary
 * ships a working esbuild and runs the *same* `buildTranspiledModuleSource` on
 * every host-realm API request — `loadModule` routes through it precisely
 * because a compiled binary cannot import raw `.ts`
 * (routing/api/module-loader/loader.ts). Preparation does not fail for want of a
 * transpiler.
 *
 * What does not survive is the shape of the compiled output. Under a compiled
 * binary the rewrite turns `from "veryfront"` into a *relative*
 * `./_vf_runtime.mjs`, and `from "veryfront/<x>"` into `./_vf_<x>.mjs`
 * (transforms/import-rewriter/route-adapter.ts). The host realm gets away with
 * that because it writes those sidecars next to a temporary `handler.mjs` and
 * imports it as a `file:` URL, where a relative specifier resolves. The worker
 * imports prepared source as a base64 `data:` URL
 * (security/sandbox/worker-script.ts), and a relative specifier cannot resolve
 * from a `data:` URL at all. So a compiled prepared module fails to link inside
 * the worker for any handler that imports the framework — which is most of them.
 *
 * Preparation is therefore refused in a compiled binary until that linkage is
 * closed. Do not delete the refusal without closing it; it is not a leftover.
 *
 * This module is the single source of truth. The loader enforces it, API
 * ownership reports it as a typed 503, and the worker-pool flag resolver
 * consults it to decide whether a configured isolation posture can be honoured.
 * They must not drift.
 *
 * @module security/sandbox/isolation-capability
 */

import { isCompiledBinary } from "#veryfront/utils";

let compiledOverrideForTests: boolean | undefined;

/**
 * Operator-facing reason. Shared verbatim by every surface that reports the
 * limitation, including the log line operators already grep for.
 */
export const ISOLATED_API_PREPARATION_UNSUPPORTED_REASON =
  "Isolated API route preparation is unavailable in this compiled runtime: prepared " +
  "route source links framework imports to relative ./_vf_*.mjs specifiers that a " +
  "worker data: URL cannot resolve";

/**
 * Whether isolated API route preparation can succeed in this runtime.
 *
 * @param compiled Override runtime detection, primarily for deterministic tests.
 */
export function isIsolatedApiPreparationSupported(
  compiled: boolean = compiledOverrideForTests ?? isCompiledBinary(),
): boolean {
  return !compiled;
}

/**
 * Force compiled-binary detection — for testing only. Pass `undefined` to restore.
 *
 * `isCompiledBinary()` reads a module-load-time const
 * (platform/compat/runtime.ts) that is always false under `deno test`, and Deno
 * has no module mocking, so the compiled branch is otherwise unreachable in a
 * unit test.
 *
 * Callers that also read worker-pool isolation flags must call
 * `__resetPoolForTests()` after this, because those flags are memoized
 * independently.
 */
export function __setCompiledBinaryForTests(value: boolean | undefined): void {
  compiledOverrideForTests = value;
}
