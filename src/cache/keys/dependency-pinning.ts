import { hashCodeHex } from "#veryfront/utils/hash-utils.ts";

/**
 * Return the cache-key suffix for an enabled dependency snapshot.
 *
 * Flag-off and unset callers deliberately receive no suffix so their cache
 * identities remain byte-for-byte compatible with the pre-pinning format.
 */
export function buildDependencyPinningCacheVariant(
  dependencyPinningCacheKey?: string,
  moduleServerOrigin?: string,
): string | undefined {
  if (!dependencyPinningCacheKey?.startsWith("on:")) return undefined;

  return moduleServerOrigin
    ? `${dependencyPinningCacheKey}:origin:${hashCodeHex(moduleServerOrigin)}`
    : dependencyPinningCacheKey;
}
