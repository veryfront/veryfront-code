import type { VeryfrontAPIConfig } from "../../veryfront-api-client/types.ts";
import type { FileCacheOptions } from "../cache/types.ts";
import type { ContentSource, FSAdapterConfig } from "./types.ts";

export const DEFAULT_MAX_RETRIES = 3;
export const DEFAULT_INITIAL_RETRY_DELAY_MS = 1_000;
export const DEFAULT_MAX_RETRY_DELAY_MS = 10_000;
export const DEFAULT_CACHE_TTL_MS = 60_000;
export const DEFAULT_CACHE_MAX_ENTRIES = 1_000;
export const DEFAULT_CACHE_MAX_MEMORY_BYTES = 100 * 1024 * 1024;

type VeryfrontConfigOverrides = NonNullable<FSAdapterConfig["veryfront"]>;
type RetryOverrides = VeryfrontConfigOverrides["retry"];
type CacheOverrides = VeryfrontConfigOverrides["cache"];

export function buildRetryConfig(
  retry?: RetryOverrides,
): NonNullable<VeryfrontAPIConfig["retry"]> {
  return {
    maxRetries: DEFAULT_MAX_RETRIES,
    initialDelay: DEFAULT_INITIAL_RETRY_DELAY_MS,
    maxDelay: DEFAULT_MAX_RETRY_DELAY_MS,
    ...retry,
  };
}

export function buildFileCacheOptions(
  cache?: CacheOverrides,
): FileCacheOptions {
  return {
    enabled: true,
    ttl: DEFAULT_CACHE_TTL_MS,
    maxSize: DEFAULT_CACHE_MAX_ENTRIES,
    maxMemory: DEFAULT_CACHE_MAX_MEMORY_BYTES,
    ...cache,
  };
}

export function shouldBackgroundPregenerateStyles(
  contentContext: { sourceType: ContentSource["type"] } | null,
): boolean {
  return contentContext?.sourceType !== "branch";
}
