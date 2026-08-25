/**
 * Bounded data-only snapshots for the Server Action authorization boundary.
 *
 * @module server/services/rsc/endpoints/action-authorization-snapshot
 */

import { isProxyWithoutHooks } from "#veryfront/platform/compat/error-introspection.ts";
import type {
  RscActionAuthorizationArray,
  RscActionAuthorizationRecord,
  RscActionAuthorizationValue,
} from "#veryfront/extensions/auth/index.ts";
import {
  RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_ARRAY_LENGTH,
  RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_DEPTH,
  RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_NODES,
  RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_PROPERTIES,
} from "#veryfront/extensions/auth/index.ts";

const apply = Reflect.apply;
const arrayIsArray = Array.isArray;
const ArrayPrototype = Array.prototype;
const arrayValues = ArrayPrototype.values;
const createObject = Object.create;
const defineProperty = Object.defineProperty;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const getPrototypeOf = Object.getPrototypeOf;
const hasOwnProperty = Object.prototype.hasOwnProperty;
const iteratorSymbol = Symbol.iterator;
const NativeArray = Array;
const NativeTypeError = TypeError;
const NativeWeakSet = WeakSet;
const numberIsFinite = Number.isFinite;
const numberIsSafeInteger = Number.isSafeInteger;
const objectPrototype = Object.prototype;
const ownKeys = Reflect.ownKeys;
const setPrototypeOf = Object.setPrototypeOf;
const weakSetAdd = WeakSet.prototype.add;
const weakSetDelete = WeakSet.prototype.delete;
const weakSetHas = WeakSet.prototype.has;

function hasOwn(value: object, key: PropertyKey): boolean {
  return apply(hasOwnProperty, value, [key]) as boolean;
}

interface SnapshotState {
  readonly ancestors: WeakSet<object>;
  nodes: number;
  properties: number;
}

type SnapshotMode = "authorization" | "invocation";

function invalidArgument(path: string, reason: string, cause?: unknown): TypeError {
  return new NativeTypeError(
    `Invalid Server Action argument at ${path}: ${reason}`,
    cause === undefined ? undefined : { cause },
  );
}

function defineImmutableData(target: object, key: PropertyKey, value: unknown): void {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = false;
  descriptor.enumerable = true;
  descriptor.value = value;
  descriptor.writable = false;
  apply(defineProperty, Object, [target, key, descriptor]);
}

function defineMutableData(target: object, key: PropertyKey, value: unknown): void {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = true;
  descriptor.enumerable = true;
  descriptor.value = value;
  descriptor.writable = true;
  apply(defineProperty, Object, [target, key, descriptor]);
}

const arrayIteratorPrototype = getPrototypeOf(
  apply(arrayValues, new NativeArray(), []) as object,
);
const arrayIteratorNext = getOwnPropertyDescriptor(arrayIteratorPrototype, "next")?.value;
if (typeof arrayIteratorNext !== "function") {
  throw new NativeTypeError("Array iterator next intrinsic is unavailable");
}

function defineHiddenImmutableData(
  target: object,
  key: PropertyKey,
  value: unknown,
): void {
  const descriptor = createObject(null) as PropertyDescriptor;
  descriptor.configurable = false;
  descriptor.enumerable = false;
  descriptor.value = value;
  descriptor.writable = false;
  apply(defineProperty, Object, [target, key, descriptor]);
}

function createStableArrayIterator(
  source: Readonly<RscActionAuthorizationArray>,
): IterableIterator<RscActionAuthorizationValue> {
  const nativeIterator = apply(arrayValues, source, []) as IterableIterator<
    RscActionAuthorizationValue
  >;
  const iterator = createObject(null) as IterableIterator<RscActionAuthorizationValue>;
  defineHiddenImmutableData(
    iterator,
    "next",
    freeze((): IteratorResult<RscActionAuthorizationValue> => {
      const result = apply(arrayIteratorNext, nativeIterator, []) as IteratorResult<
        RscActionAuthorizationValue
      >;
      const snapshot = createObject(null) as {
        done: boolean;
        value?: RscActionAuthorizationValue;
      };
      defineImmutableData(snapshot, "done", result.done === true);
      if (result.done !== true) defineImmutableData(snapshot, "value", result.value);
      return freeze(snapshot) as IteratorResult<RscActionAuthorizationValue>;
    }),
  );
  defineHiddenImmutableData(iterator, iteratorSymbol, freeze(() => iterator));
  return freeze(iterator);
}

function accountValue(state: SnapshotState, path: string, depth: number): void {
  if (depth > RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_DEPTH) {
    throw invalidArgument(
      path,
      `depth exceeds ${RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_DEPTH}`,
    );
  }
  state.nodes += 1;
  if (state.nodes > RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_NODES) {
    throw invalidArgument(
      path,
      `value count exceeds ${RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_NODES}`,
    );
  }
}

function accountProperties(state: SnapshotState, count: number, path: string): void {
  if (count > RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_PROPERTIES - state.properties) {
    throw invalidArgument(
      path,
      `property count exceeds ${RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_PROPERTIES}`,
    );
  }
  state.properties += count;
}

function childPath(path: string, key: PropertyKey): string {
  return typeof key === "symbol" ? `${path}[symbol]` : `${path}[${key}]`;
}

function readDataProperty(
  value: object,
  key: PropertyKey,
  path: string,
): unknown {
  const descriptor = getOwnPropertyDescriptor(value, key);
  if (
    descriptor === undefined || descriptor.enumerable !== true ||
    !hasOwn(descriptor, "value")
  ) {
    throw invalidArgument(path, "only enumerable data properties are supported");
  }
  return descriptor.value;
}

