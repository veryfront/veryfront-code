import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { registerTestCleanup } from "./isolation.ts";

describe("isolation", () => {
  describe("registerTestCleanup", () => {
    it("accepts a cleanup function without error", () => {
      let called = false;

      registerTestCleanup(() => {
        called = true;
      });

      assertEquals(typeof called, "boolean");
    });

    it("accepts an async cleanup function", () => {
      registerTestCleanup(async () => {
        await Promise.resolve();
      });
    });
  });
});
