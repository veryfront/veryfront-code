import { FakeTime } from "#std/testing/time";
import { assertEquals, assertInstanceOf, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AbortCleanupError,
  getPrimaryAbortReason,
  isAbortCleanupError,
  isNonCooperativeOperationError,
  NonCooperativeAbortError,
  runAbortableOperation,
  throwIfAbortedWithCleanup,
} from "./abortable-operation.ts";

describe("workflow runAbortableOperation", () => {
  it("preserves the ordered abort and cleanup failures without invoking hostile hooks", async () => {
    using time = new FakeTime();
    let trapCalls = 0;
    const hostileCleanup = new Proxy(Object.create(null), {
      get() {
        trapCalls++;
        throw new Error("cleanup get trap must not run");
      },
      getPrototypeOf() {
        trapCalls++;
        throw new Error("cleanup prototype trap must not run");
      },
    });
    const timeoutReason = new Error("iteration deadline");
    const execution = runAbortableOperation(
      (signal) =>
        new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(hostileCleanup), { once: true });
        }),
      {
        label: "hostile cleanup operation",
        timeout: { milliseconds: 5, reason: timeoutReason },
        cancellationGracePeriod: 5,
      },
    );
    const rejection = execution.then(
      () => undefined,
      (error: unknown) => error,
    );

    await time.tickAsync(5);
    const error = await rejection;

    assertEquals(isAbortCleanupError(error), true);
    assertInstanceOf(error, AbortCleanupError);
    assertStrictEquals(getPrimaryAbortReason(error as AbortCleanupError), timeoutReason);
    assertStrictEquals((error as AggregateError).errors[0], timeoutReason);
    assertStrictEquals((error as AggregateError).errors[1], hostileCleanup);
    assertEquals((error as Error).message.includes("Unknown error"), true);
    assertEquals(isNonCooperativeOperationError(hostileCleanup), false);
    assertEquals(trapCalls, 0);
  });

  it("marks an exact timeout reason when work survives the cancellation grace", async () => {
    using time = new FakeTime();
    const operation = Promise.withResolvers<void>();
    const timeoutReason = new Error("iteration deadline");
    const execution = runAbortableOperation(() => operation.promise, {
      label: "non-cooperative operation",
      timeout: { milliseconds: 5, reason: timeoutReason },
      cancellationGracePeriod: 5,
    });
    const rejection = execution.then(
      () => undefined,
      (error: unknown) => error,
    );

    try {
      await time.tickAsync(5);
      await time.tickAsync(5);
      const error = await rejection;

      assertStrictEquals(error, timeoutReason);
      assertEquals(isNonCooperativeOperationError(error), true);
    } finally {
      operation.resolve();
      await time.tickAsync(0);
    }
  });

  it("preserves an outer abort reason by identity after cooperative cleanup", async () => {
    const controller = new AbortController();
    const abortReason = new Error("caller disconnected");
    const started = Promise.withResolvers<void>();
    let receivedSignal: AbortSignal | undefined;
    const execution = runAbortableOperation(
      (signal) => {
        receivedSignal = signal;
        started.resolve();
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      },
      {
        label: "caller-owned operation",
        parentSignal: controller.signal,
        cancellationGracePeriod: 5,
      },
    );
    const rejection = execution.then(
      () => undefined,
      (error: unknown) => error,
    );

    await started.promise;
    controller.abort(abortReason);

    assertStrictEquals(await rejection, abortReason);
    assertEquals(receivedSignal?.aborted, true);
    assertStrictEquals(receivedSignal?.reason, abortReason);
  });

  it("keeps caller cancellation authoritative when it arrives during timeout cleanup", async () => {
    using time = new FakeTime();
    const controller = new AbortController();
    const timeoutReason = new Error("local deadline");
    const callerReason = new Error("caller disconnected");
    let receivedSignal: AbortSignal | undefined;
    const execution = runAbortableOperation(
      (signal) => {
        receivedSignal = signal;
        return new Promise<string>((resolve) => {
          signal.addEventListener("abort", () => {
            setTimeout(() => resolve("cleanup complete"), 3);
          }, { once: true });
        });
      },
      {
        label: "timeout race",
        parentSignal: controller.signal,
        timeout: { milliseconds: 5, reason: timeoutReason },
        cancellationGracePeriod: 10,
      },
    );
    const rejection = execution.then(
      () => undefined,
      (error: unknown) => error,
    );

    await time.tickAsync(5);
    await time.tickAsync(1);
    controller.abort(callerReason);
    await time.tickAsync(2);

    assertStrictEquals(await rejection, callerReason);
    assertStrictEquals(receivedSignal?.reason, timeoutReason);
  });

  it("aggregates a caller abort with a distinct cleanup rejection", async () => {
    const controller = new AbortController();
    const abortReason = new Error("caller disconnected");
    const cleanupError = new Error("cleanup failed");
    const started = Promise.withResolvers<void>();
    const execution = runAbortableOperation(
      (signal) => {
        started.resolve();
        return new Promise<never>((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(cleanupError), { once: true });
        });
      },
      {
        label: "caller cleanup",
        parentSignal: controller.signal,
        cancellationGracePeriod: 5,
      },
    );
    const rejection = execution.then(
      () => undefined,
      (error: unknown) => error,
    );

    await started.promise;
    controller.abort(abortReason);
    const error = await rejection;

    assertEquals(isAbortCleanupError(error), true);
    assertStrictEquals((error as AggregateError).errors[0], abortReason);
    assertStrictEquals((error as AggregateError).errors[1], cleanupError);
  });

  it("never reads a mutated marker property while propagating non-cooperation", () => {
    const controller = new AbortController();
    const abortReason = new Error("outer abort");
    const marker = new NonCooperativeAbortError(abortReason, "nested child");
    let getterCalls = 0;
    Object.defineProperty(marker, "primaryReason", {
      configurable: true,
      get() {
        getterCalls++;
        throw new Error("marker getter must not run");
      },
    });
    controller.abort(abortReason);

    let caught: unknown;
    try {
      throwIfAbortedWithCleanup(controller.signal, [marker], "parent batch");
    } catch (error) {
      caught = error;
    }

    assertStrictEquals(caught, abortReason);
    assertEquals(isNonCooperativeOperationError(caught), true);
    assertEquals(getterCalls, 0);
  });
});
