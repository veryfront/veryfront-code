/***********************
 * Shared utility functions for cross-runtime testing.
 ***********************/

const MAX_DEEP_EQUALITY_COMPARISONS = 100_000;
const MAX_DEEP_EQUALITY_DEPTH = 512;
const MAX_SERIALIZED_VALUES = 10_000;
const MAX_SERIALIZATION_DEPTH = 512;
const MAX_STRINGIFIED_OUTPUT_LENGTH = 16_384;
const BOXED_PRIMITIVE_PROTOTYPES = new Set<object>([
  Boolean.prototype,
  Number.prototype,
  String.prototype,
  BigInt.prototype,
  Symbol.prototype,
]);
const MAP_SIZE_GETTER = Object.getOwnPropertyDescriptor(Map.prototype, "size")?.get;
const SET_SIZE_GETTER = Object.getOwnPropertyDescriptor(Set.prototype, "size")?.get;
const REGEXP_SOURCE_GETTER = Object.getOwnPropertyDescriptor(RegExp.prototype, "source")?.get;
const REGEXP_FLAGS = [
  ["hasIndices", "d"],
  ["global", "g"],
  ["ignoreCase", "i"],
  ["multiline", "m"],
  ["dotAll", "s"],
  ["unicode", "u"],
  ["unicodeSets", "v"],
  ["sticky", "y"],
] as const;
const TYPED_ARRAY_PROTOTYPE = Object.getPrototypeOf(Uint8Array.prototype) as object;

class UnsupportedWeakCollectionError extends TypeError {}
class DeepEqualityLimitError extends RangeError {}
class SerializationLimitError extends RangeError {}

type ComparisonState = {
  budget: { comparisons: number };
  depth: number;
  leftToRight: Map<object, object>;
  rightToLeft: Map<object, object>;
};

function sameValueZero(a: unknown, b: unknown): boolean {
  return a === b || Object.is(a, b);
}

