import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";

const trustedPlatformSources = createPrivateWeakStore<object, true>();

/** Mark a host-created source backed by the authenticated Veryfront API catalog. */
export function markTrustedPlatformSource<T extends object>(source: T): T {
  trustedPlatformSources.set(source, true);
  return source;
}

/** Check platform ownership without trusting a remote source id or tool name. */
export function hasTrustedPlatformSource(source: object): boolean {
  return trustedPlatformSources.get(source) === true;
}

/** Preserve platform ownership through host-created policy wrappers. */
export function inheritTrustedPlatformSource<T extends object>(source: object, wrapper: T): T {
  return hasTrustedPlatformSource(source) ? markTrustedPlatformSource(wrapper) : wrapper;
}
