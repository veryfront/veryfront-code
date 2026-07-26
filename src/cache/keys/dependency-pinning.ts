import { base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";

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
    ? `${dependencyPinningCacheKey}:origin:${
      base64urlEncodeBytes(new TextEncoder().encode(moduleServerOrigin))
    }`
    : dependencyPinningCacheKey;
}
