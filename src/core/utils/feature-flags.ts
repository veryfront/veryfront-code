import { isRscExperimentalEnabled } from "@veryfront/core/config/env.ts";

/** Checks if RSC is enabled via config or VERYFRONT_EXPERIMENTAL_RSC env */
export function isRSCEnabled(config?: { experimental?: { rsc?: boolean } }): boolean {
  return config?.experimental?.rsc ?? isRscExperimentalEnabled();
}