function isObject(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function enumerableOwnKeys(value: object): PropertyKey[] {
  return Reflect.ownKeys(value).filter((key) =>
    Object.getOwnPropertyDescriptor(value, key)?.enumerable === true
  );
}

function findPropertyDescriptor(
  value: object,
  property: PropertyKey,
): PropertyDescriptor | undefined {
  const seen = new Set<object>();
  let current: object | null = value;
  while (current && !seen.has(current)) {
    seen.add(current);
    const descriptor = Object.getOwnPropertyDescriptor(current, property);
    if (descriptor) return descriptor;
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

function comparePropertyDescriptors(
  aDescriptor: PropertyDescriptor | undefined,
  bDescriptor: PropertyDescriptor | undefined,
  state: ComparisonState,
  compare: (a: unknown, b: unknown, state: ComparisonState) => boolean,
): boolean {
  if (!aDescriptor || !bDescriptor) return aDescriptor === bDescriptor;
  const aIsData = "value" in aDescriptor;
  const bIsData = "value" in bDescriptor;
  if (aIsData !== bIsData) return false;
  if (aIsData && bIsData) return compare(aDescriptor.value, bDescriptor.value, state);
  return aDescriptor.get === bDescriptor.get && aDescriptor.set === bDescriptor.set;
}

function getSerializableProperty(
  value: object,
  property: PropertyKey,
  fallback: unknown,
): unknown {
  const descriptor = findPropertyDescriptor(value, property);
  if (!descriptor) return fallback;
  return "value" in descriptor ? descriptor.value : "[Accessor]";
}

function prototypesEqual(a: object, b: object): boolean {
  const aPrototype = Object.getPrototypeOf(a);
  const bPrototype = Object.getPrototypeOf(b);
  return aPrototype === bPrototype ||
    (aPrototype === Object.prototype && bPrototype === null) ||
    (aPrototype === null && bPrototype === Object.prototype);
}

function compareTypedArrays(a: ArrayBufferView, b: ArrayBufferView): boolean {
  const getBytes = (value: ArrayBufferView): Uint8Array => {
    const prototype = value instanceof DataView ? DataView.prototype : TYPED_ARRAY_PROTOTYPE;
    const bufferGetter = Object.getOwnPropertyDescriptor(prototype, "buffer")?.get;
    const offsetGetter = Object.getOwnPropertyDescriptor(prototype, "byteOffset")?.get;
    const lengthGetter = Object.getOwnPropertyDescriptor(prototype, "byteLength")?.get;
    if (!bufferGetter || !offsetGetter || !lengthGetter) {
      throw new TypeError("Array buffer view accessors are unavailable");
    }
    const buffer = Reflect.apply(bufferGetter, value, []) as ArrayBufferLike;
    const byteOffset = Reflect.apply(offsetGetter, value, []) as number;
    const byteLength = Reflect.apply(lengthGetter, value, []) as number;
    return new Uint8Array(buffer, byteOffset, byteLength);
  };

  const aBytes = getBytes(a);
  const bBytes = getBytes(b);
  if (aBytes.byteLength !== bBytes.byteLength) return false;
  return aBytes.every((value, index) => value === bBytes[index]);
}

function compareArrayBuffers(a: ArrayBufferLike, b: ArrayBufferLike): boolean {
  const aBytes = new Uint8Array(a);
  const bBytes = new Uint8Array(b);
  if (aBytes.byteLength !== bBytes.byteLength) return false;
  return aBytes.every((value, index) => value === bBytes[index]);
}

function collectSerializableValues<T>(values: Iterable<T>): T[] {
  const collected: T[] = [];
  for (const value of values) {
    if (collected.length >= MAX_SERIALIZED_VALUES) {
      throw new SerializationLimitError("Serialization exceeded its safe collection limit");
    }
    collected.push(value);
  }
  return collected;
}

function getBoxedPrimitiveValue(value: object): unknown {
  const prototype = Object.getPrototypeOf(value);
  if (prototype === Boolean.prototype) {
    return Reflect.apply(Boolean.prototype.valueOf, value, []);
  }
  if (prototype === Number.prototype) {
    return Reflect.apply(Number.prototype.valueOf, value, []);
  }
  if (prototype === String.prototype) {
    return Reflect.apply(String.prototype.valueOf, value, []);
  }
  if (prototype === BigInt.prototype) {
    return Reflect.apply(BigInt.prototype.valueOf, value, []);
  }
  return Reflect.apply(Symbol.prototype.valueOf, value, []);
}

function getMapSize(value: Map<unknown, unknown>): number {
  if (!MAP_SIZE_GETTER) throw new TypeError("Map size getter is unavailable");
  return Reflect.apply(MAP_SIZE_GETTER, value, []) as number;
}

function getSetSize(value: Set<unknown>): number {
  if (!SET_SIZE_GETTER) throw new TypeError("Set size getter is unavailable");
  return Reflect.apply(SET_SIZE_GETTER, value, []) as number;
}

function getMapEntries(value: Map<unknown, unknown>): MapIterator<[unknown, unknown]> {
  return Reflect.apply(Map.prototype.entries, value, []) as MapIterator<[unknown, unknown]>;
}

function getSetValues(value: Set<unknown>): SetIterator<unknown> {
  return Reflect.apply(Set.prototype.values, value, []) as SetIterator<unknown>;
}

function getHeadersEntries(value: Headers): HeadersIterator<[string, string]> {
  return Reflect.apply(Headers.prototype.entries, value, []) as HeadersIterator<[
    string,
    string,
  ]>;
}

function getRegExpSource(value: RegExp): string {
  if (!REGEXP_SOURCE_GETTER) throw new TypeError("RegExp source getter is unavailable");
  return Reflect.apply(REGEXP_SOURCE_GETTER, value, []) as string;
}

function getRegExpFlags(value: RegExp): string {
  let flags = "";
  for (const [property, flag] of REGEXP_FLAGS) {
    const getter = Object.getOwnPropertyDescriptor(RegExp.prototype, property)?.get;
    if (getter && Reflect.apply(getter, value, [])) flags += flag;
  }
  return flags;
}

function cloneComparisonState(state: ComparisonState): ComparisonState {
  return {
    budget: state.budget,
    depth: state.depth,
    leftToRight: new Map(state.leftToRight),
    rightToLeft: new Map(state.rightToLeft),
  };
}

function commitComparisonState(target: ComparisonState, source: ComparisonState): void {
  target.leftToRight = source.leftToRight;
  target.rightToLeft = source.rightToLeft;
}

function compareOwnProperties(
  a: object,
  b: object,
  state: ComparisonState,
  compare: (a: unknown, b: unknown, state: ComparisonState) => boolean,
): boolean {
  const aKeys = enumerableOwnKeys(a);
  const bKeys = enumerableOwnKeys(b);
  if (aKeys.length !== bKeys.length) return false;

  const bKeySet = new Set(bKeys);
  for (const key of aKeys) {
    if (!bKeySet.has(key)) return false;

    const aDescriptor = Object.getOwnPropertyDescriptor(a, key);
    const bDescriptor = Object.getOwnPropertyDescriptor(b, key);
    if (!aDescriptor || !bDescriptor) return false;

    if (!comparePropertyDescriptors(aDescriptor, bDescriptor, state, compare)) return false;
  }

  return true;
}

function compareSets(
  a: Set<unknown>,
  b: Set<unknown>,
  state: ComparisonState,
  compare: (a: unknown, b: unknown, state: ComparisonState) => boolean,
): boolean {
  if (getSetSize(a) !== getSetSize(b)) return false;
  const unmatched = [...getSetValues(b)];

  for (const aValue of getSetValues(a)) {
    let matchIndex = -1;
    let matchedState: ComparisonState | undefined;
    for (let index = 0; index < unmatched.length; index++) {
      const candidateState = cloneComparisonState(state);
      if (!compare(aValue, unmatched[index], candidateState)) continue;
      matchIndex = index;
      matchedState = candidateState;
      break;
    }
    if (matchIndex === -1 || !matchedState) return false;
    unmatched.splice(matchIndex, 1);
    commitComparisonState(state, matchedState);
  }

  return true;
}

function compareMaps(
  a: Map<unknown, unknown>,
  b: Map<unknown, unknown>,
  state: ComparisonState,
  compare: (a: unknown, b: unknown, state: ComparisonState) => boolean,
): boolean {
  if (getMapSize(a) !== getMapSize(b)) return false;
  const unmatched = [...getMapEntries(b)];

  for (const [aKey, aValue] of getMapEntries(a)) {
    let matchIndex = -1;
    let matchedState: ComparisonState | undefined;
    for (let index = 0; index < unmatched.length; index++) {
      const [bKey, bValue] = unmatched[index]!;
      const candidateState = cloneComparisonState(state);
      if (!compare(aKey, bKey, candidateState)) continue;
      if (!compare(aValue, bValue, candidateState)) continue;
      matchIndex = index;
      matchedState = candidateState;
      break;
    }
    if (matchIndex === -1 || !matchedState) return false;
    unmatched.splice(matchIndex, 1);
    commitComparisonState(state, matchedState);
  }

  return true;
}

function compareValues(a: unknown, b: unknown, state: ComparisonState): boolean {
  state.budget.comparisons++;
  if (state.budget.comparisons > MAX_DEEP_EQUALITY_COMPARISONS) {
    throw new DeepEqualityLimitError("Deep equality comparison exceeded its safe limit");
  }
  state.depth++;
  if (state.depth > MAX_DEEP_EQUALITY_DEPTH) {
    throw new DeepEqualityLimitError("Deep equality nesting exceeded its safe limit");
  }

  try {
    return compareValuesAtDepth(a, b, state);
  } finally {
    state.depth--;
  }
}

function compareValuesAtDepth(a: unknown, b: unknown, state: ComparisonState): boolean {
  if (sameValueZero(a, b)) return true;
  if (!isObject(a) || !isObject(b)) return false;
  if (a instanceof WeakMap || b instanceof WeakMap) {
    throw new UnsupportedWeakCollectionError("Cannot compare WeakMap instances");
  }
  if (a instanceof WeakSet || b instanceof WeakSet) {
    throw new UnsupportedWeakCollectionError("Cannot compare WeakSet instances");
  }
  if (a instanceof WeakRef || b instanceof WeakRef) {
    throw new UnsupportedWeakCollectionError("Cannot compare WeakRef instances");
  }
  if (!prototypesEqual(a, b)) return false;

  const mappedRight = state.leftToRight.get(a);
  if (mappedRight) return mappedRight === b;
  const mappedLeft = state.rightToLeft.get(b);
  if (mappedLeft) return mappedLeft === a;
  state.leftToRight.set(a, b);
  state.rightToLeft.set(b, a);

  if (a instanceof Date && b instanceof Date) {
    return Object.is(
      Reflect.apply(Date.prototype.getTime, a, []),
      Reflect.apply(Date.prototype.getTime, b, []),
    );
  }
  if (a instanceof RegExp && b instanceof RegExp) {
    return getRegExpSource(a) === getRegExpSource(b) &&
      getRegExpFlags(a) === getRegExpFlags(b);
  }
  if (a instanceof URL && b instanceof URL) {
    return Reflect.apply(URL.prototype.toString, a, []) ===
      Reflect.apply(URL.prototype.toString, b, []);
  }
  if (a instanceof URLSearchParams && b instanceof URLSearchParams) {
    return Reflect.apply(URLSearchParams.prototype.toString, a, []) ===
      Reflect.apply(URLSearchParams.prototype.toString, b, []);
  }
  if (typeof Headers !== "undefined" && (a instanceof Headers || b instanceof Headers)) {
    return a instanceof Headers && b instanceof Headers &&
      compareValues([...getHeadersEntries(a)], [...getHeadersEntries(b)], state);
  }
  if (a instanceof Error && b instanceof Error) {
    if (
      !comparePropertyDescriptors(
        findPropertyDescriptor(a, "name"),
        findPropertyDescriptor(b, "name"),
        state,
        compareValues,
      ) ||
      !comparePropertyDescriptors(
        findPropertyDescriptor(a, "message"),
        findPropertyDescriptor(b, "message"),
        state,
        compareValues,
      ) ||
      !comparePropertyDescriptors(
        Object.getOwnPropertyDescriptor(a, "cause"),
        Object.getOwnPropertyDescriptor(b, "cause"),
        state,
        compareValues,
      )
    ) {
      return false;
    }
    return compareOwnProperties(a, b, state, compareValues);
  }
  if (BOXED_PRIMITIVE_PROTOTYPES.has(Object.getPrototypeOf(a))) {
    return compareValues(
      getBoxedPrimitiveValue(a),
      getBoxedPrimitiveValue(b),
      state,
    ) && compareOwnProperties(a, b, state, compareValues);
  }
  if (a instanceof ArrayBuffer && b instanceof ArrayBuffer) return compareArrayBuffers(a, b);
  if (
    typeof SharedArrayBuffer !== "undefined" && a instanceof SharedArrayBuffer &&
    b instanceof SharedArrayBuffer
  ) {
    return compareArrayBuffers(a, b);
  }
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) return compareTypedArrays(a, b);
  if (a instanceof Map && b instanceof Map) {
    return compareMaps(a, b, state, compareValues) &&
      compareOwnProperties(a, b, state, compareValues);
  }
  if (a instanceof Set && b instanceof Set) {
    return compareSets(a, b, state, compareValues) &&
      compareOwnProperties(a, b, state, compareValues);
  }
  if (a instanceof Promise || b instanceof Promise) return false;
  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
  }

  const tagDescriptor = findPropertyDescriptor(a, Symbol.toStringTag);
  if (tagDescriptor) {
    if (!("value" in tagDescriptor) || tagDescriptor.value !== "Object") return false;
  }

  return compareOwnProperties(a, b, state, compareValues);
}

/** Compare values recursively using cross-runtime value equality. */
export function deepEquals(a: unknown, b: unknown): boolean {
  try {
    return compareValues(a, b, {
      budget: { comparisons: 0 },
      depth: 0,
      leftToRight: new Map(),
      rightToLeft: new Map(),
    });
  } catch (error) {
    if (
      error instanceof UnsupportedWeakCollectionError || error instanceof DeepEqualityLimitError
    ) {
      throw error;
    }
    return false;
  }
}

type SerializationState = {
  ancestors: object[];
  depth: number;
  inspectedProperties: number;
  outputCharacters: number;
  visitedValues: number;
};

function sanitizeStringValue(value: string, state: SerializationState): string {
  const sanitized = value.length > MAX_STRINGIFIED_OUTPUT_LENGTH
    ? `${value.slice(0, MAX_STRINGIFIED_OUTPUT_LENGTH)}...[Truncated]`
    : value;
  state.outputCharacters += sanitized.length;
  if (state.outputCharacters > MAX_STRINGIFIED_OUTPUT_LENGTH * 2) {
    throw new SerializationLimitError("Serialization exceeded its safe output limit");
  }
  return sanitized;
}

function defineSerializableProperty(
  target: Record<string, unknown>,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

function safeFunctionLabel(value: object): string {
  try {
    const descriptor = findPropertyDescriptor(value, "name");
    const name = descriptor && "value" in descriptor && typeof descriptor.value === "string"
      ? descriptor.value
      : "";
    return name ? `[Function ${name}]` : "[Function]";
  } catch {
    return "[Function]";
  }
}

function sanitizeArray(value: unknown[], state: SerializationState): unknown[] {
  const lengthDescriptor = Object.getOwnPropertyDescriptor(value, "length");
  if (
    !lengthDescriptor || !("value" in lengthDescriptor) ||
    typeof lengthDescriptor.value !== "number" || lengthDescriptor.value > MAX_SERIALIZED_VALUES
  ) {
    throw new SerializationLimitError("Serialization exceeded its safe array limit");
  }
  state.inspectedProperties += lengthDescriptor.value;
  if (state.inspectedProperties > MAX_SERIALIZED_VALUES) {
    throw new SerializationLimitError("Serialization exceeded its safe property limit");
  }

  const output = new Array<unknown>(lengthDescriptor.value);
  Object.defineProperty(output, "toJSON", {
    configurable: true,
    enumerable: false,
    value: undefined,
    writable: true,
  });
  for (let index = 0; index < lengthDescriptor.value; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor) continue;
    output[index] = "value" in descriptor
      ? sanitizeForSerialization(descriptor.value, state)
      : "[Accessor]";
  }
  return output;
}

function sanitizeObject(
  value: object,
  state: SerializationState,
): unknown {
  if (value instanceof RegExp) {
    return sanitizeStringValue(`/${getRegExpSource(value)}/${getRegExpFlags(value)}`, state);
  }
  if (value instanceof Error) {
    const output = Object.create(null) as Record<string, unknown>;
    defineSerializableProperty(
      output,
      "name",
      sanitizeForSerialization(getSerializableProperty(value, "name", "Error"), state),
    );
    defineSerializableProperty(
      output,
      "message",
      sanitizeForSerialization(getSerializableProperty(value, "message", ""), state),
    );
    return output;
  }
  if (value instanceof Map) {
    const output = Object.create(null) as Record<string, unknown>;
    defineSerializableProperty(
      output,
      "entries",
      sanitizeForSerialization(collectSerializableValues(getMapEntries(value)), state),
    );
    return output;
  }
  if (value instanceof Set) {
    const output = Object.create(null) as Record<string, unknown>;
    defineSerializableProperty(
      output,
      "values",
      sanitizeForSerialization(collectSerializableValues(getSetValues(value)), state),
    );
    return output;
  }
  if (value instanceof Date) {
    const time = Reflect.apply(Date.prototype.getTime, value, []) as number;
    return Number.isFinite(time)
      ? sanitizeStringValue(Reflect.apply(Date.prototype.toISOString, value, []), state)
      : null;
  }
  if (value instanceof URL) {
    return sanitizeStringValue(Reflect.apply(URL.prototype.toString, value, []), state);
  }
  if (BOXED_PRIMITIVE_PROTOTYPES.has(Object.getPrototypeOf(value))) {
    return sanitizeForSerialization(getBoxedPrimitiveValue(value), state);
  }
  if (Array.isArray(value)) return sanitizeArray(value, state);

  const output = Object.create(null) as Record<string, unknown>;
  const keys = Reflect.ownKeys(value);
  state.inspectedProperties += keys.length;
  if (state.inspectedProperties > MAX_SERIALIZED_VALUES) {
    throw new SerializationLimitError("Serialization exceeded its safe property limit");
  }
  const properties: Array<[PropertyKey, PropertyDescriptor]> = [];
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable) continue;
    properties.push([key, descriptor]);
  }
  properties.sort(([left], [right]) =>
    Number(typeof left === "symbol") - Number(
      typeof right === "symbol",
    )
  );

  let symbolIndex = 0;
  for (const [key, descriptor] of properties) {
    let outputKey = typeof key === "string" ? key : `[${String(key)}:${symbolIndex++}]`;
    if (typeof key === "symbol") {
      let collisionIndex = 1;
      const baseKey = outputKey;
      while (Object.hasOwn(output, outputKey)) outputKey = `${baseKey}:${collisionIndex++}`;
    }
    if (outputKey.length > MAX_STRINGIFIED_OUTPUT_LENGTH) {
      throw new SerializationLimitError("Serialization exceeded its safe key limit");
    }
    state.outputCharacters += outputKey.length;
    if (state.outputCharacters > MAX_STRINGIFIED_OUTPUT_LENGTH * 2) {
      throw new SerializationLimitError("Serialization exceeded its safe output limit");
    }
    defineSerializableProperty(
      output,
      outputKey,
      "value" in descriptor ? sanitizeForSerialization(descriptor.value, state) : "[Accessor]",
    );
  }
  return output;
}

