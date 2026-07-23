import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { getAbortReason, raceWithAbort } from "./abort.ts";

describe("tool abort helpers", () => {
  it("passes through settled operations without a signal", async () => {
    assertEquals(await raceWithAbort(Promise.resolve("done"), undefined), "done");
    await assertRejects(
      () => raceWithAbort(Promise.reject(new Error("failed")), undefined),
      Error,
      "failed",
    );
  });

  it("rejects with an already-aborted signal's exact reason", async () => {
    const reason = new Error("already canceled");
    const controller = new AbortController();
    controller.abort(reason);
    let thrown: unknown;

    try {
      await raceWithAbort(Promise.resolve("ignored"), controller.signal);
    } catch (error) {
      thrown = error;
    }

    assertStrictEquals(thrown, reason);
    assertStrictEquals(getAbortReason(controller.signal), reason);
  });

  it("removes listeners after signaled operations resolve or reject", async () => {
    for (
      const createOperation of [
        () => Promise.resolve("done"),
        () => Promise.reject(new Error("failed")),
      ]
    ) {
      const controller = new AbortController();
      const signal = controller.signal;
      const addEventListener = signal.addEventListener.bind(signal);
      const removeEventListener = signal.removeEventListener.bind(signal);
      let added = 0;
      let removed = 0;
      Object.defineProperties(signal, {
        addEventListener: {
          configurable: true,
          value: (...args: Parameters<AbortSignal["addEventListener"]>) => {
            added += 1;
            return addEventListener(...args);
          },
        },
        removeEventListener: {
          configurable: true,
          value: (...args: Parameters<AbortSignal["removeEventListener"]>) => {
            removed += 1;
            return removeEventListener(...args);
          },
        },
      });

      try {
        await raceWithAbort(createOperation(), signal);
      } catch {
        // The rejection path is part of listener cleanup coverage.
      }

      assertEquals(added, 1);
      assertEquals(removed, 1);
    }
  });

  it("rejects when a pending operation is aborted", async () => {
    const controller = new AbortController();
    const reason = new Error("pending operation canceled");
    const result = raceWithAbort(new Promise(() => {}), controller.signal);

    controller.abort(reason);

    let thrown: unknown;
    try {
      await result;
    } catch (error) {
      thrown = error;
    }
    assertStrictEquals(thrown, reason);
  });

  it("creates a standard error when an abort signal has no explicit reason", () => {
    const signal = { reason: undefined } as AbortSignal;
    const reason = getAbortReason(signal);

    assertEquals(reason instanceof DOMException, true);
    assertEquals((reason as DOMException).name, "AbortError");
  });

  it("preserves an explicit null abort reason", async () => {
    const controller = new AbortController();
    controller.abort(null);
    let rejection: unknown = "not rejected";

    try {
      await raceWithAbort(Promise.resolve("ignored"), controller.signal);
    } catch (error) {
      rejection = error;
    }

    assertStrictEquals(rejection, null);
    assertStrictEquals(getAbortReason(controller.signal), null);
  });
});
