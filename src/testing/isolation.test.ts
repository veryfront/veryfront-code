import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "./assert.ts";
import { describe, it } from "./bdd.ts";
import { registerTestCleanup, resetAllTestState } from "./isolation.ts";
import { registerProcessStateReset } from "#veryfront/platform/compat/process/state-reset.ts";

describe("isolation", () => {
  describe("registerTestCleanup", () => {
    it("runs every registration, including duplicate callback references", async () => {
      const calls: string[] = [];
      const cleanup = () => {
        calls.push("cleanup");
      };

      registerTestCleanup(cleanup);
      registerTestCleanup(cleanup);
      await resetAllTestState();

      assertEquals(calls, ["cleanup", "cleanup"]);
    });

    it("continues after failures, reports them, and clears completed registrations", async () => {
      const calls: string[] = [];

      registerTestCleanup(() => {
        calls.push("throws");
        throw new Error("private cleanup detail");
      });
      registerTestCleanup(async () => {
        await Promise.resolve();
        calls.push("after-throw");
      });

      const error = await assertRejects(() => resetAllTestState(), AggregateError);
      assertEquals(calls, ["throws", "after-throw"]);
      assert(error.message.includes("private cleanup detail") === false);

      await resetAllTestState();
      assertEquals(calls, ["throws", "after-throw"]);
    });

    it("serializes overlapping resets", async () => {
      const calls: string[] = [];
      let releaseFirst: (() => void) | undefined;
      let markStarted: (() => void) | undefined;
      const started = new Promise<void>((resolve) => {
        markStarted = resolve;
      });
      const release = new Promise<void>((resolve) => {
        releaseFirst = resolve;
      });

      registerTestCleanup(async () => {
        calls.push("first-start");
        markStarted?.();
        await release;
        calls.push("first-end");
      });

      const firstReset = resetAllTestState();
      await started;
      registerTestCleanup(() => {
        calls.push("second");
      });
      const secondReset = resetAllTestState();
      releaseFirst?.();
      await Promise.all([firstReset, secondReset]);

      assertEquals(calls, ["first-start", "first-end", "second"]);
    });

    it("rejects non-function cleanup registrations immediately", () => {
      assertThrows(() => registerTestCleanup(undefined as never), TypeError);
    });

    it("rejects recursive resets instead of deadlocking", async () => {
      registerTestCleanup(() => resetAllTestState());

      const error = await assertRejects(() => resetAllTestState(), AggregateError);
      assert(
        error.errors.some((failure) =>
          failure instanceof Error && failure.message.includes("cannot run recursively")
        ),
      );

      await resetAllTestState();
    });

    it("runs loaded state-owner resets persistently until the owner unregisters", async () => {
      let calls = 0;
      const unregister = registerProcessStateReset("isolation integration test", () => {
        calls++;
      });

      try {
        await resetAllTestState();
        await resetAllTestState();
        assertEquals(calls, 2);
      } finally {
        unregister();
      }

      await resetAllTestState();
      assertEquals(calls, 2);
    });

    it("contains state-owner failures and identifies the failing owner", async () => {
      const unregister = registerProcessStateReset("failing isolation owner", () => {
        throw new Error("private owner detail");
      });

      try {
        const error = await assertRejects(() => resetAllTestState(), AggregateError);
        assert(error.message.includes("failing isolation owner"));
        assert(error.message.includes("private owner detail") === false);
      } finally {
        unregister();
      }

      await resetAllTestState();
    });
  });
});
