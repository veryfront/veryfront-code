export const VERYFRONT_FS_ADAPTER_KIND = Symbol.for(
  "veryfront.platform.fs.veryfront-adapter-kind.v1",
);

export type VeryfrontFSAdapterKind = "single-project" | "multi-project";

const MAX_PROTOTYPE_DEPTH = 16;
const IntrinsicSet = Set;
const ReflectApply = Reflect.apply;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const ReflectGetPrototypeOf = Reflect.getPrototypeOf;
const SetPrototypeAdd = Set.prototype.add;
const SetPrototypeHas = Set.prototype.has;

function setAdd<T>(set: Set<T>, value: T): void {
  ReflectApply(SetPrototypeAdd, set, [value]);
}

function setHas<T>(set: Set<T>, value: T): boolean {
  return ReflectApply(SetPrototypeHas, set, [value]) as boolean;
}

/**
 * Read the internal adapter brand without invoking accessors or depending on
 * constructor names, which are not stable across bundles and minifiers.
 */
export function getVeryfrontFSAdapterKind(value: unknown): VeryfrontFSAdapterKind | undefined {
  if (typeof value !== "object" || value === null) return undefined;

  const visited = new IntrinsicSet<object>();
  let current: object | null = value;
  try {
    for (
      let depth = 0;
      current !== null && depth < MAX_PROTOTYPE_DEPTH;
      depth++
    ) {
      if (setHas(visited, current)) return undefined;
      setAdd(visited, current);
      const descriptor = ReflectApply(ReflectGetOwnPropertyDescriptor, Reflect, [
        current,
        VERYFRONT_FS_ADAPTER_KIND,
      ]) as PropertyDescriptor | undefined;
      if (descriptor) {
        if (!("value" in descriptor)) return undefined;
        return descriptor.value === "single-project" || descriptor.value === "multi-project"
          ? descriptor.value
          : undefined;
      }
      current = ReflectApply(ReflectGetPrototypeOf, Reflect, [current]) as object | null;
    }
  } catch {
    return undefined;
  }
  return undefined;
}
