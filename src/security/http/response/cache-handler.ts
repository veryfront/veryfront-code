
import { CACHE_DURATIONS } from "./constants.ts";
import type { CacheStrategy } from "./types.ts";

export function buildCacheControl(strategy: CacheStrategy): string {
  let cacheControl: string;

  if (typeof strategy === "string") {
    switch (strategy) {
      case "no-cache":
        cacheControl = "no-cache, no-store, must-revalidate";
        break;
      case "no-store":
        cacheControl = "no-store";
        break;
      case "short":
        cacheControl = `public, max-age=${CACHE_DURATIONS.SHORT}`;
        break;
      case "medium":
        cacheControl = `public, max-age=${CACHE_DURATIONS.MEDIUM}`;
        break;
      case "long":
        cacheControl = `public, max-age=${CACHE_DURATIONS.LONG}`;
        break;
      case "immutable":
        cacheControl = `public, max-age=${CACHE_DURATIONS.LONG}, immutable`;
        break;
      case "none":
        cacheControl = "no-cache, no-store, must-revalidate";
        break;
      default:
        cacheControl = "public, max-age=0";
    }
  } else {
    const parts = [];
    parts.push(strategy.public !== false ? "public" : "private");
    parts.push(`max-age=${strategy.maxAge}`);
    if (strategy.immutable) parts.push("immutable");
    if (strategy.mustRevalidate) parts.push("must-revalidate");
    cacheControl = parts.join(", ");
  }

  return cacheControl;
}
