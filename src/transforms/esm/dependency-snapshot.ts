import { hashString } from "#veryfront/cache/hash.ts";
import { isCanonicalDependencyPinningCacheKey } from "#veryfront/cache/keys/dependency-pinning.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";

const apply = Reflect.apply;
const parseJson = JSON.parse;
const stringifyJson = JSON.stringify;
const objectKeys = Object.keys;
const objectEntries = Object.entries;
const createObject = Object.create;
const freeze = Object.freeze;
const getOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const hasOwn = Object.hasOwn;
const setPrototypeOf = Object.setPrototypeOf;
const isArray = Array.isArray;
const arraySort = Array.prototype.sort;
const localeCompare = String.prototype.localeCompare;
const NativeTypeError = TypeError;

export const DEPENDENCY_SNAPSHOT_MAX_BYTES = 1024 * 1024;
export const DEPENDENCY_SNAPSHOT_RETENTION_MS = 24 * 60 * 60 * 1000;
// Leave headroom below the hard ceiling for writer/reader/API/storage clock differences.
export const DEPENDENCY_SNAPSHOT_DEFAULT_RETENTION_MS = DEPENDENCY_SNAPSHOT_RETENTION_MS - 60000;

export interface DependencyPinningSnapshot {
  readonly cacheKey: string;
  readonly dependencies?: Readonly<Record<string, string>>;
  readonly configuredVersions?: Readonly<{
    react?: Readonly<{ declaration: string; effective: string }>;
    veryfront?: Readonly<{ declaration: string; effective: string }>;
  }>;
}

function ownValue(value: Record<string, unknown>, key: string): unknown {
  const descriptor = getOwnPropertyDescriptor(value, key);
  return descriptor && hasOwn(descriptor, "value") ? descriptor.value : undefined;
}

function copyRecord<T extends object>(value: T): T {
  const copy = createObject(null);
  const keys = objectKeys(value);
  for (let index = 0; index < keys.length; index++) {
    const key = keys[index]!;
    const descriptor = getOwnPropertyDescriptor(value, key)!;
    if (!hasOwn(descriptor, "value")) {
      throw new NativeTypeError("Dependency snapshot fields must be own data properties");
    }
    copy[key] = descriptor.value;
  }
  return copy;
}

function sortedDependencies(dependencies: Readonly<Record<string, string>>): [string, string][] {
  const entries = objectEntries(copyRecord(dependencies));
  for (let index = 0; index < entries.length; index++) {
    if (typeof entries[index]![1] !== "string") {
      throw new NativeTypeError("Dependency snapshot declarations must be strings");
    }
  }
  return apply(arraySort, entries, [
    (left: [string, string], right: [string, string]) => apply(localeCompare, left[0], [right[0]]),
  ]) as [string, string][];
}

// JSON serialization must not inherit project-defined toJSON or missing-field hooks.
function serializableConfiguration(
  value: unknown,
): DependencyPinningSnapshot["configuredVersions"] {
  if (value === undefined) return undefined;
  if (!record(value)) throw new NativeTypeError("Dependency snapshot configuration is invalid");
  const result = createObject(null);
  const names = objectKeys(value);
  for (let index = 0; index < names.length; index++) {
    const name = names[index]!;
    const version = ownValue(value, name);
    if (name !== "react" && name !== "veryfront") {
      throw new NativeTypeError("Dependency snapshot configuration is invalid");
    }
    if (version === undefined) continue;
    if (
      !record(version) || objectKeys(version).length !== 2 ||
      typeof ownValue(version, "declaration") !== "string" ||
      typeof ownValue(version, "effective") !== "string"
    ) throw new NativeTypeError("Dependency snapshot configuration is invalid");
    result[name] = copyRecord(version);
  }
  return result;
}

/** Preserve the existing wire identity, including captured configuration overrides. */
export function hashDependencyPins(
  dependencies: Readonly<Record<string, string>>,
  configuredVersions?: DependencyPinningSnapshot["configuredVersions"],
): string {
  const sortedEntries = sortedDependencies(dependencies);
  for (let index = 0; index < sortedEntries.length; index++) {
    setPrototypeOf(sortedEntries[index]!, null);
  }
  setPrototypeOf(sortedEntries, null);
  const configured = serializableConfiguration(configuredVersions);
  if (!configured?.react && !configured?.veryfront) return hashString(stringifyJson(sortedEntries));
  return hashString(stringifyJson({
    __proto__: null,
    dependencies: sortedEntries,
    configuredVersions: configured,
  }));
}

