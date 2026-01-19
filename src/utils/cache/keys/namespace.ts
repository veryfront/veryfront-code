import { serverLogger as logger } from "../../logger/logger.ts";
import { getEnvironmentVariable } from "../../logger/env.ts";
import type { GlobalWithVeryFrontCache } from "#veryfront/types/global-guards.ts";

let cacheNamespace: string | undefined =
  (globalThis as GlobalWithVeryFrontCache).__VF_CACHE_NAMESPACE__ ||
  getEnvironmentVariable("VF_CACHE_NAMESPACE");

export function setCacheNamespace(namespace?: string): void {
  cacheNamespace = namespace || undefined;
  try {
    (globalThis as GlobalWithVeryFrontCache).__VF_CACHE_NAMESPACE__ = cacheNamespace;
  } catch (e) {
    logger.debug("[cache] setCacheNamespace failed", e);
  }
}

export function getCacheNamespace(): string | undefined {
  return cacheNamespace;
}
