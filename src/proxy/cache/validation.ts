import type { CacheStats, TokenCache, TokenCacheEntry } from "./types.ts";

const MAX_CACHE_KEY_CODE_UNITS = 2_048;
const MAX_TOKEN_CODE_UNITS = 64 * 1_024;
const MAX_PROJECT_IDENTITY_CODE_UNITS = 512;

export type TokenCacheOperations = Readonly<
  {
    [Key in keyof TokenCache]: TokenCache[Key];
  }
>;

export function assertCacheOptionsObject(
  value: unknown,
  label: string,
  allowedKeys: readonly string[],
): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }

  try {
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(`${label} must be a plain object`);
    }
    const allowed = new Set(allowedKeys);
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key !== "string" || !allowed.has(key)) {
        throw new TypeError(`${label} contains an unknown option`);
      }
    }
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message.startsWith(`${label} `)
    ) {
      throw error;
    }
    throw new TypeError(`${label} is unreadable`, { cause: error });
  }
}

/**
 * Enforce synchronous registry mutation across cache startup seams. TypeScript
 * permits async functions where a void-returning callback is expected, so the
 * runtime must reject and observe returned thenables explicitly.
 */
export function requireSynchronousCacheRegistryOperation(
  result: unknown,
  label: string,
): void {
  if (result === undefined) return;
  void Promise.resolve(result).catch(() => undefined);
  throw new TypeError(`${label} must complete synchronously`);
}

function ownDataValue(
  descriptors: PropertyDescriptorMap,
  key: string,
): unknown {
  const descriptor = descriptors[key];
  return descriptor && "value" in descriptor ? descriptor.value : undefined;
}

function ownDescriptors(value: unknown, label: string): PropertyDescriptorMap {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`);
  }
  try {
    return Object.getOwnPropertyDescriptors(value);
  } catch {
    throw new TypeError(`${label} must be a readable object`);
  }
}

function isVisibleAscii(value: string): boolean {
  for (let index = 0; index < value.length; index++) {
    const code = value.charCodeAt(index);
    if (code < 0x21 || code > 0x7e) return false;
  }
  return true;
}

function snapshotOperation<Key extends keyof TokenCache>(
  backend: TokenCache,
  key: Key,
  label: string,
): TokenCache[Key] {
  let current: object | null = backend;
  const seen = new Set<object>();

  try {
    while (current !== null && !seen.has(current)) {
      seen.add(current);
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor) {
        if (!("value" in descriptor) || typeof descriptor.value !== "function") {
          throw new TypeError(
            `${label} ${key} operation must be a data function`,
          );
        }
        const operation = descriptor.value;
        return ((...args: unknown[]) => Reflect.apply(operation, backend, args)) as TokenCache[Key];
      }
      current = Object.getPrototypeOf(current);
    }
  } catch (error) {
    if (
      error instanceof TypeError &&
      error.message.startsWith(`${label} `)
    ) {
      throw error;
    }
    throw new TypeError(`${label} ${key} operation is unreadable`, {
      cause: error,
    });
  }

  throw new TypeError(`${label} ${key} operation must be a data function`);
}

export function snapshotTokenCacheOperations(
  value: unknown,
  label = "Token cache",
): TokenCacheOperations {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a cache object`);
  }
  const backend = value as TokenCache;
  return Object.freeze({
    get: snapshotOperation(backend, "get", label),
    set: snapshotOperation(backend, "set", label),
    delete: snapshotOperation(backend, "delete", label),
    clear: snapshotOperation(backend, "clear", label),
    has: snapshotOperation(backend, "has", label),
    stats: snapshotOperation(backend, "stats", label),
    close: snapshotTokenCacheClose(backend, label),
  });
}

/**
 * Capture cleanup ownership before validating the rest of an extension
 * contract. The bound data-function snapshot cannot be replaced by a later
 * property mutation or accessor.
 */
export function snapshotTokenCacheClose(
  value: unknown,
  label = "Token cache",
): TokenCache["close"] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be a cache object`);
  }
  return snapshotOperation(value as TokenCache, "close", label);
}

/**
 * Snapshot a cache and place its owned close operation behind one immutable
 * attempt. Independent aggregate and direct owners can then share teardown
 * without assuming the backend's raw close operation is idempotent.
 */
export function snapshotOwnedTokenCacheOperations(
  value: unknown,
  label = "Token cache",
): TokenCacheOperations {
  const operations = snapshotTokenCacheOperations(value, label);
  let closeAttempt: Promise<void> | null = null;
  const close = (): Promise<void> => {
    closeAttempt ??= Promise.resolve().then(() => operations.close());
    return closeAttempt;
  };
  return Object.freeze({
    get: operations.get,
    set: operations.set,
    delete: operations.delete,
    clear: operations.clear,
    has: operations.has,
    stats: operations.stats,
    close,
  });
}

export function requireTokenCacheKey(value: unknown): string {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_CACHE_KEY_CODE_UNITS
  ) {
    throw new TypeError("Token cache key must be a bounded non-empty string");
  }
  return value;
}

export function snapshotTokenCacheEntry(value: unknown): TokenCacheEntry {
  const descriptors = ownDescriptors(value, "Token cache entry");
  const token = ownDataValue(descriptors, "token");
  const expiresAt = ownDataValue(descriptors, "expiresAt");
  const scope = ownDataValue(descriptors, "scope");
  const projectSlug = ownDataValue(descriptors, "projectSlug");

  if (
    typeof token !== "string" ||
    token.length === 0 ||
    token.length > MAX_TOKEN_CODE_UNITS ||
    !isVisibleAscii(token) ||
    typeof expiresAt !== "number" ||
    !Number.isSafeInteger(expiresAt) ||
    (scope !== "preview" && scope !== "production") ||
    (projectSlug !== undefined &&
      (typeof projectSlug !== "string" ||
        projectSlug.length === 0 ||
        projectSlug.length > MAX_PROJECT_IDENTITY_CODE_UNITS ||
        projectSlug !== projectSlug.trim()))
  ) {
    throw new TypeError("Token cache entry is invalid");
  }

  return Object.freeze({
    token,
    expiresAt,
    scope,
    ...(projectSlug === undefined ? {} : { projectSlug }),
  });
}

export function snapshotTokenCacheStats(value: unknown): CacheStats {
  const descriptors = ownDescriptors(value, "Token cache statistics");
  const hits = ownDataValue(descriptors, "hits");
  const misses = ownDataValue(descriptors, "misses");
  const size = ownDataValue(descriptors, "size");
  const type = ownDataValue(descriptors, "type");

  if (
    typeof hits !== "number" ||
    !Number.isSafeInteger(hits) ||
    hits < 0 ||
    typeof misses !== "number" ||
    !Number.isSafeInteger(misses) ||
    misses < 0 ||
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size < 0 ||
    (type !== "memory" && type !== "extension")
  ) {
    throw new TypeError("Token cache returned invalid statistics");
  }

  return Object.freeze({ hits, misses, size, type });
}
