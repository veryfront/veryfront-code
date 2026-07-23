import { serverLogger } from "#veryfront/utils";

const logger = serverLogger.component("rsc");
const UNSAFE_PROP_NAME_CHARACTERS = "\"'`=<>/";
const EVENT_HANDLER_PROP = /^on[a-z]/i;
const PROTOTYPE_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_SERIALIZATION_DEPTH = 100;
const MAX_SERIALIZATION_NODES = 10_000;
const MAX_TOP_LEVEL_PROPS = 10_000;
const INVALID = Symbol("invalid-serialized-prop");

interface SerializationState {
  active: WeakSet<object>;
  nodes: number;
}

export function isSafeSerializedPropName(name: string): boolean {
  if (name.length === 0 || EVENT_HANDLER_PROP.test(name) || PROTOTYPE_KEYS.has(name)) {
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

export function serializeProps(props: Record<string, unknown>): Record<string, unknown> {
  return sanitizeRecord(props, true);
}

export function stringifyProps(props: Record<string, unknown>): string {
  return JSON.stringify(sanitizeRecord(props, false));
}

function sanitizeRecord(
  props: Record<string, unknown>,
  skipChildren: boolean,
): Record<string, unknown> {
  const serializable: Record<string, unknown> = {};
  const state: SerializationState = { active: new WeakSet(), nodes: 0 };
  let descriptors: Record<string, PropertyDescriptor>;

  try {
    descriptors = Object.getOwnPropertyDescriptors(props);
  } catch {
    logger.warn("Skipping props that could not be inspected safely");
    return serializable;
  }

  let inspected = 0;
  let skipped = 0;
  let truncated = false;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (inspected++ >= MAX_TOP_LEVEL_PROPS) {
      truncated = true;
      break;
    }
    if (!descriptor.enumerable || (skipChildren && key === "children")) continue;
    if (!isSafeSerializedPropName(key)) {
      skipped++;
      continue;
    }
    if (!("value" in descriptor)) {
      skipped++;
      continue;
    }

    const value = cloneSerializableValue(descriptor.value, state, 0);
    if (value === INVALID) {
      skipped++;
      continue;
    }

    // Define data properties explicitly so special names can never trigger a
    // prototype setter, even if the name validation changes later.
    Object.defineProperty(serializable, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  if (skipped > 0 || truncated) {
    logger.warn("Skipped props that are unsafe or not serializable", {
      skipped,
      truncated,
    });
  }

  return serializable;
}

function cloneSerializableValue(
  value: unknown,
  state: SerializationState,
  depth: number,
): unknown | typeof INVALID {
  if (depth > MAX_SERIALIZATION_DEPTH || state.nodes >= MAX_SERIALIZATION_NODES) return INVALID;
  state.nodes++;

  if (value === null) return null;

  switch (typeof value) {
    case "string":
    case "boolean":
      return value;
    case "number":
      return Number.isFinite(value) ? value : INVALID;
    case "undefined":
    case "function":
    case "symbol":
    case "bigint":
      return INVALID;
    case "object":
      break;
    default:
      return INVALID;
  }

  const object = value as object;
  if (state.active.has(object)) return INVALID;

  const prototype = Object.getPrototypeOf(object);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    return INVALID;
  }

  state.active.add(object);
  try {
    if (Array.isArray(value)) {
      const result: unknown[] = [];
      for (const item of value) {
        const cloned = cloneSerializableValue(item, state, depth + 1);
        if (cloned === INVALID) return INVALID;
        result.push(cloned);
      }
      return result;
    }

    const result: Record<string, unknown> = {};
    let descriptors: Record<string, PropertyDescriptor>;
    try {
      descriptors = Object.getOwnPropertyDescriptors(object);
    } catch {
      return INVALID;
    }

    for (const [key, descriptor] of Object.entries(descriptors)) {
      if (!descriptor.enumerable || PROTOTYPE_KEYS.has(key)) continue;
      if (!("value" in descriptor)) continue;

      const cloned = cloneSerializableValue(descriptor.value, state, depth + 1);
      if (cloned === INVALID) return INVALID;
      Object.defineProperty(result, key, {
        configurable: true,
        enumerable: true,
        value: cloned,
        writable: true,
      });
    }

    return result;
  } finally {
    state.active.delete(object);
  }
}
