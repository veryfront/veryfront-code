import { fnv1aHash } from "./hash-utils.ts";

type CacheNamespaceValue =
  | string
  | number
  | boolean
  | null
  | readonly CacheNamespaceValue[]
  | { readonly [key: string]: CacheNamespaceValue };

const MAX_CACHE_NAMESPACE_DEPTH = 64;
const MAX_CACHE_NAMESPACE_NODES = 10_000;
const FNV1A_HEX_LENGTH = 8;

interface SerializationState {
  readonly ancestors: Set<object>;
  visited: number;
}

function serializeCacheNamespaceValue(
  value: CacheNamespaceValue,
  state: SerializationState,
  depth: number,
): string {
  state.visited++;
  if (state.visited > MAX_CACHE_NAMESPACE_NODES) {
    throw new RangeError("Cache namespace schema is too large");
  }
  if (value === null) return "null";

  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new RangeError("Cache namespace numbers must be finite");
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_CACHE_NAMESPACE_DEPTH) {
      throw new RangeError("Cache namespace schema is too deeply nested");
    }
    if (state.ancestors.has(value)) {
      throw new TypeError("Cache namespace schema must not be cyclic");
    }

    state.ancestors.add(value);
    try {
      if (value.length > MAX_CACHE_NAMESPACE_NODES - state.visited) {
        throw new RangeError("Cache namespace schema is too large");
      }

      const entries: string[] = [];
      for (let index = 0; index < value.length; index++) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor) {
          throw new TypeError("Cache namespace arrays must not be sparse");
        }
        if (!("value" in descriptor)) {
          throw new TypeError("Cache namespace entries must be data properties");
        }
        entries.push(
          serializeCacheNamespaceValue(
            descriptor.value as CacheNamespaceValue,
            state,
            depth + 1,
          ),
        );
      }
      return `[${entries.join(",")}]`;
    } finally {
      state.ancestors.delete(value);
    }
  }

  if (typeof value === "object") {
    if (depth >= MAX_CACHE_NAMESPACE_DEPTH) {
      throw new RangeError("Cache namespace schema is too deeply nested");
    }
    if (state.ancestors.has(value)) {
      throw new TypeError("Cache namespace schema must not be cyclic");
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Cache namespace schema objects must be plain records");
    }

    state.ancestors.add(value);
    try {
      const keys = Object.keys(value).sort((left, right) =>
        left < right ? -1 : left > right ? 1 : 0
      );
      return `{${
        keys
          .map((key) => {
            const descriptor = Object.getOwnPropertyDescriptor(value, key);
            if (!descriptor || !("value" in descriptor)) {
              throw new TypeError("Cache namespace entries must be data properties");
            }
            return `${JSON.stringify(key)}:${
              serializeCacheNamespaceValue(
                descriptor.value as CacheNamespaceValue,
                state,
                depth + 1,
              )
            }`;
          })
          .join(",")
      }}`;
    } finally {
      state.ancestors.delete(value);
    }
  }

  if (
    typeof value !== "string" &&
    typeof value !== "number" &&
    typeof value !== "boolean"
  ) {
    throw new TypeError("Cache namespace schema must contain only JSON scalar values");
  }
  return JSON.stringify(value);
}

/**
 * Build a deterministic cache namespace from a declarative schema description.
 * Keep the schema close to the cache builders so format changes roll the
 * namespace automatically instead of relying on a manually bumped constant.
 */
export function createCacheNamespace(
  scope: string,
  schema: CacheNamespaceValue,
  length = FNV1A_HEX_LENGTH,
): string {
  if (
    !Number.isSafeInteger(length) ||
    length <= 0 ||
    length > FNV1A_HEX_LENGTH
  ) {
    throw new RangeError(
      `Cache namespace hash length must be an integer between 1 and ${FNV1A_HEX_LENGTH}`,
    );
  }
  const serialized = serializeCacheNamespaceValue(
    schema,
    { ancestors: new Set<object>(), visited: 0 },
    0,
  );
  const hash = fnv1aHash(serialized).padStart(FNV1A_HEX_LENGTH, "0");
  return `${scope}-${hash.slice(0, length)}`;
}
