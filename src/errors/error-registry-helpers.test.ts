import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  composeErrorRegistry,
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

  it("does not return inherited object properties as registry entries", () => {
    for (const slug of ["toString", "constructor", "__proto__"]) {
      assertEquals(
        getRegistryEntry(TEST_REGISTRY, slug as keyof typeof TEST_REGISTRY),
        undefined,
      );
    }
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

  it("returns an immutable composed registry", () => {
    const registry = composeErrorRegistry(TEST_REGISTRY);

    assertEquals(Object.isFrozen(registry), true);
    assertEquals(Object.getPrototypeOf(registry), null);
    assertThrows(
      () => {
        (registry as Record<string, unknown>)["new-error"] = TEST_REGISTRY["config-problem"];
      },
      TypeError,
    );
  });

  it("rejects duplicate slugs while composing registry fragments", () => {
    const duplicateRegistry = {
      "config-problem": defineError({
        slug: "config-problem",
        category: "CONFIG",
        status: 422,
        title: "Conflicting config problem",
      }),
    } as const;

    assertThrows(
      () => composeErrorRegistry(TEST_REGISTRY, duplicateRegistry),
      Error,
      'Duplicate error registry slug "config-problem"',
    );
  });

  it("rejects registry keys that do not match the definition slug", () => {
    const mismatchedRegistry = {
      "registry-key": defineError({
        slug: "definition-slug",
        category: "GENERAL",
        status: 500,
        title: "Mismatched registry entry",
      }),
    } as const;

    assertThrows(
      () => composeErrorRegistry(mismatchedRegistry),
      Error,
      'Error registry key "registry-key" does not match entry slug "definition-slug"',
    );
  });

  it("rejects malformed definitions only when composing the internal registry", () => {
    const malformed = {
      "invalid error": defineError({
        slug: "invalid error",
        category: "GENERAL",
        status: 200,
        title: "Invalid",
      }),
    } as const;

    assertThrows(
      () => composeErrorRegistry(malformed),
      TypeError,
      "Registered error slug",
    );

    const invalidStatus = {
      "invalid-status": defineError({
        slug: "invalid-status",
        category: "GENERAL",
        status: 200,
        title: "Invalid status",
      }),
    } as const;

    assertThrows(
      () => composeErrorRegistry(invalidStatus),
      RangeError,
      "Registered error status",
    );
  });
});
