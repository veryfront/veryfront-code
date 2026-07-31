import { isCanonicalDependencyPinningCacheKey } from "#veryfront/cache/keys/dependency-pinning.ts";
import {
  type DependencyPinningSourceInput,
  resolveSuppliedDependencyPinningSnapshotSync,
} from "#veryfront/transforms/esm/package-registry.ts";

const arrayIsArray = Array.isArray;
const objectFreeze = Object.freeze;
const objectGetOwnPropertyDescriptor = Object.getOwnPropertyDescriptor;
const objectGetPrototypeOf = Object.getPrototypeOf;
const objectPrototype = Object.prototype;
const reflectOwnKeys = Reflect.ownKeys;

function snapshotDependencyMap(
  dependencies: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (
    dependencies === null ||
    typeof dependencies !== "object" ||
    arrayIsArray(dependencies)
  ) {
    throw new TypeError("Invalid dependency pinning snapshot: dependencies must be a plain object");
  }
  const prototype = objectGetPrototypeOf(dependencies);
  if (prototype !== objectPrototype && prototype !== null) {
    throw new TypeError("Invalid dependency pinning snapshot: dependencies must be a plain object");
  }

  const snapshot = Object.create(null) as Record<string, string>;
  for (const key of reflectOwnKeys(dependencies)) {
    if (typeof key !== "string") {
      throw new TypeError("Invalid dependency pinning snapshot: dependency names must be strings");
    }
    const descriptor = objectGetOwnPropertyDescriptor(dependencies, key);
    if (!descriptor?.enumerable) continue;
    if (descriptor.get || descriptor.set || typeof descriptor.value !== "string") {
      throw new TypeError(
        "Invalid dependency pinning snapshot: dependency declarations must be string values",
      );
    }
    snapshot[key] = descriptor.value;
  }
  return objectFreeze(snapshot);
}

/**
 * Validate and detach the dependency snapshot before any cache identity is
 * built. Unset legacy callers retain the flag-off identity, while an enabled
 * key is accepted only with the exact map that created it.
 */
export function captureDependencyPinningSnapshot(
  cacheKey?: string,
  dependencies?: Readonly<Record<string, string>>,
  source?: DependencyPinningSourceInput,
): Readonly<Record<string, string>> | undefined {
  if (cacheKey === undefined) {
    if (dependencies !== undefined) {
      throw new TypeError(
        "Invalid dependency pinning snapshot: dependencies require a cache key",
      );
    }
    return undefined;
  }
  if (cacheKey === "off") {
    if (dependencies !== undefined) {
      throw new TypeError(
        "Invalid dependency pinning snapshot: flag-off state cannot include dependencies",
      );
    }
    return undefined;
  }
  if (!isCanonicalDependencyPinningCacheKey(cacheKey)) {
    throw new TypeError(`Invalid dependency pinning snapshot key: ${cacheKey}`);
  }
  if (dependencies === undefined) {
    throw new TypeError(
      `Invalid dependency pinning snapshot: ${cacheKey} is missing its dependency map`,
    );
  }

  const snapshot = snapshotDependencyMap(dependencies);
  try {
    return resolveSuppliedDependencyPinningSnapshotSync(
      source,
      cacheKey,
      snapshot,
    ).dependencies;
  } catch (error) {
    throw new TypeError(
      `Invalid dependency pinning snapshot: ${cacheKey} does not match its dependency map`,
      { cause: error },
    );
  }
}
