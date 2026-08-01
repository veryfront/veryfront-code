import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert";
import { composeAbortSignals } from "./abort-signal.ts";

Deno.test("composeAbortSignals propagates the first exact abort reason", () => {
  const first = new AbortController();
  const second = new AbortController();
  const signal = composeAbortSignals([first.signal, second.signal]);
  const firstReason = new Error("first cancellation");

  first.abort(firstReason);
  second.abort(new Error("later cancellation"));

  assertEquals(signal.aborted, true);
  assertStrictEquals(signal.reason, firstReason);
});

Deno.test("composeAbortSignals handles an already-aborted source", () => {
  const pending = new AbortController();
  const aborted = new AbortController();
  const reason = new Error("already cancelled");
  aborted.abort(reason);

  const signal = composeAbortSignals([pending.signal, aborted.signal]);

  assertEquals(signal.aborted, true);
  assertStrictEquals(signal.reason, reason);
});

Deno.test("composeAbortSignals works when AbortSignal.any is unavailable", () => {
  const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, "any");
  Object.defineProperty(AbortSignal, "any", {
    configurable: true,
    value: undefined,
    writable: true,
  });
  try {
    const controller = new AbortController();
    const signal = composeAbortSignals([controller.signal]);
    const reason = new Error("Node 18 cancellation");

    controller.abort(reason);

    assertEquals(signal.aborted, true);
    assertStrictEquals(signal.reason, reason);
  } finally {
    if (descriptor) Object.defineProperty(AbortSignal, "any", descriptor);
    else delete (AbortSignal as { any?: unknown }).any;
  }
});