/** Reapply the captured renderer overrides to a raw package dependency map. */
export function applyConfiguredDependencyOverrides(
  dependencies: Readonly<Record<string, string>>,
  configuredVersions?: DependencyPinningSnapshot["configuredVersions"],
): Record<string, string> {
  const effective = copyRecord(dependencies) as Record<string, string>;
  if (configuredVersions?.react) effective.react = configuredVersions.react.effective;
  if (configuredVersions?.veryfront) effective.veryfront = configuredVersions.veryfront.effective;
  return effective;
}

export function freezeConfiguredVersions(
  configuredVersions?: DependencyPinningSnapshot["configuredVersions"],
): DependencyPinningSnapshot["configuredVersions"] {
  const copied = configuredVersions === undefined ? undefined : copyRecord(configuredVersions);
  return copied
    ? freeze({
      ...(copied.react ? { react: freeze({ ...copyRecord(copied.react) }) } : {}),
      ...(copied.veryfront ? { veryfront: freeze({ ...copyRecord(copied.veryfront) }) } : {}),
    })
    : undefined;
}

export function createDependencyPinningSnapshot(
  cacheKey: string,
  dependencies?: Readonly<Record<string, string>>,
  configuredVersions?: DependencyPinningSnapshot["configuredVersions"],
): DependencyPinningSnapshot {
  const copy = dependencies === undefined ? undefined : copyRecord(dependencies);
  return freeze({
    cacheKey,
    dependencies: copy === undefined ? undefined : freeze(copy),
    configuredVersions: freezeConfiguredVersions(configuredVersions),
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !isArray(value);
}

/** Validate storage bytes before they become runtime dependency authority. */
export function decodeDependencySnapshot(
  value: string,
  namespace: string,
  key: string,
): DependencyPinningSnapshot {
  if (utf8ByteLength(value) > DEPENDENCY_SNAPSHOT_MAX_BYTES) {
    throw new NativeTypeError("Dependency snapshot exceeds its byte limit");
  }
  const data: unknown = parseJson(value);
  if (!record(data)) throw new NativeTypeError("Dependency snapshot record is invalid");
  const storedSnapshot = ownValue(data, "snapshot");
  if (
    ownValue(data, "version") !== 1 || ownValue(data, "namespace") !== namespace ||
    !record(storedSnapshot) || ownValue(storedSnapshot, "cacheKey") !== key ||
    !isCanonicalDependencyPinningCacheKey(key)
  ) throw new NativeTypeError("Dependency snapshot record is invalid");
  const dependencies = ownValue(storedSnapshot, "dependencies");
  if (!record(dependencies)) throw new NativeTypeError("Dependency snapshot record is invalid");
  const configured = serializableConfiguration(ownValue(storedSnapshot, "configuredVersions"));
  const result = createDependencyPinningSnapshot(
    key,
    dependencies as Record<string, string>,
    configured,
  );
  if (`on:${hashDependencyPins(result.dependencies!, result.configuredVersions)}` !== key) {
    throw new NativeTypeError("Dependency snapshot identity does not match its contents");
  }
  if (serializeDependencySnapshot(namespace, result) !== value) {
    throw new NativeTypeError("Dependency snapshot bytes are not canonical");
  }
  return result;
}

function serializeDependencySnapshot(
  namespace: string,
  snapshot: DependencyPinningSnapshot,
): string {
  const entries = sortedDependencies(snapshot.dependencies ?? {});
  const sorted = createObject(null);
  for (let index = 0; index < entries.length; index++) {
    const entry = entries[index]!;
    sorted[entry[0]] = entry[1];
  }
  return stringifyJson({
    __proto__: null,
    version: 1,
    namespace,
    snapshot: {
      __proto__: null,
      cacheKey: snapshot.cacheKey,
      dependencies: sorted,
      configuredVersions: serializableConfiguration(
        freezeConfiguredVersions(snapshot.configuredVersions),
      ),
    },
  });
}

/** Canonical bytes make repeated publication idempotent across replicas. */
export function encodeDependencySnapshot(
  namespace: string,
  snapshot: DependencyPinningSnapshot,
): string {
  const value = serializeDependencySnapshot(namespace, snapshot);
  decodeDependencySnapshot(value, namespace, snapshot.cacheKey);
  return value;
}
