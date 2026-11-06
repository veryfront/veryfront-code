import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { throwIfAbortSignalAborted } from "./abort-signal.ts";

function captureThrown(fn: () => void): { threw: boolean; value: unknown } {
  try {
    fn();
    return { threw: false, value: undefined };
  } catch (value) {
    return { threw: true, value };
  }
}

function abortedController(reason: Error): AbortController {
  const controller = new AbortController();
  controller.abort(reason);
  return controller;
}

describe("throwIfAbortSignalAborted", () => {
  it("does not throw for a live signal", () => {
    assertEquals(captureThrown(() => throwIfAbortSignalAborted(new AbortController().signal)), {
      threw: false,
      value: undefined,
    });
  });

  it("throws the native abort reason unchanged", () => {
    const reason = new Error("eval cancelled");
    const controller = new AbortController();
    const signal = controller.signal;
    controller.abort(reason);

    const result = captureThrown(() => throwIfAbortSignalAborted(signal));
    assertEquals(result.threw, true);
    assertStrictEquals(result.value, reason);
  });

  it("throws an AbortError instead of undefined when the runtime loses the reason", () => {
    // Bun 1.3.6 keeps the reason alive only through a live signal wrapper. Aborting
    // before the signal is read and then collecting garbage drops it, and the native
    // throwIfAborted() throws undefined. Other runtimes keep the reason.
    const gc = (globalThis as { Bun?: { gc?: (force: boolean) => void } }).Bun?.gc;
    for (let attempt = 0; attempt < 20; attempt++) {
      const controller = abortedController(new Error("eval cancelled"));
      gc?.(true);

      const result = captureThrown(() => throwIfAbortSignalAborted(controller.signal));
      assertEquals(result.threw, true);
      if (!(result.value instanceof Error)) {
        throw new Error(`Expected an Error, got ${String(result.value)}`);
      }
      if (result.value.message !== "eval cancelled") {
        assertEquals(result.value.name, "AbortError");
      }
    }
  });
});
