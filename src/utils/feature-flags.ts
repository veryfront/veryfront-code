import { getEnv } from "#veryfront/platform/compat/process.ts";

/** Check whether RSC is enabled. */
export function isRSCEnabled(
  config?: { experimental?: { rsc?: boolean } },
): boolean {
  const rsc = config?.experimental?.rsc;
  if (rsc != null) return rsc;

  return getEnv("VERYFRONT_EXPERIMENTAL_RSC") === "1";
}
