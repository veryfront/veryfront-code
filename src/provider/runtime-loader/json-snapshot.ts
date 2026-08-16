import {
  canIdentifyProxyWithoutHooks,
  isProxyWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";

/**
 * Security-sensitive primordials are captured during trusted framework
 * bootstrap, before tenant code runs. Snapshotting must not consult mutable
 * global constructors or prototype methods after that boundary: callers use
 * this module while handling values supplied by project and provider code.
 */
const apply = Reflect.apply;
const ArrayIsArray = Array.isArray;
const arraySort = Array.prototype.sort;
const NativeArray = Array;
const NativeTypeError = TypeError;
const NativeWeakSet = WeakSet;
const numberIsFinite = Number.isFinite;
const numberIsInteger = Number.isInteger;
const numberIsSafeInteger = Number.isSafeInteger;
const numberFromValue = Number;
const objectCreate = Object.create;
const objectDefineProperty = Object.defineProperty;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectHasOwnProperty = Object.prototype.hasOwnProperty;
const objectIs = Object.is;
const objectKeys = Object.keys;
const ownKeys = Reflect.ownKeys;
const jsonParse = JSON.parse;
const structuredCloneValue = globalThis.structuredClone;
const stringCharCodeAt = String.prototype.charCodeAt;
const stringFromValue = String;
const weakSetAdd = WeakSet.prototype.add;
const weakSetDelete = WeakSet.prototype.delete;
const weakSetHas = WeakSet.prototype.has;
const NativeArrayPrototype = Array.prototype;
const NativeObjectPrototype = Object.prototype;

function hasOwn(object: PropertyDescriptor, key: PropertyKey): boolean {
  return apply(objectHasOwnProperty, object, [key]) as boolean;
}

function charCodeAt(value: string, index: number): number {
  return apply(stringCharCodeAt, value, [index]);
}

function hasWeakSetValue(set: WeakSet<object>, value: object): boolean {
  return apply(weakSetHas, set, [value]) as boolean;
}

function addWeakSetValue(set: WeakSet<object>, value: object): void {
  apply(weakSetAdd, set, [value]);
}

function deleteWeakSetValue(set: WeakSet<object>, value: object): void {
  apply(weakSetDelete, set, [value]);
}

function defineArrayElement<T>(array: T[], index: number, value: T): void {
  objectDefineProperty(array, index, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

const DEFAULT_MAX_DEPTH = 64;
const DEFAULT_MAX_NODES = 65_536;
const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const OWNED_ARRAY_SNAPSHOTS = new NativeWeakSet<object>();

/**
 * A deeply owned JSON value returned by {@link snapshotJsonValue}.
 *
 * Compound snapshots are frozen before they are returned. Object snapshots
 * have null prototypes. Array snapshots retain normal array behavior but
 * shadow inherited `toJSON` hooks with an immutable non-enumerable property.
 */
export type JsonSnapshotValue =
  | null
  | boolean
  | number
  | string
  | readonly JsonSnapshotValue[]
  | { readonly [key: string]: JsonSnapshotValue };

/** Resource limits applied while taking a provider-boundary JSON snapshot. */
export type JsonSnapshotOptions = {
  /**
   * Maximum nesting depth, where the root value is at depth zero.
   *
   * @default 64
   */
  maxDepth?: number;
  /**
   * Maximum number of JSON values, including the root and primitive leaves.
   *
   * @default 65_536
   */
  maxNodes?: number;
  /**
   * Maximum UTF-8 byte length of the snapshot's canonical JSON encoding.
   *
   * @default 8_388_608
   */
  maxBytes?: number;
  /** Sort object keys for deterministic snapshots. Defaults to true. */
  sortObjectKeys?: boolean;
  /**
   * Follow `JSON.stringify` on `undefined` members: drop object properties
   * holding `undefined` and encode `undefined` array elements as `null`. Set
   * this only for wire payloads; audit callers need `undefined` to stay
   * distinguishable from absent.
   *
   * @default false
   */
  dropUndefinedMembers?: boolean;
};

type ResolvedJsonSnapshotOptions = {
  maxDepth: number;
  maxNodes: number;
  maxBytes: number;
  sortObjectKeys: boolean;
  dropUndefinedMembers: boolean;
};

type SnapshotState = ResolvedJsonSnapshotOptions & {
  nodes: number;
  bytes: number;
  ancestors: WeakSet<object>;
  valuesAreOwned: boolean;
};

function invalidValue(reason: string): never {
  throw new NativeTypeError(`Provider JSON snapshot ${reason}`);
}

function readLimit(
  value: unknown,
  fallback: number,
  name: keyof JsonSnapshotOptions,
  minimum: number,
): number {
  const resolved = value ?? fallback;
  if (
    typeof resolved !== "number" ||
    !numberIsSafeInteger(resolved) ||
    resolved < minimum
  ) {
    throw new NativeTypeError(
      `Provider JSON snapshot ${name} must be a safe integer no less than ${minimum}`,
    );
  }
  return resolved;
}

function readOwnOption(
  options: JsonSnapshotOptions,
  key: keyof JsonSnapshotOptions,
): unknown {
  if ((typeof options !== "object" && typeof options !== "function") || options === null) {
    throw new NativeTypeError("Provider JSON snapshot options must be an object");
  }

  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = objectGetOwnPropertyDescriptor(options, key);
  } catch {
    throw new NativeTypeError("Provider JSON snapshot options could not be inspected");
  }
  if (!descriptor) return undefined;
  if (!hasOwn(descriptor, "value")) {
    throw new NativeTypeError("Provider JSON snapshot options must use own data properties");
  }
  return descriptor.value;
}

function prepareOptionsForInspection(options: JsonSnapshotOptions): JsonSnapshotOptions {
  if ((typeof options !== "object" && typeof options !== "function") || options === null) {
    throw new NativeTypeError("Provider JSON snapshot options must be an object");
  }

  if (canIdentifyProxyWithoutHooks) {
    if (isProxyWithoutHooks(options)) {
      throw new NativeTypeError("Provider JSON snapshot options could not be inspected");
    }
    return options;
  }

  if (typeof structuredCloneValue !== "function") {
    throw new NativeTypeError("Provider JSON snapshot options could not be inspected");
  }

  try {
    return apply(structuredCloneValue, globalThis, [options]) as JsonSnapshotOptions;
  } catch {
    throw new NativeTypeError("Provider JSON snapshot options could not be inspected");
  }
}

function resolveOptions(options: JsonSnapshotOptions): ResolvedJsonSnapshotOptions {
  const inspectedOptions = prepareOptionsForInspection(options);
  const maxDepth = readOwnOption(inspectedOptions, "maxDepth");
  const maxNodes = readOwnOption(inspectedOptions, "maxNodes");
  const maxBytes = readOwnOption(inspectedOptions, "maxBytes");
  const sortObjectKeys = readOwnOption(inspectedOptions, "sortObjectKeys");
  if (sortObjectKeys !== undefined && typeof sortObjectKeys !== "boolean") {
    throw new NativeTypeError("Provider JSON snapshot sortObjectKeys must be a boolean");
  }
  const dropUndefinedMembers = readOwnOption(inspectedOptions, "dropUndefinedMembers");
  if (dropUndefinedMembers !== undefined && typeof dropUndefinedMembers !== "boolean") {
    throw new NativeTypeError("Provider JSON snapshot dropUndefinedMembers must be a boolean");
  }
  return {
    maxDepth: readLimit(maxDepth, DEFAULT_MAX_DEPTH, "maxDepth", 0),
    maxNodes: readLimit(maxNodes, DEFAULT_MAX_NODES, "maxNodes", 1),
    maxBytes: readLimit(maxBytes, DEFAULT_MAX_BYTES, "maxBytes", 1),
    sortObjectKeys: sortObjectKeys ?? true,
    dropUndefinedMembers: dropUndefinedMembers ?? false,
  };
}

function addBytes(state: SnapshotState, bytes: number): void {
  if (bytes > state.maxBytes - state.bytes) {
    invalidValue(`exceeded ${state.maxBytes} UTF-8 bytes`);
  }
  state.bytes += bytes;
}

/**
 * Count the exact UTF-8 bytes used by JSON.stringify for a primitive string
 * without allocating an encoded copy of caller-controlled text.
 */
function addJsonStringBytes(state: SnapshotState, value: string): void {
  addBytes(state, 2); // Opening and closing quotation marks.

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = charCodeAt(value, index);

    if (codeUnit === 0x22 || codeUnit === 0x5c) {
      addBytes(state, 2);
      continue;
    }
    if (codeUnit <= 0x1f) {
      addBytes(
        state,
        codeUnit === 0x08 ||
          codeUnit === 0x09 ||
          codeUnit === 0x0a ||
          codeUnit === 0x0c ||
          codeUnit === 0x0d
          ? 2
          : 6,
      );
      continue;
    }
    if (codeUnit <= 0x7f) {
      addBytes(state, 1);
      continue;
    }
    if (codeUnit <= 0x7ff) {
      addBytes(state, 2);
      continue;
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = charCodeAt(value, index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        addBytes(state, 4);
        index += 1;
      } else {
        // Well-formed JSON.stringify escapes lone surrogates as "\\udxxx".
        addBytes(state, 6);
      }
      continue;
    }
    if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      addBytes(state, 6);
      continue;
    }
    addBytes(state, 3);
  }
}

