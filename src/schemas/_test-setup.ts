/**
 * Test-only helper: registers the zod-backed SchemaValidator so unit tests
 * that exercise `defineSchema` work without going through full app
 * bootstrap (which is where ext-schema-zod normally registers itself).
 *
 * Import this file as a side effect at the top of any `*.test.ts` whose
 * runtime path resolves a SchemaValidator-backed schema.
 *
 * @module schemas/_test-setup
 */

import { register, tryResolve } from "#veryfront/extensions/contracts.ts";
import type { SchemaValidator } from "#veryfront/extensions/schema/index.ts";
import { getHostEnv, setEnv } from "#veryfront/platform/compat/process.ts";
import { createZodAdapter } from "../../extensions/ext-schema-zod/src/adapter.ts";

export function ensureTestSchemaValidator(): void {
  if (!tryResolve<SchemaValidator>("SchemaValidator")) {
    register<SchemaValidator>("SchemaValidator", createZodAdapter());
  }
}

/**
 * Place the test environment in a fully-ramped dependency-pinning cohort.
 *
 * In production an absent `VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT` means
 * zero percent, so that a typo can never widen the rollout and the flag already
 * set on production workloads stays inert until it is deliberately ramped. That
 * default is deliberately unforgiving, and roughly a hundred existing tests
 * enable `VERYFRONT_DEPENDENCY_PINNING` in order to assert pinning behavior
 * rather than rollout behavior. Defaulting them to a full cohort keeps those
 * tests asserting their actual subject.
 *
 * The production default itself is asserted directly, and is not weakened here:
 * see "should stay off when the flag is on but the rollout percent is absent"
 * in `src/transforms/esm/package-registry.test.ts`, and the parse tests in
 * `src/transforms/esm/dependency-pinning-cohort.test.ts`. Any test that needs
 * the real default simply sets the variable to "" itself.
 */
export function ensureTestDependencyPinningCohort(): void {
  if (getHostEnv("VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT") === undefined) {
    setEnv("VERYFRONT_DEPENDENCY_PINNING_ROLLOUT_PERCENT", "100");
  }
}

ensureTestSchemaValidator();
ensureTestDependencyPinningCohort();
