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

import { snapshotVeryfrontError } from "#veryfront/errors/types.ts";

const BUILD_FAILURE = Symbol.for("veryfront.module-loader.build-failure");
const TENANT_BUILD_FAILURE = Symbol.for("veryfront.module-loader.tenant-build-failure");

type TaggedError = Error & {
  [BUILD_FAILURE]?: true;
  [TENANT_BUILD_FAILURE]?: true;
};

const TENANT_BUILD_ERROR_SLUGS = new Set([
  "typescript-error",
  "mdx-compile-error",
  "markdown-compile-error",
  "ssg-generation-error",
  "compilation-error",
]);

function isExplicitTenantBuildFailure(error: Error): boolean {
  const snapshot = snapshotVeryfrontError(error);
  return snapshot?.category === "BUILD" && TENANT_BUILD_ERROR_SLUGS.has(snapshot.slug);
}

/** Tag `error` as a build failure and return it. */
export function markBuildFailure(error: unknown): unknown {
  if (error instanceof Error) {
    const tagged = error as TaggedError;
    tagged[BUILD_FAILURE] = true;
    if (isExplicitTenantBuildFailure(error)) tagged[TENANT_BUILD_FAILURE] = true;
  }
  return error;
}

/** True when `error` was raised while compiling or resolving project source. */
export function isBuildFailure(error: unknown): boolean {
  return error instanceof Error && (error as TaggedError)[BUILD_FAILURE] === true;
}

/** True only for a build failure explicitly classified as tenant source. */
export function isTenantBuildFailure(error: unknown): boolean {
  return error instanceof Error && (error as TaggedError)[TENANT_BUILD_FAILURE] === true;
}
