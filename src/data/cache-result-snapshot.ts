import type { DataResult } from "./types.ts";
import {
  MAX_DATA_CACHE_SNAPSHOT_BYTES,
  MAX_DATA_CACHE_SNAPSHOT_DEPTH,
  MAX_DATA_CACHE_SNAPSHOT_NODES,
} from "./data-limits.ts";
import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";

const OBJECT_OVERHEAD_BYTES = 32;
const ARRAY_OVERHEAD_BYTES = 24;
const STRING_OVERHEAD_BYTES = 16;
const PROPERTY_OVERHEAD_BYTES = 8;
const ARRAY_SLOT_BYTES = 8;

const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectPrototype = Object.prototype;
const ArrayConstructor = Array;
const ArrayIsArray = Array.isArray;
const ArrayPrototype = Array.prototype;
const MapConstructor = Map;
const MapPrototypeGet = Map.prototype.get;
const MapPrototypeSet = Map.prototype.set;
const WeakMapConstructor = WeakMap;
const WeakMapPrototypeGet = WeakMap.prototype.get;
const WeakMapPrototypeSet = WeakMap.prototype.set;
const NumberIsSafeInteger = Number.isSafeInteger;
const NumberPrototypeToLocaleString = Number.prototype.toLocaleString;
const NumberConstructor = Number;
const StringConstructor = String;
const ReflectApply = Reflect.apply;
const ReflectGetOwnPropertyDescriptor = Reflect.getOwnPropertyDescriptor;
const ReflectOwnKeys = Reflect.ownKeys;

interface SnapshotState {
  readonly copies: Map<object, object>;
  readonly created: object[];
  bytes: number;
  nodes: number;
}

const retainedSnapshotBytes = new WeakMapConstructor<object, number>();

function getCopy(state: SnapshotState, source: object): object | undefined {
  return ReflectApply(MapPrototypeGet, state.copies, [source]) as
    | object
    | undefined;
}

function setCopy(state: SnapshotState, source: object, copy: object): void {
  ReflectApply(MapPrototypeSet, state.copies, [source, copy]);
}

function setRetainedBytes(value: object, bytes: number): void {
  ReflectApply(WeakMapPrototypeSet, retainedSnapshotBytes, [value, bytes]);
}

function getRetainedBytes(value: object): number | undefined {
  return ReflectApply(WeakMapPrototypeGet, retainedSnapshotBytes, [value]) as
    | number
    | undefined;
}

function invalidCachedData(): never {
  throw new TypeError(
    "Cached static data must contain only primitives, dense plain arrays, and plain enumerable data records",
  );
}

function snapshotLimit(kind: "depth" | "node" | "byte", limit: number): never {
  const formattedLimit = ReflectApply(
    NumberPrototypeToLocaleString,
    limit,
    ["en-US"],
  ) as string;
  throw new RangeError(
    `Cached static data exceeds the ${kind} limit of ${formattedLimit}`,
  );
}

function addBytes(state: SnapshotState, amount: number): void {
  if (
    !NumberIsSafeInteger(amount) || amount < 0 ||
    amount > MAX_DATA_CACHE_SNAPSHOT_BYTES - state.bytes
  ) {
    snapshotLimit("byte", MAX_DATA_CACHE_SNAPSHOT_BYTES);
  }
  state.bytes += amount;
}

function beginValue(state: SnapshotState, depth: number): void {
  if (depth > MAX_DATA_CACHE_SNAPSHOT_DEPTH) {
    snapshotLimit("depth", MAX_DATA_CACHE_SNAPSHOT_DEPTH);
  }
  if (state.nodes >= MAX_DATA_CACHE_SNAPSHOT_NODES) {
    snapshotLimit("node", MAX_DATA_CACHE_SNAPSHOT_NODES);
  }
  state.nodes++;
}

