/**
 * Cache Handler
 * Handles cache control header generation
 */

import { CACHE_DURATIONS } from "./constants.ts";
import type { CacheStrategy } from "./types.ts";

const CACHE_PRESETS: Record<string, string> = {
  "no-cache": "no-cache, no-store, must-revalidate",
  "no-store": "no-store",
  "short": `public, max-age=${CACHE_DURATIONS.SHORT}`,
  "medium": `public, max-age=${CACHE_DURATIONS.MEDIUM}`,
  "long": `public, max-age=${CACHE_DURATIONS.LONG}`,
  "immutable": `public, max-age=${CACHE_DURATIONS.LONG}, immutable`,
  // "none" prevents all caching - used in development to avoid nonce mismatches
  "none": "no-cache, no-store, must-revalidate",
};

/**
 * Build cache control header value from strategy
 *
 * @param strategy - Cache strategy configuration
 * @returns Cache-Control header value
 */
export function buildCacheControl(strategy: CacheStrategy): string {
  if (typeof strategy === "string") {
    return CACHE_PRESETS[strategy] ?? "public, max-age=0";
  }

  const parts = [
    strategy.public !== false ? "public" : "private",
    `max-age=${strategy.maxAge}`,
  ];
  if (strategy.immutable) parts.push("immutable");
  if (strategy.mustRevalidate) parts.push("must-revalidate");
  return parts.join(", ");
}
