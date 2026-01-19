import { isRscExperimentalEnabled } from "@veryfront/config/env.ts";
import type { RuntimeEnv } from "@veryfront/config/runtime-env.ts";

/**
 * Checks if RSC is enabled via config or VERYFRONT_EXPERIMENTAL_RSC env.
 *
 * @param config - Optional config object with experimental.rsc flag
 * @param env - Optional RuntimeEnv for test isolation
 */
export function isRSCEnabled(
  config?: { experimental?: { rsc?: boolean } },
  env?: RuntimeEnv,
): boolean {
  return config?.experimental?.rsc ?? isRscExperimentalEnabled(env);
}
