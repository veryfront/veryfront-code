import { getEnv } from "#veryfront/platform/compat/process.ts";
import { serverLogger } from "../../logger/logger.ts";
import type { GlobalWithVeryFrontCache } from "#veryfront/types/global-guards.ts";

const logger = serverLogger.component("cache");

const globalCache = globalThis as GlobalWithVeryFrontCache;

let cacheNamespace: string | undefined = globalCache.__VF_CACHE_NAMESPACE__ ??
  getEnv("VF_CACHE_NAMESPACE");

export function setCacheNamespace(namespace?: string): void {
  cacheNamespace = namespace ?? undefined;

  try {
    globalCache.__VF_CACHE_NAMESPACE__ = cacheNamespace;
  } catch (e) {
    logger.debug("setCacheNamespace failed", e);
  }
}

export function getCacheNamespace(): string | undefined {
  return cacheNamespace;
}
