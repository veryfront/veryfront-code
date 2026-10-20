import { createPrivateWeakStore } from "#veryfront/security/private-weak-store.ts";

/** Internal cache readers are registered by concrete adapters, never request properties. */
export interface CachedSourceObservation {
  identity: string;
  version: number;
  fingerprint: { algorithm: "veryfront-source-snapshot-multiset-v1"; value: string };
  members: { path: string; sha256: string }[];
}
const readers = createPrivateWeakStore<
  object,
  () => Promise<CachedSourceObservation | undefined>
>();
export function registerCachedSourceObserver(
  adapter: object,
  read: () => Promise<CachedSourceObservation | undefined>,
): void {
  if (readers.get(adapter) === undefined) readers.set(adapter, read);
}
export function observeCachedSource(adapter: object): Promise<CachedSourceObservation | undefined> {
  return readers.get(adapter)?.() ?? Promise.resolve(undefined);
}

/** Capture an already registered concrete reader; later registrations cannot replace it. */
export function delegateCachedSourceObserver(wrapper: object, adapter: object): void {
  const reader = readers.get(adapter);
  if (reader) registerCachedSourceObserver(wrapper, reader);
}
