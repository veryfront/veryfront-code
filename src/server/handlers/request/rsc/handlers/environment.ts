import { isLocalDev } from "#veryfront/server/context/request-context.ts";

/**
 * Check if running in production mode (not local development)
 * Used for RSC optimization and error handling behavior.
 */
export function isProductionMode(): boolean {
  return !isLocalDev();
}
