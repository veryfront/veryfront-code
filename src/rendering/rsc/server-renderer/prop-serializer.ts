import { serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("rsc");
const UNSAFE_PROP_NAME_CHARACTERS = "\"'`=<>/";
const EVENT_HANDLER_PROP = /^on[a-z]/i;
const MAX_PROP_NAME_LENGTH = 1_024;
const MAX_PROP_PROPERTIES = 1_024;
const MAX_PROP_DEPTH = 64;
const MAX_PROP_NODES = 10_000;
const MAX_PROP_BYTES = 1024 * 1024;

class NonSerializablePropError extends TypeError {}

type SnapshotState = {
  ancestors: WeakSet<object>;
  bytes: number;
  nodes: number;
};

export function isSafeSerializedPropName(name: string): boolean {
  if (
    name.length === 0 ||
    name.length > MAX_PROP_NAME_LENGTH ||
    EVENT_HANDLER_PROP.test(name)
  ) {
    return false;
  }

  for (const character of name) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || UNSAFE_PROP_NAME_CHARACTERS.includes(character)) {
      return false;
    }
  }

  return true;
}

export function serializeProps(
  props: Record<string, unknown>,
): Record<string, unknown> {
  return snapshotProps(props, true);
}

export function stringifyProps(props: Record<string, unknown>): string {
  const serialized = JSON.stringify(snapshotProps(props, false));
  assertRawUtf8Size(serialized);
  return serialized;
}

function snapshotProps(
  props: Record<string, unknown>,
  skipChildren: boolean,
): Record<string, unknown> {
  const prototype = inspectPrototype(props);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError("RSC props must use a plain or null prototype");
  }

  const keys = inspectOwnKeys(props);
  if (keys.length > MAX_PROP_PROPERTIES) {
    throw new RangeError(
      `RSC prop property limit of ${MAX_PROP_PROPERTIES} was exceeded`,
    );
  }

  const state: SnapshotState = {
    ancestors: new WeakSet(),
    bytes: 2,
    nodes: 1,
  };
  const snapshot: Record<string, unknown> = {};
  let acceptedProperties = 0;
  let skippedProperties = 0;

  for (const key of keys) {
    if (typeof key !== "string") {
      skippedProperties += 1;
      continue;
    }

    const descriptor = inspectOwnDescriptor(props, key);
    if (descriptor.enumerable !== true) continue;
    if (skipChildren && key === "children") continue;
    if (
      !isSafeSerializedPropName(key) ||
      !Object.hasOwn(descriptor, "value")
    ) {
      skippedProperties += 1;
      continue;
    }

    const previousBytes = state.bytes;
    const previousNodes = state.nodes;
    try {
      if (acceptedProperties > 0) addBytes(state, 1);
      addJsonStringBytes(state, key);
      addBytes(state, 1);

      const value = descriptor.value === undefined
        ? snapshotTopLevelUndefined(state)
        : snapshotValue(descriptor.value, 0, state);
      defineDataProperty(snapshot, key, value);
      acceptedProperties += 1;
    } catch (error) {
      if (!(error instanceof NonSerializablePropError)) throw error;
      state.bytes = previousBytes;
      state.nodes = previousNodes;
      skippedProperties += 1;
    }
  }

  installSerializationGuard(snapshot);
  if (skippedProperties > 0) {
    logger.warn("Skipped unsafe or non-serializable RSC props", {
      count: skippedProperties,
    });
  }
  return snapshot;
}

function snapshotTopLevelUndefined(state: SnapshotState): undefined {
  beginValue(state, 0);
  // Undefined object properties are omitted by JSON.stringify. Count a
  // conservative token so retained property metadata still consumes budget.
  addBytes(state, 4);
  return undefined;
}

function snapshotValue(
  value: unknown,
  depth: number,
  state: SnapshotState,
): unknown {
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
      if (!Number.isFinite(value)) {
        throw new NonSerializablePropError();
      }
      if (Object.is(value, -0)) {
        addBytes(state, 1);
        return 0;
      }
      addBytes(state, String(value).length);
      return value;
    case "object": {
      const objectValue = value as object;
      if (state.ancestors.has(objectValue)) {
        throw new NonSerializablePropError();
      }

      state.ancestors.add(objectValue);
      try {
        return Array.isArray(value) ? snapshotArray(value, depth, state) : snapshotObject(
          value as Record<string, unknown>,
          depth,
          state,
        );
      } finally {
        state.ancestors.delete(objectValue);
      }
    }
    default:
      throw new NonSerializablePropError();
  }
}

