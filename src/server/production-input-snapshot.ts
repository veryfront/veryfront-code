import { validateVeryfrontConfig, type VeryfrontConfig } from "#veryfront/config";
import { ensureBuiltinSchemaValidator } from "#veryfront/extensions/builtin-schema-validator.ts";
import { isAbsolute, normalize } from "#veryfront/compat/path/index.ts";
import {
  isProxyWithoutHooks,
  isUint8ArrayWithoutHooks,
} from "#veryfront/platform/compat/error-introspection.ts";
import {
  hasProjectIdentityControlCharacters,
  isCanonicalProjectSlug,
} from "#veryfront/utils/project-identity.ts";

const ArrayIsArray = Array.isArray;
const ArrayPrototype = Array.prototype;
const IntrinsicArray = Array;
const IntrinsicUint8Array = Uint8Array;
const ObjectCreate = Object.create;
const ObjectDefineProperty = Object.defineProperty;
const ObjectFreeze = Object.freeze;
const ObjectGetOwnPropertyDescriptors = Object.getOwnPropertyDescriptors;
const ObjectGetPrototypeOf = Object.getPrototypeOf;
const ObjectPrototype = Object.prototype;
const ReflectOwnKeys = Reflect.ownKeys;
const WeakMapGet = WeakMap.prototype.get;
const WeakMapSet = WeakMap.prototype.set;
const WeakSetAdd = WeakSet.prototype.add;
const WeakSetDelete = WeakSet.prototype.delete;
const WeakSetHas = WeakSet.prototype.has;
const apply = Reflect.apply;
const isProxy = isProxyWithoutHooks;
const isUint8Array = isUint8ArrayWithoutHooks;

const MAX_SNAPSHOT_DEPTH = 64;
const MAX_SNAPSHOT_NODES = 50_000;
const MAX_SNAPSHOT_PROPERTIES = 100_000;
const MAX_SNAPSHOT_ARRAY_LENGTH = 10_000;
const MAX_LOCAL_PROJECTS = 1_000;
const LOCAL_PROJECT_SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

type SnapshotMode =
  | "config-root"
  | "default"
  | "extension"
  | "extension-provides"
  | "extensions"
  | "opaque";

interface SnapshotState {
  readonly ancestors: WeakSet<object>;
  readonly clones: WeakMap<object, unknown>;
  nodes: number;
  properties: number;
}

function snapshotError(path: string, reason: string, cause?: unknown): TypeError {
  return new TypeError(
    `Invalid production startup snapshot at ${path}: ${reason}`,
    cause === undefined ? undefined : { cause },
  );
}

function accountNode(state: SnapshotState, path: string, depth: number): void {
  if (depth > MAX_SNAPSHOT_DEPTH) {
    throw snapshotError(path, `depth exceeds ${MAX_SNAPSHOT_DEPTH}`);
  }
  state.nodes++;
  if (state.nodes > MAX_SNAPSHOT_NODES) {
    throw snapshotError(path, `value count exceeds ${MAX_SNAPSHOT_NODES}`);
  }
}

function accountProperties(state: SnapshotState, count: number, path: string): void {
  if (count > MAX_SNAPSHOT_PROPERTIES - state.properties) {
    throw snapshotError(path, `property count exceeds ${MAX_SNAPSHOT_PROPERTIES}`);
  }
  state.properties += count;
}

function childPath(path: string, key: string): string {
  return `${path}[${JSON.stringify(key)}]`;
}

function inspectObject(
  value: object,
  path: string,
): {
  prototype: object | null;
  descriptors: Record<PropertyKey, PropertyDescriptor>;
} {
  try {
    if (isProxy(value)) {
      throw snapshotError(path, "proxies are not supported");
    }
    return {
      prototype: ObjectGetPrototypeOf(value),
      descriptors: ObjectGetOwnPropertyDescriptors(value),
    };
  } catch (cause) {
    if (cause instanceof TypeError && cause.message.startsWith("Invalid production startup")) {
      throw cause;
    }
    throw snapshotError(path, "value could not be inspected", cause);
  }
}

