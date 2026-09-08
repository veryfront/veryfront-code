import { hashString } from "#veryfront/cache/hash.ts";
import { isCanonicalDependencyPinningCacheKey } from "#veryfront/cache/keys/dependency-pinning.ts";
import { utf8ByteLength } from "#veryfront/utils/utf8-byte-length.ts";

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

/** Preserve the existing wire identity, including captured configuration overrides. */
export function hashDependencyPins(
  dependencies: Readonly<Record<string, string>>,
  configuredVersions?: DependencyPinningSnapshot["configuredVersions"],
): string {
  const sortedEntries = Object.entries(dependencies).sort(([left], [right]) =>
    left.localeCompare(right)
  );
  if (!configuredVersions?.react && !configuredVersions?.veryfront) {
    return hashString(JSON.stringify(sortedEntries));
  }
  return hashString(JSON.stringify({ dependencies: sortedEntries, configuredVersions }));
}

export function freezeConfiguredVersions(
  configuredVersions?: DependencyPinningSnapshot["configuredVersions"],
): DependencyPinningSnapshot["configuredVersions"] {
  return configuredVersions
    ? Object.freeze({
      ...(configuredVersions.react
        ? { react: Object.freeze({ ...configuredVersions.react }) }
        : {}),
      ...(configuredVersions.veryfront
        ? { veryfront: Object.freeze({ ...configuredVersions.veryfront }) }
        : {}),
    })
    : undefined;
}

export function createDependencyPinningSnapshot(
  cacheKey: string,
  dependencies?: Readonly<Record<string, string>>,
  configuredVersions?: DependencyPinningSnapshot["configuredVersions"],
): DependencyPinningSnapshot {
  const copy = dependencies === undefined
    ? undefined
    : Object.assign(Object.create(null), dependencies);
  return Object.freeze({
    cacheKey,
    dependencies: copy === undefined ? undefined : Object.freeze(copy),
    configuredVersions: freezeConfiguredVersions(configuredVersions),
  });
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Validate storage bytes before they become runtime dependency authority. */
export function decodeDependencySnapshot(
  value: string,
  namespace: string,
  key: string,
): DependencyPinningSnapshot {
  if (utf8ByteLength(value) > DEPENDENCY_SNAPSHOT_MAX_BYTES) {
    throw new TypeError("Dependency snapshot exceeds its byte limit");
  }
  const data: unknown = JSON.parse(value);
  if (
    !record(data) || data.version !== 1 || data.namespace !== namespace ||
    !record(data.snapshot) || data.snapshot.cacheKey !== key ||
    !isCanonicalDependencyPinningCacheKey(key) || !record(data.snapshot.dependencies)
  ) throw new TypeError("Dependency snapshot record is invalid");
  const dependencies = data.snapshot.dependencies;
  if (Object.values(dependencies).some((v) => typeof v !== "string")) {
    throw new TypeError("Dependency snapshot declarations must be strings");
  }
  const configured = data.snapshot.configuredVersions;
  if (configured !== undefined) {
    if (
      !record(configured) ||
      Object.entries(configured).some(([name, v]) =>
        (name !== "react" && name !== "veryfront") || !record(v) ||
        typeof v.declaration !== "string" || typeof v.effective !== "string" ||
        Object.keys(v).length !== 2
      )
    ) throw new TypeError("Dependency snapshot configuration is invalid");
  }
  const result = createDependencyPinningSnapshot(
    key,
    dependencies as Record<string, string>,
    configured as DependencyPinningSnapshot["configuredVersions"],
  );
  if (`on:${hashDependencyPins(result.dependencies!, result.configuredVersions)}` !== key) {
    throw new TypeError("Dependency snapshot identity does not match its contents");
  }
  if (serializeDependencySnapshot(namespace, result) !== value) {
    throw new TypeError("Dependency snapshot bytes are not canonical");
  }
  return result;
}

function serializeDependencySnapshot(
  namespace: string,
  snapshot: DependencyPinningSnapshot,
): string {
  const sorted = Object.fromEntries(
    Object.entries(snapshot.dependencies ?? {}).sort(([a], [b]) => a.localeCompare(b)),
  );
  return JSON.stringify({
    version: 1,
    namespace,
    snapshot: {
      cacheKey: snapshot.cacheKey,
      dependencies: sorted,
      configuredVersions: freezeConfiguredVersions(snapshot.configuredVersions),
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
