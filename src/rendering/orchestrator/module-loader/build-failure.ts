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

const BUILD_FAILURE = Symbol.for("veryfront.module-loader.build-failure");

type TaggedError = Error & { [BUILD_FAILURE]?: true };

/** Tag `error` as a build failure and return it. */
export function markBuildFailure(error: unknown): unknown {
  if (error instanceof Error) (error as TaggedError)[BUILD_FAILURE] = true;
  return error;
}

/** True when `error` was raised while compiling or resolving project source. */
export function isBuildFailure(error: unknown): boolean {
  return error instanceof Error && (error as TaggedError)[BUILD_FAILURE] === true;
}
