/**
 * Deprecated operator-owned host execution override.
 *
 * A shared multi-project runtime denies tenant code execution by default, and
 * routes the request to a dedicated isolated project runtime instead. Dedicated
 * single-project runtimes already carry the host execution capability. The
 * former override therefore grants no additional topology and is retained only
 * so startup can identify and report stale operator configuration.
 *
 * `getHostEnv` bypasses the project env overlay, so a project variable of the
 * same name cannot manufacture the diagnostic.
 */

import { getHostEnv } from "#veryfront/platform/compat/process.ts";

export const HOST_PROJECT_EXECUTION_OVERRIDE_ENV = "VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION";

/**
 * Detect the deprecated operator override. Absent and unrecognized values are
 * treated as unconfigured.
 */
export function isHostProjectExecutionOverrideConfigured(
  value: string | undefined = getHostEnv(HOST_PROJECT_EXECUTION_OVERRIDE_ENV),
): boolean {
  if (value === undefined) return false;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      return false;
  }
}

/** @deprecated The override no longer enables host execution. */
export const isHostProjectExecutionOverrideEnabled = isHostProjectExecutionOverrideConfigured;

/** Resolve the only two supported production execution topologies. */
export function resolveHostProjectExecutionPosture(options: {
  sharedRuntime: boolean;
  overrideConfigured: boolean;
}): { allowHostProjectCodeExecution: boolean; overrideIgnored: boolean } {
  return {
    allowHostProjectCodeExecution: !options.sharedRuntime,
    overrideIgnored: options.overrideConfigured,
  };
}
