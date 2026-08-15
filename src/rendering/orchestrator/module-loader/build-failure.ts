/**
 * Build-failure tagging for module loads.
 *
 * A page module can fail for two very different reasons, and callers need to
 * tell them apart:
 *
 * - The source could not be compiled or resolved. That is a developer-facing
 *   build failure, and the message says how to fix it.
 * - The module compiled, ran, and threw at module scope (a missing environment
 *   variable, a rejected top-level `await`). That is an ordinary application
 *   error, and a project's own error page should present it.
 *
 * Only the loader is in a position to know which happened, so it tags the
 * error at the point of failure instead of leaving later layers to infer it.
 */

import { isTenantSourceBuildError } from "#veryfront/errors/tenant-classification.ts";

const ObjectDefineProperty = Object.defineProperty;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;

const BUILD_FAILURE = Symbol.for("veryfront.module-loader.build-failure");
const TENANT_BUILD_FAILURE = Symbol.for("veryfront.module-loader.tenant-build-failure");

/**
 * Modules are strict mode, so a plain assignment onto a frozen error throws.
 * These taggers run inside `catch` blocks, where a throw would replace the
 * original error with a `TypeError` and lose the failure entirely.
 */
function defineTag(error: Error, tag: symbol): void {
  try {
    ObjectDefineProperty(error, tag, { value: true, configurable: true });
  } catch {
    // Sealed or non-configurable: the error stays untagged, which degrades to
    // the pre-classification behavior rather than destroying the error.
  }
}

function hasOwnTrueTag(error: Error, tag: symbol): boolean {
  const descriptor = ReflectGetOwnPropertyDescriptor(error, tag);
  return descriptor !== undefined && !descriptor.get && !descriptor.set &&
    "value" in descriptor && descriptor.value === true;
}

/** Tag `error` as a build failure and return it. */
export function markBuildFailure(error: unknown): unknown {
  if (error instanceof Error) {
    defineTag(error, BUILD_FAILURE);
    if (isTenantSourceBuildError(error)) defineTag(error, TENANT_BUILD_FAILURE);
  }
  return error;
}

/**
 * Tag `error` as a build failure the tenant's own source caused, and return it.
 *
 * For seams that know the provenance from control flow rather than from a
 * registry slug — an import specifier that still does not resolve after a full
 * rebuild, for instance, is a path the project authored.
 */
export function markTenantBuildFailure(error: unknown): unknown {
  if (error instanceof Error) {
    defineTag(error, BUILD_FAILURE);
    defineTag(error, TENANT_BUILD_FAILURE);
  }
  return error;
}

/** True when `error` was raised while compiling or resolving project source. */
export function isBuildFailure(error: unknown): boolean {
  return error instanceof Error && hasOwnTrueTag(error, BUILD_FAILURE);
}

/** True only for a build failure explicitly classified as tenant source. */
export function isTenantBuildFailure(error: unknown): boolean {
  return error instanceof Error && hasOwnTrueTag(error, TENANT_BUILD_FAILURE);
}
