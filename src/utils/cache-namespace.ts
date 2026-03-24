import { fnv1aHash } from "./hash-utils.ts";

type CacheNamespaceValue =
  | string
  | number
  | boolean
  | null
  | readonly CacheNamespaceValue[]
  | { readonly [key: string]: CacheNamespaceValue };

function serializeCacheNamespaceValue(value: CacheNamespaceValue): string {
  if (value === null) return "null";

  if (Array.isArray(value)) {
    return `[${value.map((entry) => serializeCacheNamespaceValue(entry)).join(",")}]`;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value).sort(([left], [right]) => left.localeCompare(right));
    return `{${
      entries
        .map(([key, entry]) => `${JSON.stringify(key)}:${serializeCacheNamespaceValue(entry)}`)
        .join(",")
    }}`;
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
  length = 10,
): string {
  const serialized = serializeCacheNamespaceValue(schema);
  return `${scope}-${fnv1aHash(serialized).slice(0, length)}`;
}
