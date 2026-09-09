import { defineOwnDataProperty } from "#veryfront/security/own-data-property.ts";

const MapConstructor = Map;
const apply = Reflect.apply;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const mapGet = Map.prototype.get;
const mapSet = Map.prototype.set;
const mapHas = Map.prototype.has;
const mapDelete = Map.prototype.delete;
const mapClear = Map.prototype.clear;
const mapForEach = Map.prototype.forEach;
const mapValues = Map.prototype.values;
const mapKeys = Map.prototype.keys;
const mapEntries = Map.prototype.entries;
const iteratorSymbol: typeof Symbol.iterator = Symbol.iterator;
const iteratorNext = Object.getPrototypeOf(new MapConstructor().values()).next;
const mapSize = Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!;

/** A private map with captured construction, operations, and iterator advancement. */
export function createPrivateMap<K, V>(): Map<K, V> {
  const map = new MapConstructor<K, V>();
  const iterate = <T>(method: (this: Map<K, V>) => IterableIterator<T>) => {
    const iterator = apply(method, map, []);
    return freeze({
      __proto__: null,
      next: () => apply(iteratorNext, iterator, []) as IteratorResult<T>,
      [iteratorSymbol]() {
        return this;
      },
    });
  };
  defineOwnDataProperty(map, "get", (key: K) => apply(mapGet, map, [key]) as V | undefined);
  defineOwnDataProperty(map, "set", (key: K, value: V) => {
    apply(mapSet, map, [key, value]);
    return map;
  });
  defineOwnDataProperty(map, "has", (key: K) => apply(mapHas, map, [key]) as boolean);
  defineOwnDataProperty(map, "delete", (key: K) => apply(mapDelete, map, [key]) as boolean);
  defineOwnDataProperty(map, "clear", () => {
    apply(mapClear, map, []);
  });
  defineOwnDataProperty(map, "values", () => iterate(mapValues));
  defineOwnDataProperty(map, "keys", () => iterate(mapKeys));
  defineOwnDataProperty(map, "entries", () => iterate(mapEntries));
  defineOwnDataProperty(map, iteratorSymbol, () => iterate(mapEntries));
  defineOwnDataProperty(
    map,
    "forEach",
    (callback: (value: V, key: K, map: Map<K, V>) => void, thisArg?: unknown) => {
      apply(mapForEach, map, [(value: V, key: K) => apply(callback, thisArg, [value, key, map])]);
    },
  );
  const sizeDescriptor = { __proto__: null, get: () => apply(mapSize, map, []) as number };
  defineProperty(map, "size", sizeDescriptor);
  return freeze(map);
}
