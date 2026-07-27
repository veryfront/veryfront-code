/***********************
 * Shared utility functions for cross-runtime testing.
 ***********************/

type KeyedCollection = Set<unknown> | Map<unknown, unknown>;
type TypedArray = Pick<Uint8Array | BigUint64Array, "length" | number>;

/**
 * Compare values with the same value semantics used by `@std/assert`.
 *
 * The third parameter is retained for source compatibility with the historical
 * helper. Pair-aware cycle tracking is owned by this comparison because a
 * one-sided `WeakSet` can accept unrelated graphs.
 */
export function deepEquals(a: unknown, b: unknown, seen: WeakSet<object> = new WeakSet()): boolean {
  void seen;
  return portableEqual(a, b);
}

/*!
 * The portable equality implementation is adapted from @std/assert 1.0.19:
 *
 * Copyright 2018-2026 the Deno authors.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in
 * all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * It is kept local because Bun cannot load JSR packages and maps the public
 * #std/assert alias back to this compatibility layer.
 */
function portableEqual(left: unknown, right: unknown): boolean {
  const compared = new Map<unknown, unknown>();

  function compare(a: unknown, b: unknown): boolean {
    if (sameValueZero(a, b)) return true;
    if (isPrimitive(a) || isPrimitive(b)) return false;

    if (a instanceof Date && b instanceof Date) {
      return Object.is(a.getTime(), b.getTime());
    }

    if (!a || typeof a !== "object" || !b || typeof b !== "object") {
      return false;
    }
    if (!prototypesEqual(a, b)) return false;

    if (a instanceof TypedArrayConstructor) {
      return compareTypedArrays(a as TypedArray, b as TypedArray);
    }
    if (a instanceof ArrayBuffer || isSharedArrayBuffer(a)) {
      return compareTypedArrays(
        new Uint8Array(a),
        new Uint8Array(b as ArrayBuffer | SharedArrayBuffer),
      );
    }
    if (a instanceof WeakMap || b instanceof WeakMap) {
      throw new TypeError("Cannot compare WeakMap instances");
    }
    if (a instanceof WeakSet || b instanceof WeakSet) {
      throw new TypeError("Cannot compare WeakSet instances");
    }
    if (typeof WeakRef !== "undefined" && a instanceof WeakRef && b instanceof WeakRef) {
      return compare(a.deref(), b.deref());
    }

    if (compared.get(a) === b) return true;
    if (Object.keys(a).length !== Object.keys(b).length) return false;
    compared.set(a, b);

    if (isKeyedCollection(a) && isKeyedCollection(b)) {
      return compareKeyedCollections(a, b, compare);
    }

    let keys: Iterable<string | symbol>;
    if (isBasicObjectOrArray(a)) {
      keys = ownKeys({ ...a, ...b });
    } else if (STRING_COMPARABLE_PROTOTYPES.has(Object.getPrototypeOf(a))) {
      return String(a) === String(b);
    } else {
      keys = unionKeys(getKeysDeep(a), getKeysDeep(b));
    }

    for (const key of keys) {
      const aRecord = a as Record<PropertyKey, unknown>;
      const bRecord = b as Record<PropertyKey, unknown>;
      if (!compare(aRecord[key], bRecord[key])) return false;
      if ((key in a) !== (key in b)) return false;
    }
    return true;
  }

  return compare(left, right);
}

function compareKeyedCollections(
  a: KeyedCollection,
  b: KeyedCollection,
  compare: (left: unknown, right: unknown) => boolean,
): boolean {
  if (a.size !== b.size) return false;

  const aKeys = [...a.keys()];
  if (aKeys.every(isPrimitive)) {
    if (a instanceof Set && b instanceof Set) {
      for (const value of a) {
        if (!b.has(value)) return false;
      }
      return true;
    }

    if (a instanceof Map && b instanceof Map) {
      for (const key of aKeys) {
        if (!b.has(key) || !compare(a.get(key), b.get(key))) return false;
      }
      return true;
    }
  }

  let unmatchedEntries = a.size;
  for (const [aKey, aValue] of a.entries()) {
    for (const [bKey, bValue] of b.entries()) {
      if (!compare(aKey, bKey)) continue;
      if ((aKey === aValue && bKey === bValue) || compare(aValue, bValue)) {
        unmatchedEntries--;
        break;
      }
    }
  }
  return unmatchedEntries === 0;
}

function prototypesEqual(a: object, b: object): boolean {
  const aPrototype = Object.getPrototypeOf(a);
  const bPrototype = Object.getPrototypeOf(b);
  return aPrototype === bPrototype ||
    (aPrototype === Object.prototype && bPrototype === null) ||
    (aPrototype === null && bPrototype === Object.prototype);
}

function isBasicObjectOrArray(value: object): boolean {
  const prototype = Object.getPrototypeOf(value);
  return prototype === null || prototype === Object.prototype || prototype === Array.prototype;
}

function ownKeys(value: object): Array<string | symbol> {
  return [
    ...Object.getOwnPropertyNames(value),
    ...Object.getOwnPropertySymbols(value),
  ];
}

function getKeysDeep(value: object): Set<string | symbol> {
  const keys = new Set<string | symbol>();
  let current: object | null = value;

  while (current !== Object.prototype && current !== Array.prototype && current !== null) {
    for (const key of ownKeys(current)) keys.add(key);
    current = Object.getPrototypeOf(current);
  }
  return keys;
}

function unionKeys(
  left: Set<string | symbol>,
  right: Set<string | symbol>,
): Set<string | symbol> {
  const result = new Set(left);
  for (const key of right) result.add(key);
  return result;
}

function isKeyedCollection(value: unknown): value is KeyedCollection {
  return value instanceof Set || value instanceof Map;
}

function isPrimitive(value: unknown): boolean {
  return value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint" ||
    typeof value === "symbol";
}

function sameValueZero(a: unknown, b: unknown): boolean {
  return a === b || Object.is(a, b);
}

const TypedArrayConstructor = Object.getPrototypeOf(Uint8Array);

function compareTypedArrays(a: TypedArray, b: TypedArray): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < b.length; index++) {
    if (!sameValueZero(a[index], b[index])) return false;
  }
  return true;
}

function isSharedArrayBuffer(value: object): value is SharedArrayBuffer {
  return typeof SharedArrayBuffer !== "undefined" && value instanceof SharedArrayBuffer;
}

// deno-lint-ignore no-explicit-any -- Temporal is not in every supported runtime's type library.
const temporal = (globalThis as any).Temporal ?? Object.create(null);
const STRING_COMPARABLE_PROTOTYPES = new Set<unknown>(
  [
    Intl.Locale,
    RegExp,
    temporal.Duration,
    temporal.Instant,
    temporal.PlainDate,
    temporal.PlainDateTime,
    temporal.PlainTime,
    temporal.PlainYearMonth,
    temporal.PlainMonthDay,
    temporal.ZonedDateTime,
    URL,
    URLSearchParams,
  ]
    .filter((constructor) => constructor != null)
    .map((constructor) => constructor.prototype),
);

/** Serialize unknown values safely for test output. */
export function safeStringify(value: unknown): string {
  try {
    const serialized = JSON.stringify(value);
    if (serialized !== undefined) return serialized;
  } catch (_) {
    /* expected: value may contain circular references or non-serializable types */
  }

  if (value === null) return "null";
  if (value === undefined) return "undefined";
  if (typeof value === "function") return "[Function]";
  if (typeof value === "object") {
    try {
      return `[${(value as object).constructor?.name ?? "Object"}]`;
    } catch {
      return "[Object]";
    }
  }
  return String(value);
}
