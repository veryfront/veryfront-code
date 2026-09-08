const SetConstructor = Set;
const apply = Reflect.apply;
const defineProperties = Object.defineProperties;
const freeze = Object.freeze;
const isArray = Array.isArray;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const setDelete = Set.prototype.delete;
const setValues = Set.prototype.values;
const iteratorSymbol: typeof Symbol.iterator = Symbol.iterator;
const iteratorNext = Object.getPrototypeOf(new SetConstructor().values()).next;
const setSize = Object.getOwnPropertyDescriptor(Set.prototype, "size")!.get!;

/** Internal selector set whose used operations do not consult mutable prototypes. */
export function createPrivateSet<T>(values?: Iterable<T>): Set<T> {
  const set = new SetConstructor<T>();
  const add = (value: T) => {
    apply(setAdd, set, [value]);
    return set;
  };
  const iterate = (): IterableIterator<T> => {
    const iterator = apply(setValues, set, []);
    return freeze({
      next: () => apply(iteratorNext, iterator, []) as IteratorResult<T>,
      [iteratorSymbol]() {
        return this;
      },
    });
  };
  defineProperties(set, {
    add: { value: add },
    has: { value: (value: T) => apply(setHas, set, [value]) as boolean },
    delete: { value: (value: T) => apply(setDelete, set, [value]) as boolean },
    size: { get: () => apply(setSize, set, []) as number },
    values: { value: iterate },
    keys: { value: iterate },
    [iteratorSymbol]: { value: iterate },
  });
  if (isArray(values)) {
    for (let index = 0; index < values.length; index++) add(values[index]);
  } else if (values) {
    for (const value of values) add(value);
  }
  return freeze(set);
}
