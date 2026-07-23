import { CACHE_DURATIONS } from "./constants.ts";
import type { CacheStrategy } from "./types.ts";

const CACHE_PRESETS: Record<string, string> = {
  "no-cache": "no-cache, no-store, must-revalidate",
  "no-store": "no-store",
  short: `public, max-age=${CACHE_DURATIONS.SHORT}`,
  medium: `public, max-age=${CACHE_DURATIONS.MEDIUM}`,
  long: `public, max-age=${CACHE_DURATIONS.LONG}`,
  immutable: `public, max-age=${CACHE_DURATIONS.LONG}, immutable`,
  // "none" prevents all caching - used in development to avoid nonce mismatches
  none: "no-cache, no-store, must-revalidate",
};

export function buildCacheControl(strategy: CacheStrategy): string {
  if (typeof strategy === "string") {
    const preset = CACHE_PRESETS[strategy];
    if (!preset) throw new TypeError(`Unknown cache strategy: ${strategy}`);
    return preset;
  }

  assertCacheDuration("maxAge", strategy.maxAge);
  if (strategy.staleWhileRevalidate !== undefined) {
    assertCacheDuration("staleWhileRevalidate", strategy.staleWhileRevalidate);
  }

  const parts: string[] = [
    strategy.public !== false ? "public" : "private",
    `max-age=${strategy.maxAge}`,
  ];

  if (strategy.immutable) {
    parts.push("immutable");
  }

  if (strategy.mustRevalidate) {
    parts.push("must-revalidate");
  }

  if (typeof strategy.staleWhileRevalidate === "number") {
    parts.push(`stale-while-revalidate=${strategy.staleWhileRevalidate}`);
  }

  return parts.join(", ");
}

function assertCacheDuration(name: string, value: number): void {
  if (Number.isSafeInteger(value) && value >= 0) return;
  throw new TypeError(`${name} must be a non-negative safe integer`);
}