function defineDataProperty(
  target: object,
  key: string,
  value: unknown,
): void {
  ObjectDefineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function appendCreated(state: SnapshotState, value: object): void {
  defineDataProperty(
    state.created,
    StringConstructor(state.created.length),
    value,
  );
}

function copyPrimitive(value: unknown, state: SnapshotState): unknown {
  if (value === null || value === undefined) return value;
  switch (typeof value) {
    case "boolean":
      addBytes(state, 4);
      return value;
    case "number":
      addBytes(state, 8);
      return value;
    case "string":
      addBytes(state, STRING_OVERHEAD_BYTES + value.length * 2);
      return value;
    default:
      return invalidCachedData();
  }
}

function copyArray(
  source: unknown[],
  depth: number,
  state: SnapshotState,
): unknown[] {
  const lengthDescriptor = ReflectGetOwnPropertyDescriptor(source, "length");
  const length = lengthDescriptor && "value" in lengthDescriptor
    ? lengthDescriptor.value
    : undefined;
  if (!NumberIsSafeInteger(length) || (length as number) < 0) {
    return invalidCachedData();
  }
  const arrayLength = length as number;
  if (arrayLength > MAX_DATA_CACHE_SNAPSHOT_NODES - state.nodes) {
    snapshotLimit("node", MAX_DATA_CACHE_SNAPSHOT_NODES);
  }
  addBytes(state, ARRAY_OVERHEAD_BYTES + arrayLength * ARRAY_SLOT_BYTES);

  const keys = ReflectOwnKeys(source);
  if (keys.length !== arrayLength + 1) return invalidCachedData();

  const copy = new ArrayConstructor<unknown>(arrayLength);
  setCopy(state, source, copy);
  appendCreated(state, copy);
  let indices = 0;
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    const key = keys[keyIndex]!;
    if (key === "length") continue;
    if (typeof key !== "string") return invalidCachedData();
    const index = NumberConstructor(key);
    const descriptor = ReflectGetOwnPropertyDescriptor(source, key);
    if (
      !NumberIsSafeInteger(index) || index < 0 || index >= arrayLength ||
      StringConstructor(index) !== key || descriptor?.enumerable !== true ||
      !("value" in descriptor)
    ) {
      return invalidCachedData();
    }
    defineDataProperty(
      copy,
      key,
      copyValue(descriptor.value, depth + 1, state),
    );
    indices++;
  }
  if (indices !== arrayLength) return invalidCachedData();
  return copy;
}

function copyRecord(
  source: object,
  prototype: object | null,
  depth: number,
  state: SnapshotState,
): Record<string, unknown> {
  addBytes(state, OBJECT_OVERHEAD_BYTES);
  const keys = ReflectOwnKeys(source);
  if (keys.length > MAX_DATA_CACHE_SNAPSHOT_NODES - state.nodes) {
    snapshotLimit("node", MAX_DATA_CACHE_SNAPSHOT_NODES);
  }

  const copy = ObjectCreate(prototype) as Record<string, unknown>;
  setCopy(state, source, copy);
  appendCreated(state, copy);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
    const key = keys[keyIndex]!;
    if (typeof key !== "string") return invalidCachedData();
    const descriptor = ReflectGetOwnPropertyDescriptor(source, key);
    if (descriptor?.enumerable !== true || !("value" in descriptor)) {
      return invalidCachedData();
    }
    addBytes(state, PROPERTY_OVERHEAD_BYTES + key.length * 2);
    defineDataProperty(
      copy,
      key,
      copyValue(descriptor.value, depth + 1, state),
    );
  }
  return copy;
}

function copyValue(
  value: unknown,
  depth: number,
  state: SnapshotState,
): unknown {
  beginValue(state, depth);
  if (value === null || typeof value !== "object") {
    return copyPrimitive(value, state);
  }
  if (isProxyWithoutHooks(value)) return invalidCachedData();

  const existing = getCopy(state, value);
  if (existing !== undefined) return existing;

  let prototype: object | null;
  try {
    prototype = ObjectGetPrototypeOf(value);
  } catch {
    return invalidCachedData();
  }
  if (ArrayIsArray(value)) {
    if (prototype !== ArrayPrototype) return invalidCachedData();
    return copyArray(value, depth, state);
  }
  if (prototype !== ObjectPrototype && prototype !== null) {
    return invalidCachedData();
  }
  return copyRecord(value, prototype, depth, state);
}

function createSnapshot(value: DataResult, freeze: boolean): {
  readonly result: DataResult;
  readonly bytes: number;
} {
  const state: SnapshotState = {
    copies: new MapConstructor<object, object>(),
    created: [],
    bytes: 0,
    nodes: 0,
  };
  const result = copyValue(value, 0, state) as DataResult;

  if (freeze) {
    for (let index = state.created.length - 1; index >= 0; index--) {
      ObjectFreeze(state.created[index]!);
    }
  }
  return { result, bytes: state.bytes };
}

/** Capture the immutable graph retained by the static-data cache. */
export function captureCacheableDataResult(result: DataResult): DataResult {
  const captured = createSnapshot(result, true);
  setRetainedBytes(captured.result as object, captured.bytes);
  return captured.result;
}

/** Return the exact deterministic charge recorded for an immutable snapshot. */
export function getCapturedDataResultBytes(value: object): number | undefined {
  return getRetainedBytes(value);
}

/** Give one cache caller a mutable graph that shares no objects with storage. */
export function cloneCapturedDataResult(result: DataResult): DataResult {
  // Stored snapshots were already validated, bounded, and stripped of Proxy
  // objects, so delivery only needs the bounded graph copy below.
  const state: SnapshotState = {
    copies: new MapConstructor<object, object>(),
    created: [],
    bytes: 0,
    nodes: 0,
  };
  return copyValue(result, 0, state) as DataResult;
}
