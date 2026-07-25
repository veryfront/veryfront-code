/** Maximum distinct provider-controlled tool calls accepted per model turn. */
export const MAX_RUNTIME_TOOL_CALLS = 128;

/** Maximum retained input size for one provider-controlled tool call. */
export const MAX_RUNTIME_TOOL_INPUT_BYTES = 1_048_576;

/** Maximum retained input size across all tool calls in one model turn. */
export const MAX_RUNTIME_AGGREGATE_TOOL_INPUT_BYTES = 8 * 1_048_576;

/** Maximum streamed deltas accepted for one tool input. */
export const MAX_RUNTIME_TOOL_INPUT_DELTAS = 4_096;

const MAX_RUNTIME_TOOL_INPUT_DEPTH = 64;
const MAX_RUNTIME_TOOL_INPUT_NODES = 65_536;
const OWNED_ARRAY_SNAPSHOTS = new WeakSet<object>();

export type RuntimeToolInputSnapshot =
  | {
    readonly exceedsLimit: false;
    readonly input: unknown;
    readonly byteLength: number;
  }
  | {
    readonly exceedsLimit: true;
    readonly byteLength: number;
  };

type SnapshotState = {
  readonly ancestors: WeakSet<object>;
  readonly maxBytes: number;
  bytes: number;
  nodes: number;
};

class ToolInputBudgetExceeded extends Error {}

function exceedBudget(): never {
  throw new ToolInputBudgetExceeded();
}

function invalidInput(reason: string): never {
  throw new TypeError(`Runtime tool input ${reason}`);
}

function addBytes(state: SnapshotState, amount: number): void {
  if (
    !Number.isSafeInteger(amount) ||
    amount < 0 ||
    amount > state.maxBytes - state.bytes
  ) {
    exceedBudget();
  }
  state.bytes += amount;
}

function utf8ByteLength(
  value: string,
  stopAfter: number,
  jsonString: boolean,
): number {
  let bytes = jsonString ? 2 : 0;
  for (let index = 0; index < value.length; index++) {
    const codeUnit = value.charCodeAt(index);
    if (jsonString && (codeUnit === 0x22 || codeUnit === 0x5c)) {
      bytes += 2;
    } else if (jsonString && codeUnit <= 0x1f) {
      bytes += codeUnit === 0x08 ||
          codeUnit === 0x09 ||
          codeUnit === 0x0a ||
          codeUnit === 0x0c ||
          codeUnit === 0x0d
        ? 2
        : 6;
    } else if (codeUnit <= 0x7f) {
      bytes += 1;
    } else if (codeUnit <= 0x7ff) {
      bytes += 2;
    } else if (
      codeUnit >= 0xd800 &&
      codeUnit <= 0xdbff
    ) {
      const low = value.charCodeAt(index + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4;
        index++;
      } else {
        bytes += jsonString ? 6 : 3;
      }
    } else if (jsonString && codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      bytes += 6;
    } else {
      bytes += 3;
    }

    if (bytes > stopAfter) return stopAfter + 1;
  }
  return bytes;
}

function addJsonStringBytes(state: SnapshotState, value: string): void {
  addBytes(
    state,
    utf8ByteLength(value, state.maxBytes - state.bytes, true),
  );
}

function inspectOwnDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  try {
    return Object.getOwnPropertyDescriptor(value, key);
  } catch {
    return invalidInput("could not be safely inspected");
  }
}

function inspectOwnKeys(value: object): (string | symbol)[] {
  try {
    return Reflect.ownKeys(value);
  } catch {
    return invalidInput("could not be safely inspected");
  }
}

function inspectPrototype(value: object): object | null {
  try {
    return Object.getPrototypeOf(value);
  } catch {
    return invalidInput("could not be safely inspected");
  }
}

function readDataProperty(descriptor: PropertyDescriptor): unknown {
  if (!Object.hasOwn(descriptor, "value")) {
    return invalidInput("must use inspectable data properties");
  }
  return descriptor.value;
}

function beginValue(state: SnapshotState, depth: number): void {
  if (depth > MAX_RUNTIME_TOOL_INPUT_DEPTH) {
    exceedBudget();
  }
  if (state.nodes >= MAX_RUNTIME_TOOL_INPUT_NODES) {
    exceedBudget();
  }
  state.nodes++;
}

