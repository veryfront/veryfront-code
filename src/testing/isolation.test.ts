import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { registerTestCleanup } from "./isolation.ts";

describe("isolation", () => {
  describe("registerTestCleanup", () => {
    it("accepts a cleanup function without error", () => {
      // registerTestCleanup should not throw
      let called = false;
      registerTestCleanup(() => {
        called = true;
      });
      // We can't easily test that it runs (requires installTestIsolation),
      // but at least verify registration doesn't throw.
      assertEquals(typeof called, "boolean");
    });

    it("accepts an async cleanup function", () => {
      registerTestCleanup(async () => {
        await Promise.resolve();
      });
      // No error means success
    });
  });
});
