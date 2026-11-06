import { assertEquals, assertInstanceOf, assertStrictEquals } from "#veryfront/testing/assert.ts";
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

  it("throws an AbortError when the native throwIfAborted throws undefined", async () => {
    // Bun 1.3.6 can throw undefined from throwIfAborted() after GC drops the reason.
    // The helper captures the native method at load, so load a fresh copy while the
    // prototype method behaves like that on every runtime.
    const nativeThrowIfAborted = AbortSignal.prototype.throwIfAborted;
    let fresh: typeof import("./abort-signal.ts") | undefined;
    AbortSignal.prototype.throwIfAborted = function throwUndefined(this: AbortSignal) {
      throw undefined;
    };
    try {
      fresh = await import("./abort-signal.ts?lost-abort-reason");
    } finally {
      AbortSignal.prototype.throwIfAborted = nativeThrowIfAborted;
    }

    const result = captureThrown(() =>
      fresh!.throwIfAbortSignalAborted(abortedController(new Error("eval cancelled")).signal)
    );
    assertEquals(result.threw, true);
    assertInstanceOf(result.value, DOMException);
    const thrown = result.value as DOMException;
    assertEquals(thrown.name, "AbortError");
    assertEquals(thrown.message, "The operation was aborted");
  });

  it("never throws undefined after Bun collects an unread abort reason", () => {
    // Bun 1.3.6 keeps the reason alive only through a live signal wrapper. Aborting
    // before the signal is read and then collecting garbage drops the reason. Other
    // runtimes have no Bun.gc and keep the reason.
    const gc = (globalThis as { Bun?: { gc?: (force: boolean) => void } }).Bun?.gc;
    for (let attempt = 0; attempt < 20; attempt++) {
      const controller = abortedController(new Error("eval cancelled"));
      gc?.(true);

      const result = captureThrown(() => throwIfAbortSignalAborted(controller.signal));
      assertEquals(result.threw, true);
      assertInstanceOf(result.value, Error);
    }
  });
});