function snapshotArray(
  value: unknown[],
  depth: number,
  state: SnapshotState,
): readonly unknown[] {
  if (inspectPrototype(value) !== Array.prototype) {
    return invalidInput("arrays must use the intrinsic Array prototype");
  }
  const lengthDescriptor = inspectOwnDescriptor(value, "length");
  if (lengthDescriptor === undefined) {
    return invalidInput("array length changed while it was inspected");
  }
  const length = readDataProperty(lengthDescriptor);
  if (
    typeof length !== "number" ||
    !Number.isSafeInteger(length) ||
    length < 0
  ) {
    return invalidInput("array length is invalid");
  }

  // One node and at least one encoded byte are required per element. Apply
  // both structural bounds before allocating the snapshot or inspecting any
  // numeric descriptor, then traverse indices incrementally.
  if (length > MAX_RUNTIME_TOOL_INPUT_NODES - state.nodes) {
    exceedBudget();
  }
  const minimumBytes = length === 0 ? 2 : 2 * length + 1;
  if (
    !Number.isSafeInteger(minimumBytes) ||
    minimumBytes > state.maxBytes - state.bytes
  ) {
    exceedBudget();
  }

  const keys = inspectOwnKeys(value);
  if (keys.length > MAX_RUNTIME_TOOL_INPUT_NODES + 2) {
    exceedBudget();
  }
  const descriptors = new Map<string, PropertyDescriptor>();
  const ownedSnapshot = OWNED_ARRAY_SNAPSHOTS.has(value);
  for (const key of keys) {
    if (key === "length") continue;
    if (key === "toJSON" && ownedSnapshot) {
      const descriptor = inspectOwnDescriptor(value, key);
      if (
        descriptor === undefined ||
        !Object.hasOwn(descriptor, "value") ||
        descriptor.value !== undefined ||
        descriptor.configurable !== false ||
        descriptor.enumerable !== false ||
        descriptor.writable !== false
      ) {
        return invalidInput("contained an invalid serialization guard");
      }
      continue;
    }
    if (typeof key !== "string") {
      return invalidInput("must not contain symbol properties");
    }
    const index = Number(key);
    if (
      !Number.isInteger(index) ||
      index < 0 ||
      index >= length ||
      String(index) !== key
    ) {
      return invalidInput("arrays must not contain extra properties");
    }
    const descriptor = inspectOwnDescriptor(value, key);
    if (descriptor === undefined || descriptor.enumerable !== true) {
      return invalidInput("array elements must be enumerable data properties");
    }
    readDataProperty(descriptor);
    descriptors.set(key, descriptor);
  }

  addBytes(state, 1);
  const snapshot: unknown[] = new Array(length);
  for (let index = 0; index < length; index++) {
    if (index > 0) addBytes(state, 1);
    const descriptor = descriptors.get(String(index));
    const element = descriptor === undefined ? null : readDataProperty(descriptor);
    snapshot[index] = snapshotValue(element, depth + 1, state);
  }
  addBytes(state, 1);

  // JSON.stringify consults an inherited Array.prototype.toJSON hook. Shadow
  // it on the owned snapshot so later lifecycle serialization stays inert.
  Object.defineProperty(snapshot, "toJSON", {
    configurable: false,
    enumerable: false,
    value: undefined,
    writable: false,
  });
  OWNED_ARRAY_SNAPSHOTS.add(snapshot);
  return Object.freeze(snapshot);
}

function snapshotObject(
  value: Record<string, unknown>,
  depth: number,
  state: SnapshotState,
): Readonly<Record<string, unknown>> {
  const prototype = inspectPrototype(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return invalidInput("objects must have a plain or null prototype");
  }
  const keys = inspectOwnKeys(value);
  if (keys.length > MAX_RUNTIME_TOOL_INPUT_NODES - state.nodes) {
    exceedBudget();
  }

  addBytes(state, 1);
  const snapshot = Object.create(null) as Record<string, unknown>;
  let retainedProperties = 0;
  for (const key of keys) {
    if (typeof key !== "string") {
      return invalidInput("must not contain symbol properties");
    }
    const descriptor = inspectOwnDescriptor(value, key);
    if (descriptor === undefined) {
      return invalidInput("changed while it was being inspected");
    }
    if (descriptor.enumerable !== true) {
      return invalidInput("object properties must be enumerable");
    }
    const propertyValue = readDataProperty(descriptor);
    if (
      propertyValue === undefined ||
      typeof propertyValue === "function" ||
      typeof propertyValue === "symbol"
    ) {
      return invalidInput("must contain only JSON-compatible values");
    }

    if (retainedProperties > 0) addBytes(state, 1);
    addJsonStringBytes(state, key);
    addBytes(state, 1);
    Object.defineProperty(snapshot, key, {
      configurable: false,
      enumerable: true,
      value: snapshotValue(propertyValue, depth + 1, state),
      writable: false,
    });
    retainedProperties++;
  }
  addBytes(state, 1);
  return Object.freeze(snapshot);
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
        return invalidInput("numbers must be finite");
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
        exceedBudget();
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
      return invalidInput("must contain only JSON-compatible values");
  }
}

/**
 * Create the canonical input retained at the runtime tool boundary.
 *
 * Ordinary string inputs remain raw JSON text for compatibility. Structured
 * inputs become deeply owned, frozen JSON projections using descriptor reads,
 * so validation and emission observe the same inert value without invoking
 * getters or serialization/coercion hooks.
 */
export function snapshotRuntimeToolInput(
  input: unknown,
  stopAfter = MAX_RUNTIME_TOOL_INPUT_BYTES,
): RuntimeToolInputSnapshot {
  if (!Number.isSafeInteger(stopAfter) || stopAfter < 0) {
    throw new TypeError("Runtime tool input byte limit must be a non-negative safe integer");
  }

  if (typeof input === "string") {
    const byteLength = utf8ByteLength(input, stopAfter, false);
    return byteLength > stopAfter
      ? { exceedsLimit: true, byteLength: stopAfter + 1 }
      : { exceedsLimit: false, input, byteLength };
  }

  const state: SnapshotState = {
    ancestors: new WeakSet(),
    maxBytes: stopAfter,
    bytes: 0,
    nodes: 0,
  };
  try {
    const snapshot = snapshotValue(input, 0, state);
    return {
      exceedsLimit: false,
      input: snapshot,
      byteLength: state.bytes,
    };
  } catch (error) {
    if (error instanceof ToolInputBudgetExceeded) {
      return { exceedsLimit: true, byteLength: stopAfter + 1 };
    }
    if (error instanceof TypeError && error.message.startsWith("Runtime tool input")) {
      throw error;
    }
    throw new TypeError("Runtime tool input could not be safely inspected");
  }
}

/**
 * Measure one tool input while applying the same canonicalization and
 * inspection rules used by the runtime bridge.
 */
export function runtimeToolInputByteLength(
  input: unknown,
  stopAfter = MAX_RUNTIME_TOOL_INPUT_BYTES,
): number {
  return snapshotRuntimeToolInput(input, stopAfter).byteLength;
}
