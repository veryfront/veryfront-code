import { base64urlEncodeBytes } from "#veryfront/utils/base64url.ts";
import { hashString } from "../hash.ts";
import { isCacheKeyPassThroughSafe } from "./api-policy.ts";

const MAX_INLINE_ORIGIN_IDENTITY_LENGTH = 192;
const UINT64_BASE36_MAX = "3w5e11264sgsf";
const PIN_HASH_RE = /^on:(0|[1-9a-z][0-9a-z]{0,12})$/;
const TERMINAL_THEME_RE = /:theme-(light|dark)$/;

export interface RenderCacheKeyComposition {
  /** Prefix added by the distributed backend. Defaults to the API render namespace. */
  readonly backendPrefix?: string;
  /** Tenant/source prefix added by the render cache coordinator. */
  readonly cachePrefix?: string;
  /** Whether the coordinator prepends `page:` to non-page overrides. */
  readonly addPagePrefix?: boolean;
  /** Theme suffix added by the context-aware render cache coordinator. */
  readonly colorScheme?: "light" | "dark";
}

export function isCanonicalDependencyPinningCacheKey(cacheKey: string): boolean {
  if (cacheKey === "on:unknown" || cacheKey === "on:no-project") {
    return false;
  }
  const hash = PIN_HASH_RE.exec(cacheKey)?.[1];
  if (!hash) return false;

  // hashString() emits an unsigned 64-bit integer in lowercase base36.
  // Equal-length base36 values sort lexicographically with this alphabet.
  return hash.length < UINT64_BASE36_MAX.length || hash <= UINT64_BASE36_MAX;
}

function encodeOrigin(origin: string): string {
  const encoded = base64urlEncodeBytes(new TextEncoder().encode(origin));
  if (encoded.length <= MAX_INLINE_ORIGIN_IDENTITY_LENGTH) return encoded;

  // Two domain-separated 64-bit hashes keep the synchronous cache-key builders
  // bounded for pathological origins without returning to the collision-prone
  // 32-bit digest used here previously. Normal origins remain losslessly encoded,
  // and neither hash half is truncated.
  return `hash-${hashString(`dependency-origin:a:${origin}`)}-${
    hashString(`dependency-origin:b:${origin}`)
  }`;
}

function isApiSafeCacheKey(cacheKey: string): boolean {
  return isCacheKeyPassThroughSafe(cacheKey);
}

function composeCompleteRenderCacheKey(
  renderCacheKey: string,
  composition: RenderCacheKeyComposition,
): string {
  const backendPrefix = composition.backendPrefix === undefined
    ? "render"
    : composition.backendPrefix;
  const prefix = [
    backendPrefix,
    composition.cachePrefix,
    composition.addPagePrefix && !renderCacheKey.startsWith("page:") ? "page" : undefined,
  ].filter((part): part is string => Boolean(part)).join(":");
  const suffix = composition.colorScheme && !TERMINAL_THEME_RE.test(renderCacheKey)
    ? `:theme-${composition.colorScheme}`
    : "";
  return `${prefix ? `${prefix}:` : ""}${renderCacheKey}${suffix}`;
}

function addDependencyPinningVariant(renderCacheKey: string, cacheVariant: string): string {
  const terminalTheme = TERMINAL_THEME_RE.exec(renderCacheKey)?.[0];
  if (!terminalTheme) return `${renderCacheKey}:pins:${cacheVariant}`;

  return `${renderCacheKey.slice(0, -terminalTheme.length)}:pins:${cacheVariant}${terminalTheme}`;
}

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
  if (
    !dependencyPinningCacheKey ||
    !isCanonicalDependencyPinningCacheKey(dependencyPinningCacheKey)
  ) return undefined;

  const variant = moduleServerOrigin
    ? `${dependencyPinningCacheKey}:origin:${encodeOrigin(moduleServerOrigin)}`
    : dependencyPinningCacheKey;
  return isApiSafeCacheKey(variant) ? variant : undefined;
}

/**
 * Add dependency identity to a render cache override while respecting the
 * complete distributed API key, including prefixes added after this function.
 *
 * Flag-off and invalid snapshot inputs return the legacy override unchanged.
 * Oversized pin-on identities collapse to two domain-separated 64-bit hashes,
 * preserving a deterministic 128-bit identity without truncating either half.
 */
export function buildDependencyPinnedRenderCacheKey(
  legacyRenderCacheKey: string,
  dependencyPinningCacheKey?: string,
  moduleServerOrigin?: string,
  composition: RenderCacheKeyComposition = {},
): string {
  const cacheVariant = buildDependencyPinningCacheVariant(
    dependencyPinningCacheKey,
    moduleServerOrigin,
  );
  if (!cacheVariant) return legacyRenderCacheKey;

  const readableKey = addDependencyPinningVariant(legacyRenderCacheKey, cacheVariant);
  if (isApiSafeCacheKey(composeCompleteRenderCacheKey(readableKey, composition))) {
    return readableKey;
  }

  const identity =
    `${legacyRenderCacheKey.length}:${legacyRenderCacheKey}:${cacheVariant.length}:${cacheVariant}`;
  const structuralPrefix = legacyRenderCacheKey.startsWith("page:") ? "page:" : "";
  const terminalTheme = TERMINAL_THEME_RE.exec(legacyRenderCacheKey)?.[0] ?? "";
  const hashedKey = `${structuralPrefix}pins:hash-${
    hashString(`dependency-render-cache:a:${identity}`)
  }-${hashString(`dependency-render-cache:b:${identity}`)}${terminalTheme}`;
  if (isApiSafeCacheKey(composeCompleteRenderCacheKey(hashedKey, composition))) {
    return hashedKey;
  }

  // The outer prefix is caller-owned and may target a backend without the API
  // key restrictions (memory, disk, or Redis). Keep rendering best-effort and
  // preserve pin isolation there; the API backend already handles rejected
  // cache operations as misses.
  return hashedKey;
}
