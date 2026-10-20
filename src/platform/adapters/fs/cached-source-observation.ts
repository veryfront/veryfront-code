import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";

/** Internal cache readers are registered by concrete adapters, never request properties. */
export interface CachedSourceObservation {
  identity: string;
  version: number;
  fingerprint: { algorithm: "veryfront-source-snapshot-multiset-v1"; value: string };
  members: { path: string; sha256: string }[];
}
/** Only reference identity is consumed; filesystem members are never inspected here. */
type CachedSourceOwner = object;

const readers = createPrivateWeakStore<
  CachedSourceOwner,
  () => Promise<CachedSourceObservation | undefined>
>();
export function registerCachedSourceObserver(
  adapter: CachedSourceOwner,
  read: () => Promise<CachedSourceObservation | undefined>,
): void {
  if (readers.get(adapter) === undefined) readers.set(adapter, read);
}
export function observeCachedSource(
  adapter: CachedSourceOwner,
): Promise<CachedSourceObservation | undefined> {
  return readers.get(adapter)?.() ?? Promise.resolve(undefined);
}

/** Capture an already registered concrete reader; later registrations cannot replace it. */
export function delegateCachedSourceObserver(
  wrapper: CachedSourceOwner,
  adapter: CachedSourceOwner,
): void {
  const reader = readers.get(adapter);
  if (reader) registerCachedSourceObserver(wrapper, reader);
}
