import { isRscExperimentalEnabled } from "#veryfront/config/env.ts";
import type { EnvironmentConfig } from "#veryfront/config/environment-config.ts";

export function isRSCEnabled(
  config?: { experimental?: { rsc?: boolean } },
  env?: EnvironmentConfig,
): boolean {
  const rsc = config?.experimental?.rsc;
  if (rsc != null) return rsc;

  return isRscExperimentalEnabled(env);
}