function defineSnapshotValue(target: object, key: string, value: unknown): void {
  ObjectDefineProperty(target, key, {
    configurable: false,
    enumerable: true,
    value,
    writable: false,
  });
}

function enterContainer(state: SnapshotState, value: object, path: string): void {
  if (apply(WeakSetHas, state.ancestors, [value])) {
    throw snapshotError(path, "cyclic references are not supported");
  }
  apply(WeakSetAdd, state.ancestors, [value]);
}

function leaveContainer(state: SnapshotState, value: object): void {
  apply(WeakSetDelete, state.ancestors, [value]);
}

function snapshotArray(
  value: unknown[],
  path: string,
  depth: number,
  state: SnapshotState,
  descriptors: Record<PropertyKey, PropertyDescriptor>,
  mode: SnapshotMode,
): readonly unknown[] {
  if (value.length > MAX_SNAPSHOT_ARRAY_LENGTH) {
    throw snapshotError(path, `array length exceeds ${MAX_SNAPSHOT_ARRAY_LENGTH}`);
  }

  const keys = ReflectOwnKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol")) {
    throw snapshotError(path, "symbol properties are not supported");
  }
  if (keys.length !== value.length + 1 || descriptors.length === undefined) {
    throw snapshotError(path, "arrays must be dense and contain no extra properties");
  }

  const output = new IntrinsicArray(value.length);
  apply(WeakMapSet, state.clones, [value, output]);
  accountProperties(state, value.length, path);

  for (let index = 0; index < value.length; index++) {
    const key = String(index);
    const descriptor = descriptors[key];
    if (!descriptor?.enumerable || !("value" in descriptor)) {
      throw snapshotError(childPath(path, key), "accessor properties are not supported");
    }
    defineSnapshotValue(
      output,
      key,
      snapshotValue(
        descriptor.value,
        childPath(path, key),
        depth + 1,
        state,
        mode === "extensions" ? "extension" : "default",
      ),
    );
  }

  return ObjectFreeze(output);
}

function snapshotRecord(
  value: object,
  path: string,
  depth: number,
  state: SnapshotState,
  descriptors: Record<PropertyKey, PropertyDescriptor>,
  mode: SnapshotMode,
): Readonly<Record<string, unknown>> {
  const keys = ReflectOwnKeys(descriptors);
  if (keys.some((key) => typeof key === "symbol")) {
    throw snapshotError(path, "symbol properties are not supported");
  }
  accountProperties(state, keys.length, path);

  const output = ObjectCreate(null) as Record<string, unknown>;
  apply(WeakMapSet, state.clones, [value, output]);

  for (const rawKey of keys) {
    const key = rawKey as string;
    const descriptor = descriptors[key]!;
    if (!descriptor.enumerable) {
      throw snapshotError(childPath(path, key), "non-enumerable properties are not supported");
    }
    if (!("value" in descriptor)) {
      throw snapshotError(childPath(path, key), "accessor properties are not supported");
    }
    const childMode: SnapshotMode = mode === "config-root" && key === "extensions"
      ? "extensions"
      : mode === "extension" && key === "extends"
      ? "extensions"
      : mode === "extension" && key === "provides"
      ? "extension-provides"
      : mode === "extension-provides"
      ? "opaque"
      : "default";
    defineSnapshotValue(
      output,
      key,
      snapshotValue(descriptor.value, childPath(path, key), depth + 1, state, childMode),
    );
  }

  return ObjectFreeze(output);
}

