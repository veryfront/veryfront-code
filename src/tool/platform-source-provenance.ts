import type { RemoteToolSource } from "./types.ts";
import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";

const adaptedPlatformSources = createPrivateWeakStore<object, true>();

const trustedPlatformSources = createPrivateWeakStore<object, true>();

/** Mark a host-created source backed by the authenticated Veryfront API catalog. */
export function markTrustedPlatformSource<T extends object>(source: T): T {
  trustedPlatformSources.set(source, true);
  return source;
}

/** Check platform ownership without trusting a remote source id or tool name. */
export function hasTrustedPlatformSource(source: unknown): boolean {
  return typeof source === "object" && source !== null &&
    trustedPlatformSources.get(source) === true;
}

/** Record that platform aliases were already established before policy filtering. */
export function markAdaptedPlatformSource<T extends object>(source: T): T {
  adaptedPlatformSources.set(source, true);
  return markTrustedPlatformSource(source);
}

export function hasAdaptedPlatformSource(source: object): boolean {
  return adaptedPlatformSources.get(source) === true;
}

/** Preserve platform ownership through host-created policy wrappers. */
export function inheritTrustedPlatformSource<T extends object>(
  source: RemoteToolSource,
  wrapper: T,
): T {
  if (hasAdaptedPlatformSource(source)) return markAdaptedPlatformSource(wrapper);
  return hasTrustedPlatformSource(source) ? markTrustedPlatformSource(wrapper) : wrapper;
}