function assertRawJsonTextWithinByteLimit(value: string, maxBytes: number): void {
  let bytes = 0;
  const add = (count: number): void => {
    if (count > maxBytes - bytes) {
      invalidValue(`JSON text exceeded ${maxBytes} UTF-8 bytes`);
    }
    bytes += count;
  };

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = charCodeAt(value, index);
    if (codeUnit <= 0x7f) {
      add(1);
      continue;
    }
    if (codeUnit <= 0x7ff) {
      add(2);
      continue;
    }
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = charCodeAt(value, index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        add(4);
        index += 1;
      } else {
        // TextEncoder replaces a lone surrogate with the three-byte U+FFFD.
        add(3);
      }
      continue;
    }
    add(3);
  }
}

function inspectPrototype(value: Record<string, unknown> | unknown[]): object | null {
  try {
    return objectGetPrototypeOf(value);
  } catch {
    invalidValue("could not inspect a value");
  }
}

function inspectOwnKeys(value: Record<string, unknown> | unknown[]): (string | symbol)[] {
  try {
    return ownKeys(value);
  } catch {
    invalidValue("could not inspect a value");
  }
}

function inspectOwnDescriptor(
  value: Record<string, unknown> | unknown[],
  key: string | symbol,
): PropertyDescriptor {
  try {
    const descriptor = objectGetOwnPropertyDescriptor(value, key);
    if (descriptor === undefined) {
      invalidValue("changed while it was being inspected");
    }
    return descriptor;
  } catch {
    invalidValue("could not inspect a value");
  }
}

