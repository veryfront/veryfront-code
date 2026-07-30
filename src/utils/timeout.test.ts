import { FakeTime } from "#std/testing/time";
import { assertEquals, assertRejects } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import { MAX_TIMER_DELAY_MS } from "./timer.ts";
import { TimeoutError, withTimeoutThrow } from "./timeout.ts";

function delay<T>(ms: number, value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

function hang<T>(): Promise<T> {
  return new Promise(() => {});
}

describe("withTimeoutThrow", () => {
  it("returns the operation result and disarms its local deadline", async () => {
    using time = new FakeTime();
    let timeoutCalls = 0;
    const result = withTimeoutThrow(delay(10, "success"), 50, "fast operation", {
      onTimeout: () => timeoutCalls += 1,
    });

    await time.tickAsync(10);
    assertEquals(await result, "success");
    await time.tickAsync(50);
    assertEquals(timeoutCalls, 0);
  });

  it("rejects with a stable TimeoutError and passes that instance to onTimeout", async () => {
    using time = new FakeTime();
    let observedError: TimeoutError | undefined;
    const result = withTimeoutThrow(hang(), 50, "owned operation", {
      onTimeout: (error) => observedError = error,
    });
    const rejected = assertRejects(
      () => result,
      TimeoutError,
      "owned operation timed out after 50ms",
    );

    await time.tickAsync(50);
    const error = await rejected;

    assertEquals((error as Error).name, "TimeoutError");
    assertEquals(observedError, error);
  });

  it("propagates an operation rejection before the deadline", async () => {
    const operationError = new Error("operation failed");

    const error = await assertRejects(
      () => withTimeoutThrow(Promise.reject(operationError), 1000, "failing operation"),
      Error,
      "operation failed",
    );

    assertEquals(error, operationError);
  });

  it("rejects a Proxy-wrapped operation promise without invoking traps", async () => {
    let trapCalls = 0;
    const operation = new Proxy(Promise.resolve("result"), {
      get() {
        trapCalls += 1;
        throw new Error("promise trap must not run");
      },
      getPrototypeOf() {
        trapCalls += 1;
        throw new Error("promise trap must not run");
      },
    });

    await assertRejects(
      () => withTimeoutThrow(operation, 50, "proxied operation"),
      TypeError,
      "Timeout operation must be an unwrapped native Promise",
    );
    assertEquals(trapCalls, 0);
  });

  it("rejects an own then shadow without reading it", async () => {
    let getterCalls = 0;
    const operation = Promise.resolve("result");
    Object.defineProperty(operation, "then", {
      configurable: true,
      get() {
        getterCalls += 1;
        throw new Error("own then getter must not run");
      },
    });

    await assertRejects(
      () => withTimeoutThrow(operation, 50, "shadowed operation"),
      TypeError,
      "Timeout operation must not override then",
    );
    assertEquals(getterCalls, 0);
  });

  it("preserves an active caller signal's abort reason", async () => {
    const controller = new AbortController();
    const abortReason = new Error("client disconnected");
    let observedReason: unknown;
    const result = withTimeoutThrow(hang(), 1000, "caller-owned operation", {
      signal: controller.signal,
      onAbort: (reason) => observedReason = reason,
    });

    controller.abort(abortReason);
    const error = await assertRejects(() => result, Error, "client disconnected");

    assertEquals(error, abortReason);
    assertEquals(observedReason, abortReason);
  });

  it("preserves an exact null caller abort reason", async () => {
    const controller = new AbortController();
    const result = withTimeoutThrow(hang(), 1000, "null-aborted operation", {
      signal: controller.signal,
    });
    controller.abort(null);

    let rejected = false;
    try {
      await result;
    } catch (error) {
      rejected = true;
      assertEquals(error, null);
    }
    assertEquals(rejected, true);
  });

  it("preserves an already-aborted caller signal's reason", async () => {
    const controller = new AbortController();
    const abortReason = new Error("request already closed");
    controller.abort(abortReason);

    const error = await assertRejects(
      () =>
        withTimeoutThrow(hang(), 1000, "pre-aborted operation", {
          signal: controller.signal,
        }),
      Error,
      "request already closed",
    );

    assertEquals(error, abortReason);
  });

  it("does not let a failing onAbort hook replace the abort reason", async () => {
    const controller = new AbortController();
    const abortReason = new Error("client disconnected");
    const result = withTimeoutThrow(hang(), 1000, "caller-owned operation", {
      signal: controller.signal,
      onAbort: () => {
        throw new Error("abort callback failed");
      },
    });

    controller.abort(abortReason);
    const error = await assertRejects(() => result, Error, "client disconnected");

    assertEquals(error, abortReason);
  });

  it("does not let a failing onTimeout hook replace the timeout error", async () => {
    using time = new FakeTime();
    const result = withTimeoutThrow(hang(), 50, "owned operation", {
      onTimeout: () => {
        throw new Error("timeout callback failed");
      },
    });
    const rejected = assertRejects(
      () => result,
      TimeoutError,
      "owned operation timed out after 50ms",
    );

    await time.tickAsync(50);
    await rejected;
  });

  it("snapshots callbacks before asynchronous work can mutate the options", async () => {
    using time = new FakeTime();
    let originalCalls = 0;
    let replacementCalls = 0;
    const options = {
      onTimeout: () => originalCalls += 1,
    };
    const result = withTimeoutThrow(hang(), 50, "snapshotted operation", options);
    options.onTimeout = () => replacementCalls += 1;
    const rejected = assertRejects(() => result, TimeoutError);

    await time.tickAsync(50);
    await rejected;

    assertEquals(originalCalls, 1);
    assertEquals(replacementCalls, 0);
  });

  it("rejects accessor-backed options without invoking the accessor", async () => {
    let accessorCalls = 0;
    const options = {} as TimeoutOptionsForTest;
    Object.defineProperty(options, "signal", {
      enumerable: true,
      get() {
        accessorCalls += 1;
        return new AbortController().signal;
      },
    });

    await assertRejects(
      () => withTimeoutThrow(hang(), 50, "unsafe options", options),
      TypeError,
      "Timeout option signal must be an own enumerable data property",
    );
    assertEquals(accessorCalls, 0);
  });

  it("rejects Proxy options without invoking their traps", async () => {
    let trapCalls = 0;
    const options = new Proxy({}, {
      getPrototypeOf() {
        trapCalls += 1;
        return Object.prototype;
      },
      ownKeys() {
        trapCalls += 1;
        return [];
      },
    });

    await assertRejects(
      () => withTimeoutThrow(hang(), 50, "proxied options", options),
      TypeError,
      "Timeout options must be a plain object",
    );
    assertEquals(trapCalls, 0);
  });

  it("rejects overridden AbortSignal instance fields without reading them", async () => {
    const signal = new AbortController().signal;
    let accessorCalls = 0;
    Object.defineProperty(signal, "reason", {
      configurable: true,
      get() {
        accessorCalls += 1;
        return new Error("must not be read");
      },
    });

    await assertRejects(
      () => withTimeoutThrow(hang(), 50, "overridden signal", { signal }),
      TypeError,
      "Timeout signal must not override reason",
    );
    assertEquals(accessorCalls, 0);
  });

  it("rejects deadlines outside the portable timer range", async () => {
    for (
      const timeoutMs of [
        -1,
        Number.NaN,
        Number.POSITIVE_INFINITY,
        MAX_TIMER_DELAY_MS + 1,
      ]
    ) {
      await assertRejects(
        () => withTimeoutThrow(hang(), timeoutMs, "invalid deadline"),
        RangeError,
      );
    }
  });

  it("lets caller cancellation win when it was scheduled first at the same deadline", async () => {
    using time = new FakeTime();
    const controller = new AbortController();
    const abortReason = new Error("caller deadline reached");
    let abortCalls = 0;
    let timeoutCalls = 0;
    setTimeout(() => controller.abort(abortReason), 50);
    const result = withTimeoutThrow(hang(), 50, "competing deadline", {
      signal: controller.signal,
      onAbort: () => abortCalls += 1,
      onTimeout: () => timeoutCalls += 1,
    });
    const rejected = result.then(
      () => undefined,
      (error: unknown) => error,
    );

    await time.tickAsync(50);

    assertEquals(await rejected, abortReason);
    assertEquals(abortCalls, 1);
    assertEquals(timeoutCalls, 0);
  });

  it("keeps parallel deadlines independent", async () => {
    using time = new FakeTime();
    const results = Promise.allSettled([
      withTimeoutThrow(delay(10, "fast"), 100, "fast operation"),
      withTimeoutThrow(hang(), 50, "slow operation"),
      withTimeoutThrow(delay(20, "also fast"), 100, "second fast operation"),
    ]);

    await time.tickAsync(50);
    const settled = await results;

    assertEquals(settled[0], { status: "fulfilled", value: "fast" });
    assertEquals(settled[1]?.status, "rejected");
    assertEquals(settled[2], { status: "fulfilled", value: "also fast" });
  });
});

interface TimeoutOptionsForTest {
  signal?: AbortSignal;
}
