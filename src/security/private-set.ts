import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";

const SetConstructor = Set;
const apply = Reflect.apply;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const isArray = Array.isArray;
const hasOwn = Object.hasOwn;
const setAdd = Set.prototype.add;
const setHas = Set.prototype.has;
const setDelete = Set.prototype.delete;
const setClear = Set.prototype.clear;
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
    const facade = {
      __proto__: null,
      next: () => apply(iteratorNext, iterator, []) as IteratorResult<T>,
      [iteratorSymbol]() {
        return this;
      },
    };
    return freeze(facade);
  };
  defineOwnDataProperty(set, "add", add);
  defineOwnDataProperty(set, "has", (value: T) => apply(setHas, set, [value]) as boolean);
  defineOwnDataProperty(set, "delete", (value: T) => apply(setDelete, set, [value]) as boolean);
  defineOwnDataProperty(set, "clear", () => {
    apply(setClear, set, []);
  });
  defineOwnDataProperty(set, "values", iterate);
  defineOwnDataProperty(set, "keys", iterate);
  defineOwnDataProperty(set, iteratorSymbol, iterate);
  const sizeDescriptor = { __proto__: null, get: () => apply(setSize, set, []) as number };
  defineProperty(set, "size", sizeDescriptor);
  if (isArray(values)) {
    for (let index = 0; index < values.length; index++) {
      if (hasOwn(values, index)) add(values[index]);
    }
  } else if (values) {
    for (const value of values) add(value);
  }
  return freeze(set);
}
