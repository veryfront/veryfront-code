/**
 * Environment variable utilities
 *
 * Centralized utilities for checking environment flags.
 * This ensures consistent behavior across the entire codebase.
 */

/**
 * Environment variable names used by Veryfront
 */
export const ENV_VARS = {
  DEBUG: "VERYFRONT_DEBUG",
  DEEP_INSPECT: "VERYFRONT_DEEP_INSPECT",
  CACHE_DIR: "VERYFRONT_CACHE_DIR",
  PORT: "VERYFRONT_PORT",
  VERSION: "VERYFRONT_VERSION",
} as const;

/**
 * Check if a debug environment variable value is truthy.
 * Accepts: "1", "true", "yes" (case-insensitive)
 *
 * @param value - The environment variable value to check
 * @returns true if the value indicates debug mode should be enabled
 */
export function isTruthyEnvValue(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.toLowerCase().trim();
  return normalized === "1" || normalized === "true" || normalized === "yes";
}

/**
 * Check if debug mode is enabled via environment variable.
 * Works with RuntimeAdapter's env interface.
 *
 * @param env - Environment accessor object with get() method
 * @returns true if VERYFRONT_DEBUG is set to a truthy value
 */
export function isDebugEnabled(env: { get(key: string): string | undefined }): boolean {
  return isTruthyEnvValue(env.get(ENV_VARS.DEBUG));
}

/**
 * Check if deep inspect mode is enabled via environment variable.
 *
 * @param env - Environment accessor object with get() method
 * @returns true if VERYFRONT_DEEP_INSPECT is set to a truthy value
 */
export function isDeepInspectEnabled(env: { get(key: string): string | undefined }): boolean {
  return isTruthyEnvValue(env.get(ENV_VARS.DEEP_INSPECT));
}

/**
 * Check if either debug or deep inspect mode is enabled.
 *
 * @param env - Environment accessor object with get() method
 * @returns true if either debug flag is enabled
 */
export function isAnyDebugEnabled(env: { get(key: string): string | undefined }): boolean {
  return isDebugEnabled(env) || isDeepInspectEnabled(env);
}
