import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { dynamicImport } from "./dynamic-import.ts";

describe("platform/compat/dynamic-import", () => {
  it("should be a function", () => {
    assertEquals(typeof dynamicImport, "function");
  });

  it("should import a built-in module", async () => {
    const mod = await dynamicImport<{ join: Function }>("node:path");
    assertExists(mod);
    assertEquals(typeof mod.join, "function");
  });

  it("should reject for a non-existent module", async () => {
    await assertRejects(
      () => dynamicImport("__nonexistent_module_12345__"),
    );
  });
});
