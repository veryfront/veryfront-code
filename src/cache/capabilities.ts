/** Provider-neutral runtime support for atomic cache revisions. */

import type { CacheBackend, CacheRevisionSnapshot, RevisionedCacheBackend } from "./types.ts";
import { MAX_CACHE_REVISION_LENGTH } from "./types.ts";

/** Reserved logical-key namespace for revisioned Veryfront cache entries. */
export const REVISIONED_CACHE_KEY_PREFIX = "vf:revisioned:v1:";

/** Maximum source-key length before the reserved namespace is added. */
export const MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH = 32 * 1024;

type CapturedRevisionMethods = Readonly<{
  getWithRevision: RevisionedCacheBackend["getWithRevision"];
  compareExchange: RevisionedCacheBackend["compareExchange"];
}>;

type UncheckedCallable = (...args: never[]) => unknown;

const MAX_CACHE_CAPABILITY_PROTOTYPE_DEPTH = 64;

function findCallableDataProperty(
  value: object,
  key: "getWithRevision" | "compareExchange",
): UncheckedCallable | null {
  let current: object | null = value;
  const visited = new Set<object>();
  let inspectedDepth = 0;

  while (current !== null) {
    if (inspectedDepth >= MAX_CACHE_CAPABILITY_PROTOTYPE_DEPTH) return null;
    inspectedDepth += 1;
    if (visited.has(current)) return null;
    visited.add(current);

    const descriptor = Reflect.getOwnPropertyDescriptor(current, key);
    if (descriptor !== undefined) {
      if (!("value" in descriptor) || typeof descriptor.value !== "function") {
        return null;
      }
      return descriptor.value;
    }
    current = Reflect.getPrototypeOf(current);
  }

  return null;
}

/**
 * Capture the complete optional method group without invoking accessors or
 * reading properties. This helper is internal to core and intentionally is
 * not re-exported from cache barrels.
 *
 * @internal
 */
export function captureRevisionedCacheBackendMethods(
  backend: unknown,
): CapturedRevisionMethods | null {
  if (
    backend === null ||
    (typeof backend !== "object" && typeof backend !== "function")
  ) {
    return null;
  }

  try {
    const getWithRevision = findCallableDataProperty(backend, "getWithRevision");
    if (getWithRevision === null) return null;
    const compareExchange = findCallableDataProperty(backend, "compareExchange");
    if (compareExchange === null) return null;

    return Object.freeze({
      getWithRevision: getWithRevision as RevisionedCacheBackend["getWithRevision"],
      compareExchange: compareExchange as RevisionedCacheBackend["compareExchange"],
    });
  } catch {
    return null;
  }
}

/** Test whether a backend exposes the complete atomic revision capability. */
export function isRevisionedCacheBackend(
  backend: CacheBackend,
): backend is RevisionedCacheBackend {
  return captureRevisionedCacheBackendMethods(backend) !== null;
}

function readOwnDataProperty(value: object, key: string): unknown {
  let descriptor: PropertyDescriptor | undefined;
  try {
    descriptor = Reflect.getOwnPropertyDescriptor(value, key);
  } catch (cause) {
    throw new TypeError(`Cache revision ${key} could not be inspected`, { cause });
  }
  if (descriptor === undefined || !("value" in descriptor)) {
    throw new TypeError(`Cache revision ${key} must be an own data property`);
  }
  return descriptor.value;
}

/** Validate and detach a provider-returned revision snapshot. */
export function snapshotCacheRevisionResult(value: unknown): CacheRevisionSnapshot {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError("Cache revision result must be an object");
  }

  let keys: PropertyKey[];
  try {
    keys = Reflect.ownKeys(value);
  } catch (cause) {
    throw new TypeError("Cache revision result could not be inspected", { cause });
  }
  if (
    keys.length !== 2 ||
    !keys.includes("value") ||
    !keys.includes("revision")
  ) {
    throw new TypeError("Cache revision result must contain only value and revision");
  }

  const snapshotValue = readOwnDataProperty(value, "value");
  const revision = readOwnDataProperty(value, "revision");
  if (snapshotValue !== null && typeof snapshotValue !== "string") {
    throw new TypeError("Cache revision value must be a string or null");
  }
  if (
    typeof revision !== "string" ||
    revision.length === 0 ||
    revision.length > MAX_CACHE_REVISION_LENGTH ||
    !/^[!-~]+$/.test(revision)
  ) {
    throw new TypeError(
      `Cache revision must be 1 to ${MAX_CACHE_REVISION_LENGTH} visible ASCII characters`,
    );
  }

  return Object.freeze({ value: snapshotValue, revision });
}

/** Validate a provider-returned compare-exchange result. */
export function requireCacheExchangeResult(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new TypeError("Cache compare-exchange result must be boolean");
  }
  return value;
}

function isValidRevisionedCacheSourceKey(value: unknown): value is string {
  return typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH &&
    !/\p{Cc}/u.test(value) &&
    !value.startsWith(REVISIONED_CACHE_KEY_PREFIX);
}

/** Add the reserved versioned namespace to one valid source key. */
export function buildRevisionedCacheKey(key: string): string {
  if (typeof key !== "string" || key.length === 0 || /\p{Cc}/u.test(key)) {
    throw new TypeError("Revisioned cache source key must be non-empty and control-free");
  }
  if (key.length > MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH) {
    throw new RangeError(
      `Revisioned cache source key cannot exceed ${MAX_REVISIONED_CACHE_SOURCE_KEY_LENGTH} code units`,
    );
  }
  if (key.startsWith(REVISIONED_CACHE_KEY_PREFIX)) {
    throw new TypeError("Revisioned cache source key must not use the reserved namespace");
  }
  return `${REVISIONED_CACHE_KEY_PREFIX}${key}`;
}

/** Test whether a key belongs to the valid revisioned-key builder image. */
export function isRevisionedCacheKey(key: unknown): key is string {
  if (typeof key !== "string" || !key.startsWith(REVISIONED_CACHE_KEY_PREFIX)) {
    return false;
  }
  return isValidRevisionedCacheSourceKey(key.slice(REVISIONED_CACHE_KEY_PREFIX.length));
}