function enterContainer(state: SnapshotState, value: object, path: string): void {
  if (apply(weakSetHas, state.ancestors, [value]) as boolean) {
    throw invalidArgument(path, "cyclic references are not supported");
  }
  apply(weakSetAdd, state.ancestors, [value]);
}

function leaveContainer(state: SnapshotState, value: object): void {
  apply(weakSetDelete, state.ancestors, [value]);
}

function snapshotArray(
  value: unknown[],
  path: string,
  depth: number,
  state: SnapshotState,
  mode: SnapshotMode,
): unknown[] | Readonly<RscActionAuthorizationArray> {
  const prototype = getPrototypeOf(value);
  if (prototype !== ArrayPrototype) {
    throw invalidArgument(path, "array subclasses and custom prototypes are not supported");
  }
  const lengthDescriptor = getOwnPropertyDescriptor(value, "length");
  const length = lengthDescriptor !== undefined && hasOwn(lengthDescriptor, "value")
    ? lengthDescriptor.value
    : undefined;
  if (
    typeof length !== "number" || !numberIsSafeInteger(length) || length < 0 ||
    length > RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_ARRAY_LENGTH
  ) {
    throw invalidArgument(
      path,
      `array length exceeds ${RSC_ACTION_AUTHORIZATION_MAX_ARGUMENT_ARRAY_LENGTH}`,
    );
  }
  const keys = ownKeys(value);
  if (keys.length !== length + 1) {
    throw invalidArgument(path, "arrays must be dense and contain no extra properties");
  }
  for (let index = 0; index < keys.length; index += 1) {
    if (typeof keys[index] === "symbol") {
      throw invalidArgument(path, "symbol properties are not supported");
    }
  }

  accountProperties(state, length, path);
  enterContainer(state, value, path);
  try {
    const output = new NativeArray<RscActionAuthorizationValue>(length);
    if (mode === "authorization") {
      apply(setPrototypeOf, Object, [output, null]);
    }
    for (let index = 0; index < length; index += 1) {
      const key = String(index);
      const child = snapshotValue(
        readDataProperty(value, key, childPath(path, key)),
        childPath(path, key),
        depth + 1,
        state,
        mode,
      );
      (mode === "authorization" ? defineImmutableData : defineMutableData)(
        output,
        key,
        child,
      );
    }
    if (mode === "invocation") return output;
    defineHiddenImmutableData(
      output,
      iteratorSymbol,
      freeze(() => createStableArrayIterator(output)),
    );
    return freeze(output) as Readonly<RscActionAuthorizationArray>;
  } finally {
    leaveContainer(state, value);
  }
}

function snapshotRecord(
  value: object,
  path: string,
  depth: number,
  state: SnapshotState,
  mode: SnapshotMode,
): Record<string, unknown> | Readonly<RscActionAuthorizationRecord> {
  const prototype = getPrototypeOf(value);
  if (prototype !== objectPrototype && prototype !== null) {
    throw invalidArgument(path, "only plain and null-prototype records are supported");
  }
  const keys = ownKeys(value);
  accountProperties(state, keys.length, path);
  enterContainer(state, value, path);
  try {
    const output = createObject(null) as Record<string, RscActionAuthorizationValue>;
    for (let index = 0; index < keys.length; index += 1) {
      const key = keys[index]!;
      if (typeof key === "symbol") {
        throw invalidArgument(path, "symbol properties are not supported");
      }
      const child = snapshotValue(
        readDataProperty(value, key, childPath(path, key)),
        childPath(path, key),
        depth + 1,
        state,
        mode,
      );
      (mode === "authorization" ? defineImmutableData : defineMutableData)(
        output,
        key,
        child,
      );
    }
    return mode === "authorization"
      ? freeze(output) as Readonly<RscActionAuthorizationRecord>
      : output;
  } finally {
    leaveContainer(state, value);
  }
}

function snapshotValue(
  value: unknown,
  path: string,
  depth: number,
  state: SnapshotState,
  mode: SnapshotMode,
): unknown {
  accountValue(state, path, depth);
  if (value === null || typeof value === "boolean" || typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    if (!numberIsFinite(value)) throw invalidArgument(path, "numbers must be finite");
    return value;
  }
  if (typeof value !== "object") {
    throw invalidArgument(path, `${typeof value} values are not supported`);
  }
  if (isProxyWithoutHooks(value)) {
    throw invalidArgument(path, "proxies are not supported");
  }
  return arrayIsArray(value)
    ? snapshotArray(value, path, depth, state, mode)
    : snapshotRecord(value, path, depth, state, mode);
}

/** Create a deeply detached, bounded, immutable authorization-only args graph. */
export function snapshotRscActionAuthorizationArgs(
  args: readonly unknown[],
): Readonly<RscActionAuthorizationArray> {
  return snapshotValue(
    args,
    "args",
    0,
    {
      ancestors: new NativeWeakSet<object>(),
      nodes: 0,
      properties: 0,
    },
    "authorization",
  ) as Readonly<RscActionAuthorizationArray>;
}

/**
 * Create a detached action-owned argument graph. Records use null prototypes
 * so inherited shared-realm properties cannot become request data; arrays
 * retain standard application Array behavior and the graph remains mutable.
 */
export function snapshotRscActionInvocationArgs(args: readonly unknown[]): unknown[] {
  return snapshotValue(
    args,
    "args",
    0,
    {
      ancestors: new NativeWeakSet<object>(),
      nodes: 0,
      properties: 0,
    },
    "invocation",
  ) as unknown[];
}
