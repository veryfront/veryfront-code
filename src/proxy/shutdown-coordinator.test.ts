import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createProxyShutdownCoordinator } from "./shutdown-coordinator.ts";

function deferred(): {
  promise: Promise<void>;
  resolve: () => void;
} {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe("proxy shutdown coordinator", () => {
  it("handles one cleanup rejection through the shared terminal path", async () => {
    const cleanupError = new Error("unexpected cleanup failure");
    const handled: unknown[] = [];
    const coordinator = createProxyShutdownCoordinator({
      performShutdown: () => Promise.reject(cleanupError),
      reportListenerFailure: () => {},
      handleShutdownFailure: (error) => {
        handled.push(error);
      },
    });

    const signalShutdown = coordinator.request({
      source: "signal",
      signal: "SIGTERM",
    });
    const listenerShutdown = coordinator.request({
      source: "http-listener",
      error: new Error("listener failed during cleanup"),
    });

    assertStrictEquals(listenerShutdown, signalShutdown);
    await Promise.all([signalShutdown, listenerShutdown]);
    assertEquals(handled.length, 1);
    assertStrictEquals(handled[0], cleanupError);
  });

  it("shares one cleanup between a signal and a listener failure", async () => {
    const cleanup = deferred();
    const listenerError = new Error("listener failed");
    const reports: unknown[] = [];
    let cleanupCalls = 0;
    let observedFailureAtEnd = false;
    const coordinator = createProxyShutdownCoordinator({
      performShutdown: async (_request, state) => {
        cleanupCalls++;
        await cleanup.promise;
        observedFailureAtEnd = state.hasListenerFailure();
      },
      reportListenerFailure: (error) => {
        reports.push(error);
      },
      handleShutdownFailure: () => {},
    });

    const signalShutdown = coordinator.request({
      source: "signal",
      signal: "SIGTERM",
    });
    const listenerShutdown = coordinator.request({
      source: "http-listener",
      error: listenerError,
    });

    assertStrictEquals(listenerShutdown, signalShutdown);
    assertEquals(cleanupCalls, 1);
    assertEquals(coordinator.hasListenerFailure(), true);
    assertStrictEquals(reports[0], listenerError);

    cleanup.resolve();
    await Promise.all([signalShutdown, listenerShutdown]);
    assertEquals(observedFailureAtEnd, true);
    assertEquals(cleanupCalls, 1);
  });

  it("reports only the first listener failure and never double-cleans", async () => {
    const first = new Error("first");
    const second = new Error("second");
    const reports: unknown[] = [];
    let cleanupCalls = 0;
    const coordinator = createProxyShutdownCoordinator({
      performShutdown: () => {
        cleanupCalls++;
      },
      reportListenerFailure: (error) => {
        reports.push(error);
      },
      handleShutdownFailure: () => {},
    });

    const firstShutdown = coordinator.request({
      source: "http-listener",
      error: first,
    });
    const secondShutdown = coordinator.request({
      source: "http-listener",
      error: second,
    });
    await Promise.all([firstShutdown, secondShutdown]);

    assertStrictEquals(firstShutdown, secondShutdown);
    assertEquals(reports.length, 1);
    assertStrictEquals(reports[0], first);
    assertEquals(cleanupCalls, 1);
  });
});
