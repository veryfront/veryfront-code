import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
// Import the data module only. Loading model-catalog.ts freezes the chat model
// entries as a side effect, which would hide a missing freeze in the data module.
import * as catalogData from "./model-catalog.data.ts";

/** Collects the path of every object reachable from a data export that is not frozen. */
function findUnfrozenPaths(value: unknown, path: string, seen: Set<unknown>): string[] {
  if (value === null || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);

  // A Map cannot be frozen. It is exposed as a ReadonlyMap, so only its values are checked.
  if (value instanceof Map) {
    return Array.from(value.entries()).flatMap(([key, entry]) =>
      findUnfrozenPaths(entry, `${path}.get(${String(key)})`, seen)
    );
  }

  const own = Object.isFrozen(value) ? [] : [path];
  const children = Array.isArray(value)
    ? value.flatMap((entry, index) => findUnfrozenPaths(entry, `${path}[${index}]`, seen))
    : Object.entries(value).flatMap(([key, entry]) =>
      findUnfrozenPaths(entry, `${path}.${key}`, seen)
    );
  return [...own, ...children];
}

describe("provider/veryfront-cloud/model-catalog.data frozen state", () => {
  it("freezes every entry, map value, and nested object without loading the catalog logic", () => {
    const unfrozenPaths = Object.entries(catalogData).flatMap(([name, value]) =>
      findUnfrozenPaths(value, name, new Set())
    );

    assertEquals(unfrozenPaths, []);
  });
});
