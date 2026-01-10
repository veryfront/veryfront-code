import { getEnv } from "../../platform/compat/process.ts";

/** Checks if RSC is enabled via config or VERYFRONT_EXPERIMENTAL_RSC env */
export function isRSCEnabled(config?: { experimental?: { rsc?: boolean } }): boolean {
  return config?.experimental?.rsc ?? getEnv("VERYFRONT_EXPERIMENTAL_RSC") === "1";
}
