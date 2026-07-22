import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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

      const repeatedCleanup = () => {
        calls.push("repeated");
      };
      registerTestCleanup(repeatedCleanup);
      registerTestCleanup(repeatedCleanup);

      const error = await assertRejects(
        () => resetAllTestState(),
        AggregateError,
        "test state cleanup failed",
      ) as AggregateError;
      assertEquals(error.errors.length, 1);
      await resetAllTestState();

      assertEquals(calls, ["sync", "async", "throws", "after-throw", "repeated", "repeated"]);
    });
  });
});
