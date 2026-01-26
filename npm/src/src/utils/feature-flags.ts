import { isRscExperimentalEnabled } from "../config/env.js";
import type { RuntimeEnv } from "../config/runtime-env.js";

export function isRSCEnabled(
  config?: { experimental?: { rsc?: boolean } },
  env?: RuntimeEnv,
): boolean {
  return config?.experimental?.rsc ?? isRscExperimentalEnabled(env);
}
