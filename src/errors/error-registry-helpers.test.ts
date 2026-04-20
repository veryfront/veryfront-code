import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  getRegistryEntriesByCategory,
  getRegistryEntry,
  getRegistrySlugs,
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
});