function readDataProperty(
  value: Record<string, unknown> | unknown[],
  key: string,
  requireEnumerable: boolean,
): unknown {
  const descriptor = inspectOwnDescriptor(value, key);
  if (
    !hasOwn(descriptor, "value") ||
    (requireEnumerable && descriptor.enumerable !== true)
  ) {
    invalidValue("must contain only enumerable data properties");
  }
  return descriptor.value;
}

function beginValue(state: SnapshotState, depth: number): void {
  if (depth > state.maxDepth) {
    invalidValue(`exceeded maximum depth ${state.maxDepth}`);
  }
  if (state.nodes >= state.maxNodes) {
    invalidValue(`exceeded ${state.maxNodes} nodes`);
  }
  state.nodes += 1;
}

function snapshotArray(
  value: unknown[],
  depth: number,
  state: SnapshotState,
): readonly JsonSnapshotValue[] {
  if (inspectPrototype(value) !== NativeArrayPrototype) {
    invalidValue("arrays must use the intrinsic Array prototype");
  }

  const lengthDescriptor = inspectOwnDescriptor(value, "length");
  if (
    !hasOwn(lengthDescriptor, "value") ||
    lengthDescriptor.enumerable !== false ||
    lengthDescriptor.configurable !== false ||
    !numberIsSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    invalidValue("contained an invalid array length");
  }
  const length = lengthDescriptor.value as number;

  // Each dense element consumes at least one node. Reject oversized arrays
  // before asking the engine to materialize their complete own-key list.
  if (length > state.maxNodes - state.nodes) {
    invalidValue(`exceeded ${state.maxNodes} nodes`);
  }

  const keys = inspectOwnKeys(value);
  const ownedSnapshot = hasWeakSetValue(OWNED_ARRAY_SNAPSHOTS, value);
  if (keys.length !== length + 1 + (ownedSnapshot ? 1 : 0)) {
    invalidValue("arrays must be dense and contain no extra properties");
  }

  const elementValues: unknown[] = new NativeArray(length);
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex]!;
    if (key === "length") {
      continue;
    }
    if (key === "toJSON" && ownedSnapshot) {
      const descriptor = inspectOwnDescriptor(value, key);
      if (
        !hasOwn(descriptor, "value") ||
        descriptor.value !== undefined ||
        descriptor.configurable !== false ||
        descriptor.enumerable !== false ||
        descriptor.writable !== false
      ) {
        invalidValue("contained an invalid serialization guard");
      }
      continue;
    }
    if (typeof key !== "string") {
      invalidValue("must not contain symbol properties");
    }
    const index = numberFromValue(key);
    if (
      !numberIsInteger(index) ||
      index < 0 ||
      index >= length ||
      stringFromValue(index) !== key
    ) {
      invalidValue("arrays must be dense and contain no extra properties");
    }
    defineArrayElement(elementValues, index, readDataProperty(value, key, true));
  }

  addBytes(state, 1);
  const snapshot: JsonSnapshotValue[] = [];
  for (let index = 0; index < length; index += 1) {
    if (index > 0) {
      addBytes(state, 1);
    }
    const element = elementValues[index];
    defineArrayElement(
      snapshot,
      index,
      snapshotValue(
        element === undefined && state.dropUndefinedMembers ? null : element,
        depth + 1,
        state,
      ),
    );
  }
  addBytes(state, 1);
  objectDefineProperty(snapshot, "toJSON", {
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
  addWeakSetValue(OWNED_ARRAY_SNAPSHOTS, snapshot);
  return objectFreeze(snapshot);
}

function snapshotObject(
  value: Record<string, unknown>,
  depth: number,
  state: SnapshotState,
): { readonly [key: string]: JsonSnapshotValue } {
  const prototype = inspectPrototype(value);
  if (prototype !== NativeObjectPrototype && prototype !== null) {
    invalidValue("objects must have a plain or null prototype");
  }

  const keys = inspectOwnKeys(value);
  if (keys.length > state.maxNodes - state.nodes) {
    invalidValue(`exceeded ${state.maxNodes} nodes`);
  }
  const entries: { key: string; value: unknown }[] = [];
  for (let keyIndex = 0; keyIndex < keys.length; keyIndex += 1) {
    const key = keys[keyIndex]!;
    if (typeof key !== "string") {
      invalidValue("must not contain symbol properties");
    }
    // Read through the descriptor first so accessors still fail closed.
    const propertyValue = readDataProperty(value, key, true);
    if (propertyValue === undefined && state.dropUndefinedMembers) {
      continue;
    }
    defineArrayElement(entries, entries.length, {
      key,
      value: propertyValue,
    });
  }
  if (state.sortObjectKeys) {
    apply(arraySort, entries, [
      (left: { key: string }, right: { key: string }) =>
        left.key < right.key ? -1 : left.key > right.key ? 1 : 0,
    ]);
  }

  addBytes(state, 1);
  const snapshot = objectCreate(null) as Record<string, JsonSnapshotValue>;
  for (let index = 0; index < entries.length; index += 1) {
    if (index > 0) {
      addBytes(state, 1);
    }
    const entry = entries[index]!;
    addJsonStringBytes(state, entry.key);
    addBytes(state, 1);
    objectDefineProperty(snapshot, entry.key, {
      configurable: false,
      enumerable: true,
      value: snapshotValue(entry.value, depth + 1, state),
      writable: false,
    });
  }
  addBytes(state, 1);
  return objectFreeze(snapshot);
}

function snapshotValue(
  value: unknown,
  depth: number,
  state: SnapshotState,
): JsonSnapshotValue {
  beginValue(state, depth);

  if (value === null) {
    addBytes(state, 4);
    return null;
  }

  switch (typeof value) {
    case "boolean":
      addBytes(state, value ? 4 : 5);
      return value;
    case "string":
      addJsonStringBytes(state, value);
      return value;
    case "number":
      if (!numberIsFinite(value)) {
        invalidValue("numbers must be finite");
      }
      if (objectIs(value, -0)) {
        addBytes(state, 1);
        return 0;
      }
      addBytes(state, stringFromValue(value).length);
      return value;
    case "object": {
      const objectValue = value as object;
      if (!state.valuesAreOwned) {
        if (!canIdentifyProxyWithoutHooks) {
          invalidValue("cannot inspect object values without Proxy detection");
        }
        if (isProxyWithoutHooks(objectValue)) {
          invalidValue("must not contain Proxy values");
        }
      }
      if (hasWeakSetValue(state.ancestors, objectValue)) {
        invalidValue("must not contain cycles");
      }
      addWeakSetValue(state.ancestors, objectValue);
      try {
        if (ArrayIsArray(value)) {
          return snapshotArray(value, depth, state);
        }
        return snapshotObject(
          value as Record<string, unknown>,
          depth,
          state,
        );
      } finally {
        deleteWeakSetValue(state.ancestors, objectValue);
      }
    }
    default:
      invalidValue("contained a value without a JSON representation");
  }
}

function snapshotsEqual(
  left: JsonSnapshotValue,
  right: JsonSnapshotValue,
): boolean {
  if (left === right) {
    return true;
  }
  if (typeof left !== "object" || left === null) {
    return false;
  }
  if (typeof right !== "object" || right === null) {
    return false;
  }

  const leftIsArray = ArrayIsArray(left);
  if (leftIsArray !== ArrayIsArray(right)) {
    return false;
  }
  if (leftIsArray) {
    const leftArray = left as readonly JsonSnapshotValue[];
    const rightArray = right as readonly JsonSnapshotValue[];
    if (leftArray.length !== rightArray.length) {
      return false;
    }
    for (let index = 0; index < leftArray.length; index += 1) {
      if (!snapshotsEqual(leftArray[index]!, rightArray[index]!)) {
        return false;
      }
    }
    return true;
  }

  const leftObject = left as { readonly [key: string]: JsonSnapshotValue };
  const rightObject = right as { readonly [key: string]: JsonSnapshotValue };
  const leftKeys = objectKeys(leftObject);
  const rightKeys = objectKeys(rightObject);
  if (leftKeys.length !== rightKeys.length) {
    return false;
  }
  for (let index = 0; index < leftKeys.length; index += 1) {
    const key = leftKeys[index]!;
    if (
      key !== rightKeys[index] ||
      !snapshotsEqual(leftObject[key]!, rightObject[key]!)
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Create a bounded, deeply owned, accessor-free snapshot of a JSON value.
 *
 * Traversal uses property descriptors instead of property reads, so getters
 * and `toJSON` methods are never invoked. Unsupported prototypes, accessors,
 * methods, symbols, sparse arrays, cycles, and non-JSON primitives fail
 * closed with a sanitized TypeError.
 */
export function snapshotJsonValue(
  value: unknown,
  options: JsonSnapshotOptions = {},
): JsonSnapshotValue {
  const resolved = resolveOptions(options);
  return snapshotValue(value, 0, {
    ...resolved,
    ancestors: new NativeWeakSet(),
    bytes: 0,
    nodes: 0,
    valuesAreOwned: false,
  });
}

/**
 * Create the provider-boundary snapshot used by request builders.
 *
 * Node-compatible runtimes use the strict descriptor walk above. Edge hosts
 * cannot distinguish Proxy objects before reflection, so they first cross the
 * captured structured-clone boundary. The host rejects Proxy values (including
 * nested Proxies) without running Proxy traps and returns a newly owned graph.
 * Ordinary accessors follow the host's structured-clone semantics; this is an
 * explicit edge-runtime compatibility trade-off because those hosts expose no
 * no-hook Proxy brand primitive.
 */
export function snapshotProviderJsonValue(
  value: unknown,
  options: JsonSnapshotOptions = {},
): JsonSnapshotValue {
  if (canIdentifyProxyWithoutHooks) {
    return snapshotJsonValue(value, options);
  }
  if (typeof structuredCloneValue !== "function") {
    invalidValue("cannot inspect object values without Proxy detection or structured clone");
  }

  const resolved = resolveOptions(options);
  let cloned: unknown;
  try {
    cloned = apply(structuredCloneValue, globalThis, [value]);
  } catch {
    invalidValue("could not cross the edge-runtime structured-clone boundary");
  }

  return snapshotValue(cloned, 0, {
    ...resolved,
    ancestors: new NativeWeakSet(),
    bytes: 0,
    nodes: 0,
    valuesAreOwned: true,
  });
}

/**
 * Compare JSON-compatible values independently of object key order.
 *
 * Provider runtimes sometimes expose tool input as JSON text while callers
 * retain the parsed value. Set `parseJsonStrings` only for that boundary: a
 * valid JSON string is then compared as its represented JSON value. Invalid,
 * unsafe, or over-budget values fail closed and compare unequal.
 */
export function jsonValuesEqual(
  left: unknown,
  right: unknown,
  parseJsonStrings = false,
): boolean {
  const normalize = (value: unknown): unknown => {
    if (!parseJsonStrings || typeof value !== "string") {
      return value;
    }
    assertRawJsonTextWithinByteLimit(value, DEFAULT_MAX_BYTES);
    try {
      return apply(jsonParse, undefined, [value]);
    } catch {
      // Preserve non-JSON text as a string for backwards compatibility.
      return value;
    }
  };

  try {
    return snapshotsEqual(
      snapshotProviderJsonValue(normalize(left)),
      snapshotProviderJsonValue(normalize(right)),
    );
  } catch {
    return false;
  }
}
