import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getRegistryEntriesByCategory,
  getRegistryEntry,
  getRegistrySlugs,
  mergeRegistryFragments,
} from "./error-registry-helpers.ts";
import { defineError } from "./types.ts";

const TEST_REGISTRY = {
  "config-problem": defineError({
    slug: "config-problem",
    category: "CONFIG",
    status: 400,
    title: "Config problem",
  }),
  "server-problem": defineError({
    slug: "server-problem",
    category: "SERVER",
    status: 500,
    title: "Server problem",
  }),
} as const;

describe("error-registry-helpers", () => {
  it("returns registry entries by slug without changing identity", () => {
    assertStrictEquals(
      getRegistryEntry(TEST_REGISTRY, "config-problem"),
      TEST_REGISTRY["config-problem"],
    );
  });

  it("filters registry entries by category", () => {
    assertEquals(getRegistryEntriesByCategory(TEST_REGISTRY, "CONFIG"), [
      TEST_REGISTRY["config-problem"],
    ]);
    assertEquals(getRegistryEntriesByCategory(TEST_REGISTRY, "BUILD"), []);
  });

  it("returns registry slugs with preserved order", () => {
    assertEquals(getRegistrySlugs(TEST_REGISTRY), ["config-problem", "server-problem"]);
  });

  it("rejects inherited registry keys", () => {
    assertThrows(
      () => getRegistryEntry(TEST_REGISTRY, "__proto__" as never),
      TypeError,
    );
  });

  it("rejects duplicate and mismatched fragment entries", () => {
    assertThrows(
      () =>
        mergeRegistryFragments(
          TEST_REGISTRY,
          { "config-problem": TEST_REGISTRY["config-problem"] },
        ),
      TypeError,
      "Duplicate error slug",
    );
    assertThrows(
      () =>
        mergeRegistryFragments({
          "wrong-key": TEST_REGISTRY["config-problem"],
        }),
      TypeError,
      "must match its registry key",
    );
  });

  it("returns an immutable checked registry", () => {
    const merged = mergeRegistryFragments(TEST_REGISTRY);

    assertEquals(Object.isFrozen(merged), true);
    assertEquals(Object.getPrototypeOf(merged), null);
    assertStrictEquals(merged["config-problem"], TEST_REGISTRY["config-problem"]);
  });
});
