import type { FileSystemAdapter } from "./base.ts";

const IntrinsicWeakSet = WeakSet;
const ReflectApply = Reflect.apply;
const WeakSetPrototypeAdd = IntrinsicWeakSet.prototype.add;
const WeakSetPrototypeHas = IntrinsicWeakSet.prototype.has;

// Exact-object provenance only. Wrappers and proxies must not inherit this
// classification because they may translate paths into a non-native namespace.
const nativeFileSystemAdapters = new IntrinsicWeakSet<FileSystemAdapter>();

/** Register a directly constructed built-in adapter backed by the host filesystem. */
export function markNativeFileSystemAdapter(adapter: FileSystemAdapter): void {
  ReflectApply(WeakSetPrototypeAdd, nativeFileSystemAdapters, [adapter]);
}

/** Return true only for the exact built-in adapter object registered at construction. */
export function isNativeFileSystemAdapter(
  adapter: FileSystemAdapter,
): boolean {
  return ReflectApply(
    WeakSetPrototypeHas,
    nativeFileSystemAdapters,
    [adapter],
  ) as boolean;
}
