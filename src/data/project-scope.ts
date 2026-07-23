import { tryGetCacheKeyContext } from "#veryfront/cache/cache-key-builder.ts";
import { hashString } from "#veryfront/cache/hash.ts";
import type { DataContext } from "./types.ts";

/** Resolve a bounded, non-identifying scope for process-wide data registries. */
export function resolveDataProjectScope(context: DataContext): string {
  const cacheContext = tryGetCacheKeyContext();
  if (cacheContext) return hashString(`project\0${cacheContext.projectId}`);

  const hostname = context.url?.hostname;
  if (hostname) return hashString(`host\0${hostname}`);

  return hashString("local");
}
