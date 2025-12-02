declare const process: { env: Record<string, string | undefined> } | undefined;
import { getEnv } from "../../platform/compat/process.ts";

/**
 * Checks if React Server Components (RSC) are enabled.
 *
 * Priority order:
 * 1. Config file (config.experimental.rsc)
 * 2. Environment variables (VERYFRONT_EXPERIMENTAL_RSC=1)
 * 3. Default (false)
 *
 * @param config - Optional config object to check first
 * @returns true if RSC is enabled, false otherwise
 */
export function isRSCEnabled(config?: { experimental?: { rsc?: boolean } }): boolean {
  // 1. Check config first (highest priority)
  if (config?.experimental?.rsc !== undefined) {
    return config.experimental.rsc;
  }

  // 2. Fallback to environment variables (backward compatibility)
  return getEnv("VERYFRONT_EXPERIMENTAL_RSC") === "1";
}
