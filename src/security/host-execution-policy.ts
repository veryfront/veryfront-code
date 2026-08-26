/**
 * Operator-owned host execution grant.
 *
 * A shared multi-project runtime denies tenant code execution by default and
 * fails closed with the typed `project-execution-unavailable` 503 response. An
 * operator can grant host execution to a shared runtime with
 * `VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION`; granting it is a deliberate
 * reduction in isolation, because tenant code then runs in the shared process
 * where per-request separation is source scoping and not a tenant boundary
 * (see security/README.md, "Shared execution grant"). Dedicated single-project
 * runtimes already carry the capability, so there the setting changes nothing
 * and is reported as ignored so startup can surface stale configuration.
 *
 * `getHostEnv` bypasses the project env overlay, so a project variable of the
 * same name cannot manufacture the grant.
 */

import { getHostEnv } from "#veryfront/platform/compat/process.ts";

export const HOST_PROJECT_EXECUTION_OVERRIDE_ENV = "VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION";

/**
 * Detect the operator grant. Only `1`, `true`, `yes`, and `on` (after trimming
 * and case folding) configure it; absent and unrecognized values are treated
 * as unconfigured and fail closed.
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

/** @deprecated Prefer isHostProjectExecutionOverrideConfigured. */
export const isHostProjectExecutionOverrideEnabled = isHostProjectExecutionOverrideConfigured;

/** Resolve the only two supported production execution topologies. */
export function resolveHostProjectExecutionPosture(options: {
  sharedRuntime: boolean;
  overrideConfigured: boolean;
}): { allowHostProjectCodeExecution: boolean; overrideIgnored: boolean } {
  return {
    // A dedicated runtime always carries the capability. A shared runtime carries it
    // only where an operator has granted it at the host-owned entrypoint.
    allowHostProjectCodeExecution: !options.sharedRuntime || options.overrideConfigured,
    // Configured but redundant: a dedicated runtime already had the capability, so the
    // grant did no work and startup can report it as stale operator configuration.
    overrideIgnored: options.overrideConfigured && !options.sharedRuntime,
  };
}
