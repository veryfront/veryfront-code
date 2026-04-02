import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { registerTestCleanup, resetAllTestState } from "./isolation.ts";

describe("isolation", () => {
  describe("registerTestCleanup", () => {
    it("runs registered sync and async cleanups, keeps going after failures, and clears them after reset", async () => {
      const calls: string[] = [];

      registerTestCleanup(() => {
        calls.push("sync");
      });

      registerTestCleanup(async () => {
        await Promise.resolve();
        calls.push("async");
      });

      registerTestCleanup(() => {
        calls.push("throws");
        throw new Error("expected cleanup failure");
      });

      registerTestCleanup(() => {
        calls.push("after-throw");
      });

      await resetAllTestState();
      await resetAllTestState();

      assertEquals(calls, ["sync", "async", "throws", "after-throw"]);
    });
  });
});
