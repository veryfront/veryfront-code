import type { FileSystemAdapter } from "./base.ts";

const IntrinsicWeakSet = WeakSet;
const ReflectApply = Reflect.apply;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const WeakSetPrototypeAdd = IntrinsicWeakSet.prototype.add;
const WeakSetPrototypeHas = IntrinsicWeakSet.prototype.has;

// Exact-object provenance only. Wrappers and proxies must not inherit this
// classification because they may translate paths into a non-native namespace.
const nativeFileSystemAdapters = new IntrinsicWeakSet<FileSystemAdapter>();

/**
 * Whether `instance` was constructed directly as `constructorRef` rather than as
 * a subclass of it.
 *
 * `new.target === constructorRef` is the natural spelling and cannot be used
 * here: DNT rewrites every meta-property into its `import.meta` ponyfill when it
 * emits the npm package, so in the published build `new.target` is an
 * `ImportMeta`, the comparison is unconditionally false, and no adapter is ever
 * registered (see `scripts/build/dnt-meta-property-safety.ts`).
 *
 * `this.constructor === constructorRef` survives that transform but is
 * forgeable: a subclass that deletes or overwrites its own
 * `prototype.constructor` inherits the base's, so a subclass instance would be
 * classified as a directly constructed built-in.
 *
 * Prototype identity survives the transform and is not forgeable that way. A
 * class's `prototype` is a non-writable, non-configurable own property, and
 * `[[Construct]]` takes the new object's prototype from `new.target.prototype`,
 * so `new Subclass()` always arrives here carrying `Subclass.prototype`.
 */
export function isDirectConstruction(
  instance: object,
  constructorRef: { readonly prototype: object },
): boolean {
  return ReflectApply(ObjectGetPrototypeOf, undefined, [instance]) ===
    constructorRef.prototype;
}

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
