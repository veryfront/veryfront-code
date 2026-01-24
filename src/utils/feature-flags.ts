import { isRscExperimentalEnabled } from "#veryfront/config/env.ts";
import type { RuntimeEnv } from "#veryfront/config/runtime-env.ts";

export function isRSCEnabled(
  config?: { experimental?: { rsc?: boolean } },
  env?: RuntimeEnv,
): boolean {
  return config?.experimental?.rsc ?? isRscExperimentalEnabled(env);
}
