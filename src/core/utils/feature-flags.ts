declare const process: { env: Record<string, string | undefined> } | undefined;

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
  if (typeof Deno !== "undefined" && Deno.env) {
    return Deno.env.get("VERYFRONT_EXPERIMENTAL_RSC") === "1";
  }
  if (typeof process !== "undefined" && process?.env) {
    return process.env.VERYFRONT_EXPERIMENTAL_RSC === "1";
  }

  // 3. Default to false
  return false;
}