function snapshotValue(
  value: unknown,
  path: string,
  depth: number,
  state: SnapshotState,
  mode: SnapshotMode,
): unknown {
  accountNode(state, path, depth);

  // Contract implementations are generation-owned opaque values. Preserve
  // their full `unknown` value domain by identity, while still refusing
  // object/callable proxies whose behavior can change behind the snapshot.
  if (mode === "opaque") {
    if (
      ((typeof value === "object" && value !== null) || typeof value === "function") &&
      isProxy(value)
    ) {
      throw snapshotError(path, "proxies are not supported");
    }
    return value;
  }

  if (value === null || value === undefined || typeof value === "boolean") return value;
  if (typeof value === "number") return value;
  if (typeof value === "string") return value;
  if (typeof value === "function") {
    if (isProxy(value)) throw snapshotError(path, "proxies are not supported");
    return value;
  }
  if (typeof value !== "object") {
    throw snapshotError(path, `${typeof value} values are not supported`);
  }

  if (isProxy(value)) throw snapshotError(path, "proxies are not supported");
  if (apply(WeakSetHas, state.ancestors, [value])) {
    throw snapshotError(path, "cyclic references are not supported");
  }
  const existing = apply(WeakMapGet, state.clones, [value]);
  if (existing !== undefined) return existing;

  if (isUint8Array(value)) {
    const output = new IntrinsicUint8Array(value);
    apply(WeakMapSet, state.clones, [value, output]);
    return output;
  }

  enterContainer(state, value, path);
  try {
    const { prototype, descriptors } = inspectObject(value, path);
    if (ArrayIsArray(value)) {
      if (prototype !== ArrayPrototype) {
        throw snapshotError(path, "array subclasses are not supported");
      }
      return snapshotArray(value, path, depth, state, descriptors, mode);
    }
    if (prototype !== ObjectPrototype && prototype !== null) {
      throw snapshotError(path, "only plain objects are supported");
    }
    return snapshotRecord(value, path, depth, state, descriptors, mode);
  } finally {
    leaveContainer(state, value);
  }
}

function snapshotGraph(
  value: unknown,
  path: string,
  mode: SnapshotMode = "default",
): unknown {
  return snapshotValue(value, path, 0, {
    ancestors: new WeakSet<object>(),
    clones: new WeakMap<object, unknown>(),
    nodes: 0,
    properties: 0,
  }, mode);
}

/**
 * Build a schema-canonical production configuration generation.
 *
 * Plain records and arrays are detached from the caller and structurally
 * frozen. Uint8Array values are copied but their copied elements remain
 * mutable. Callable values and `extensions[].provides` implementations are
 * generation-owned opaque capabilities: their identity and internal mutable
 * state are intentionally preserved.
 *
 * The BootstrapResult contract supplies a loader-canonical config whose
 * framework defaults are already merged. This boundary still re-snapshots the
 * schema parser's returned value so future schema transforms/defaults remain
 * authoritative rather than being validated and discarded.
 */
export function snapshotProductionConfig(value: unknown): VeryfrontConfig {
  const detachedInput = snapshotGraph(value, "config", "config-root");
  ensureBuiltinSchemaValidator();
  const canonicalConfig = validateVeryfrontConfig(detachedInput);
  return snapshotGraph(canonicalConfig, "config", "config-root") as VeryfrontConfig;
}

/** Build an immutable slug-to-directory generation before process ownership. */
export function snapshotProductionLocalProjects(
  value: unknown,
): Readonly<Record<string, string>> | undefined {
  if (value === undefined) return undefined;
  const snapshot = snapshotGraph(value, "localProjects");
  if (typeof snapshot !== "object" || snapshot === null || ArrayIsArray(snapshot)) {
    throw snapshotError("localProjects", "must be a plain record of project paths");
  }

  const descriptors = ObjectGetOwnPropertyDescriptors(snapshot);
  const keys = ReflectOwnKeys(descriptors);
  if (keys.length > MAX_LOCAL_PROJECTS) {
    throw snapshotError("localProjects", `entry count exceeds ${MAX_LOCAL_PROJECTS}`);
  }
  for (const rawKey of keys) {
    const key = rawKey as string;
    const descriptor = descriptors[key];
    if (
      !descriptor || !("value" in descriptor) ||
      typeof descriptor.value !== "string" ||
      !isCanonicalProjectSlug(key) ||
      !LOCAL_PROJECT_SLUG_PATTERN.test(key) ||
      !isAbsolute(descriptor.value) ||
      normalize(descriptor.value) !== descriptor.value ||
      hasProjectIdentityControlCharacters(descriptor.value)
    ) {
      throw snapshotError(
        childPath("localProjects", key),
        "must contain a canonical slug and absolute normalized project path",
      );
    }
  }
  return snapshot as Readonly<Record<string, string>>;
}
