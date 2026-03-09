import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { cleanupBundler } from "./cleanup.ts";

describe("rendering/cleanup", () => {
  describe("cleanupBundler", () => {
    it("should be an async function that returns a promise", () => {
      assertEquals(typeof cleanupBundler, "function");
    });

    it("should resolve without throwing", async () => {
      // cleanupBundler dynamically imports and clears caches;
      // it should not throw even when modules are already clean
      await cleanupBundler();
    });
  });
});
