import { getEnv } from "../../platform/compat/process.ts";

export function isRSCEnabled(config?: { experimental?: { rsc?: boolean } }): boolean {
  if (config?.experimental?.rsc !== undefined) {
    return config.experimental.rsc;
  }

  return getEnv("VERYFRONT_EXPERIMENTAL_RSC") === "1";
}
