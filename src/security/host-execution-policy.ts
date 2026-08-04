/**
 * Operator-owned host execution posture.
 *
 * A shared multi-project runtime denies tenant code execution by default, and
 * routes the request to a dedicated isolated project runtime instead. Some
 * deployments intend the shared runtime to *be* the executor. Those operators
 * grant the capability explicitly through this override at the host-owned
 * entrypoint, where it is logged at startup.
 *
 * The override does not weaken any other boundary. Worker permissions, outbound
 * egress policy, and credential binding are unaffected; it only supplies the
 * `allowHostProjectCodeExecution` capability that every execution surface
 * already consults.
 *
 * Read this once at startup rather than per request. `getHostEnv` already
 * bypasses the project env overlay, so a project variable of the same name
 * cannot grant execution; reading once keeps the deployment's posture fixed
 * for the process lifetime and visible in one place.
 */

import { getHostEnv } from "#veryfront/platform/compat/process.ts";

export const HOST_PROJECT_EXECUTION_OVERRIDE_ENV = "VERYFRONT_HOST_ALLOW_PROJECT_EXECUTION";

/**
 * Read the operator override. Absent and unrecognized values fail closed, which
 * matches `isInternalEgressOverrideEnabled` for
 * `VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS`.
 */
export function isHostProjectExecutionOverrideEnabled(
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