function snapshotArray(
  value: unknown[],
  depth: number,
  state: SnapshotState,
): unknown[] {
  if (inspectPrototype(value) !== Array.prototype) {
    throw new NonSerializablePropError();
  }

  const lengthDescriptor = inspectOwnDescriptor(value, "length");
  if (
    !Object.hasOwn(lengthDescriptor, "value") ||
    lengthDescriptor.enumerable !== false ||
    lengthDescriptor.configurable !== false ||
    !Number.isSafeInteger(lengthDescriptor.value) ||
    lengthDescriptor.value < 0
  ) {
    throw new NonSerializablePropError();
  }

  const length = lengthDescriptor.value as number;
  if (length > MAX_PROP_NODES - state.nodes) {
    throw new RangeError(`RSC prop node limit of ${MAX_PROP_NODES} was exceeded`);
  }

  const keys = inspectOwnKeys(value);
  if (keys.length < length + 1 || keys.length > length + 2) {
    throw new NonSerializablePropError();
  }

  const sourceValues: unknown[] = new Array(length);
  let indexCount = 0;
  let serializationGuardCount = 0;
  for (const key of keys) {
    if (key === "length") continue;
    const descriptor = inspectOwnDescriptor(value, key);
    if (isSerializationGuard(key, descriptor)) {
      serializationGuardCount += 1;
      continue;
    }
    if (typeof key !== "string") throw new NonSerializablePropError();

    const index = Number(key);
    if (
      !Number.isSafeInteger(index) ||
      index < 0 ||
      index >= length ||
      String(index) !== key
    ) {
      throw new NonSerializablePropError();
    }

    if (
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, "value")
    ) {
      throw new NonSerializablePropError();
    }
    sourceValues[index] = descriptor.value;
    indexCount += 1;
  }
  if (
    indexCount !== length ||
    serializationGuardCount > 1 ||
    keys.length !== length + 1 + serializationGuardCount
  ) {
    throw new NonSerializablePropError();
  }

  addBytes(state, 1);
  const snapshot = new Array<unknown>(length);
  for (let index = 0; index < length; index += 1) {
    if (index > 0) addBytes(state, 1);
    snapshot[index] = snapshotValue(sourceValues[index], depth + 1, state);
  }
  addBytes(state, 1);
  installSerializationGuard(snapshot);
  return snapshot;
}

function snapshotObject(
  value: Record<string, unknown>,
  depth: number,
  state: SnapshotState,
): Record<string, unknown> {
  const prototype = inspectPrototype(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new NonSerializablePropError();
  }

  const keys = inspectOwnKeys(value);
  if (keys.length > MAX_PROP_NODES - state.nodes) {
    throw new RangeError(`RSC prop node limit of ${MAX_PROP_NODES} was exceeded`);
  }

  addBytes(state, 1);
  const snapshot: Record<string, unknown> = {};
  let propertyIndex = 0;
  for (const key of keys) {
    const descriptor = inspectOwnDescriptor(value, key);
    if (isSerializationGuard(key, descriptor)) continue;
    if (typeof key !== "string") throw new NonSerializablePropError();
    if (
      descriptor.enumerable !== true ||
      !Object.hasOwn(descriptor, "value")
    ) {
      throw new NonSerializablePropError();
    }

    if (propertyIndex > 0) addBytes(state, 1);
    addJsonStringBytes(state, key);
    addBytes(state, 1);
    defineDataProperty(
      snapshot,
      key,
      snapshotValue(descriptor.value, depth + 1, state),
    );
    propertyIndex += 1;
  }
  addBytes(state, 1);
  installSerializationGuard(snapshot);
  return snapshot;
}

function beginValue(state: SnapshotState, depth: number): void {
  if (depth > MAX_PROP_DEPTH) {
    throw new RangeError(`RSC prop depth limit of ${MAX_PROP_DEPTH} was exceeded`);
  }
  if (state.nodes >= MAX_PROP_NODES) {
    throw new RangeError(`RSC prop node limit of ${MAX_PROP_NODES} was exceeded`);
  }
  state.nodes += 1;
}

function addBytes(state: SnapshotState, bytes: number): void {
  if (bytes > MAX_PROP_BYTES - state.bytes) {
    throw new RangeError(`RSC prop byte limit of ${MAX_PROP_BYTES} was exceeded`);
  }
  state.bytes += bytes;
}

function addJsonStringBytes(state: SnapshotState, value: string): void {
  addBytes(state, 2);

  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
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
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        addBytes(state, 4);
        index += 1;
      } else {
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

function inspectPrototype(value: object): object | null {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    throw new NonSerializablePropError();
  }
}

function inspectOwnKeys(value: object): (string | symbol)[] {
  try {
    return Reflect.ownKeys(value);
  } catch {
    throw new NonSerializablePropError();
  }
}

function inspectOwnDescriptor(
  value: object,
  key: string | symbol,
): PropertyDescriptor {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor) throw new NonSerializablePropError();
    return descriptor;
  } catch (error) {
    if (error instanceof NonSerializablePropError) throw error;
    throw new NonSerializablePropError();
  }
}

function defineDataProperty(
  target: object,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function installSerializationGuard(target: object): void {
  if (Object.hasOwn(target, "toJSON")) return;
  Object.defineProperty(target, "toJSON", {
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
}

function isSerializationGuard(
  key: string | symbol,
  descriptor: PropertyDescriptor,
): boolean {
  return key === "toJSON" &&
    descriptor.configurable === false &&
    descriptor.enumerable === false &&
    descriptor.writable === false &&
    Object.hasOwn(descriptor, "value") &&
    descriptor.value === undefined;
}

function assertRawUtf8Size(value: string): void {
  let bytes = 0;
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        index += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }

    if (bytes > MAX_PROP_BYTES) {
      throw new RangeError(`RSC prop byte limit of ${MAX_PROP_BYTES} was exceeded`);
    }
  }
}
