/**
 * Single owner for the "is this build failure the tenant's fault?" question.
 *
 * Two layers need the answer and cannot import each other: the module loader
 * (which tags errors at their capture seam) and observability (which must not
 * depend on the rendering layer). They exchange the verdict through a shared
 * symbol, but the verdict itself is computed here so a new tenant-facing slug
 * only has to be added once. Duplicating the slug set drifts silently — the
 * same error would classify differently depending on which seam saw it first.
 */

import { snapshotVeryfrontError } from "./types.ts";

const ObjectPrototypeHasOwnProperty = Object.prototype.hasOwnProperty;
const ReflectApply = Reflect.apply;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const SetPrototypeHas = Set.prototype.has;

/**
 * BUILD registry slugs that describe tenant source failing to compile, as
 * opposed to framework cache/bundle/asset infrastructure failing in the same
 * phase.
 */
const TENANT_BUILD_ERROR_SLUGS = new Set([
  "typescript-error",
  "mdx-compile-error",
  "markdown-compile-error",
]);

function hasOwnTrueDataProperty(value: object, key: PropertyKey): boolean {
  try {
    const descriptor = ReflectGetOwnPropertyDescriptor(value, key);
    return descriptor !== undefined &&
      ReflectApply(ObjectPrototypeHasOwnProperty, descriptor, ["value"]) === true &&
      descriptor.value === true;
  } catch {
    return false;
  }
}

/**
 * Whether `error` describes tenant source or content failing to build (a page
 * that does not compile, MDX that does not parse) rather than a framework
 * fault.
 *
 * Recognizes two discriminators, both written at the seam that knows:
 * - an explicit `tenantBuildFailure: true` error context, set by a compiler
 *   stage that inspected the diagnostic, and
 * - a tenant-facing BUILD registry slug.
 *
 * The module loader's symbol tag is deliberately *not* read here: it is set
 * from this predicate, so reading it back would be circular.
 */
export function isTenantSourceBuildError(error: unknown): boolean {
  const snapshot = snapshotVeryfrontError(error);
  if (!snapshot) return false;
  const errorContext = snapshot.context;
  if (
    typeof errorContext === "object" && errorContext !== null &&
    hasOwnTrueDataProperty(errorContext, "tenantBuildFailure")
  ) {
    return true;
  }
  return snapshot.category === "BUILD" &&
    ReflectApply(SetPrototypeHas, TENANT_BUILD_ERROR_SLUGS, [snapshot.slug]) === true;
}