function sanitizeForSerialization(value: unknown, state: SerializationState): unknown {
  state.visitedValues++;
  if (state.visitedValues > MAX_SERIALIZED_VALUES) {
    throw new SerializationLimitError("Serialization exceeded its safe value limit");
  }
  if (typeof value === "string") return sanitizeStringValue(value, state);
  if (typeof value === "bigint") return sanitizeStringValue(`${value}n`, state);
  if (typeof value === "function") return sanitizeStringValue(safeFunctionLabel(value), state);
  if (typeof value === "symbol") return sanitizeStringValue(String(value), state);
  if (!isObject(value)) return value;

  if (state.ancestors.includes(value)) return "[Circular]";
  state.depth++;
  if (state.depth > MAX_SERIALIZATION_DEPTH) {
    throw new SerializationLimitError("Serialization exceeded its safe nesting limit");
  }
  state.ancestors.push(value);
  try {
    return sanitizeObject(value, state);
  } finally {
    state.ancestors.pop();
    state.depth--;
  }
}

/** Serialize unknown values safely for test output. */
export function safeStringify(value: unknown): string {
  try {
    const sanitized = sanitizeForSerialization(value, {
      ancestors: [],
      depth: 0,
      inspectedProperties: 0,
      outputCharacters: 0,
      visitedValues: 0,
    });
    const serialized = JSON.stringify(sanitized);

    const output = serialized ?? (value === undefined ? "undefined" : "[Unserializable]");
    if (output.length <= MAX_STRINGIFIED_OUTPUT_LENGTH) return output;
    return `${output.slice(0, MAX_STRINGIFIED_OUTPUT_LENGTH)}...[Truncated]`;
  } catch (error) {
    if (error instanceof SerializationLimitError) return "[Truncated]";
    return "[Unserializable]";
  }
}
