import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { ProxyShutdownStepFailure } from "./shutdown.ts";
import { createProxyStartupRollback } from "./startup-rollback.ts";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

describe("proxy startup rollback", () => {
  it("owns an acquisition before cancellation can win its late result", async () => {
    const resourceReady = deferred<{ close(): void }>();
    const controller = new AbortController();
    const interruption = new Error("startup interrupted");
    const events: string[] = [];
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });

    const acquiring = rollback.acquire(
      "late-resource",
      () => {
        events.push("acquire");
        return resourceReady.promise;
      },
      (resource: { close(): void }) => resource.close(),
      controller.signal,
    );
    await Promise.resolve();
    controller.abort(interruption);
    resourceReady.resolve({
      close: () => events.push("close"),
    });

    let rejection: unknown;
    try {
      await acquiring;
    } catch (error) {
      rejection = error;
    }

    assertStrictEquals(rejection, interruption);
    assertEquals(events, ["acquire", "close"]);
  });

  it("invokes acquisition producers without Promise callback arguments", async () => {
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });
    let argumentCount = -1;

    await rollback.acquire(
      "resource",
      function () {
        argumentCount = arguments.length;
        return Object.freeze({});
      },
      () => {},
    );

    assertEquals(argumentCount, 0);
    assertEquals(rollback.commit(), true);
  });

  it("honors ownership transferred by an earlier late cleanup", async () => {
    const cacheReady = deferred<{ close(): void }>();
    const controller = new AbortController();
    const interruption = new Error("startup interrupted");
    const events: string[] = [];
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });
    const releaseStore = rollback.own("store", () => {
      events.push("store");
    });

    const acquiring = rollback.acquire(
      "cache",
      () => cacheReady.promise,
      async (cache: { close(): void }) => {
        await cache.close();
        releaseStore();
      },
      controller.signal,
    );
    await Promise.resolve();
    controller.abort(interruption);
    cacheReady.resolve({ close: () => events.push("cache") });

    let rejection: unknown;
    try {
      await acquiring;
    } catch (error) {
      rejection = error;
    }

    assertStrictEquals(rejection, interruption);
    assertEquals(events, ["cache"]);
  });

  it("retains direct ownership when a late aggregate cleanup fails", async () => {
    const cacheReady = deferred<{ close(): Promise<void> }>();
    const controller = new AbortController();
    const interruption = new Error("startup interrupted");
    const cacheCloseError = new Error("cache close failed");
    const events: string[] = [];
    const cleanupFailures: ProxyShutdownStepFailure[] = [];
    const rollback = createProxyStartupRollback({
      cleanupTimeoutMs: 100,
      reportCleanupFailure: (failure) => cleanupFailures.push(failure),
    });
    const releaseStore = rollback.own("store", () => {
      events.push("store");
    });

    const acquiring = rollback.acquire(
      "cache",
      () => cacheReady.promise,
      async (cache: { close(): Promise<void> }) => {
        await cache.close();
        releaseStore();
      },
      controller.signal,
    );
    await Promise.resolve();
    controller.abort(interruption);
    cacheReady.resolve({
      close: () => {
        events.push("cache");
        return Promise.reject(cacheCloseError);
      },
    });

    let rejection: unknown;
    try {
      await acquiring;
    } catch (error) {
      rejection = error;
    }

    assertStrictEquals(rejection, interruption);
    assertEquals(events, ["cache", "store"]);
    assertEquals(cleanupFailures.length, 1);
    assertEquals(cleanupFailures[0]?.step, "cache");
    assertStrictEquals(
      cleanupFailures[0]?.status === "failed" ? cleanupFailures[0].error : undefined,
      cacheCloseError,
    );
  });

  it("observes a rejected producer returned after reentrant cancellation", async () => {
    const controller = new AbortController();
    const interruption = new Error("startup interrupted");
    const producerFailure = new Error("producer failed");
    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });
    let observations = 0;
    const rejectedProducer = {
      then(_resolve: (value: never) => unknown, reject: (reason: unknown) => unknown) {
        observations++;
        reject(producerFailure);
      },
    } as unknown as PromiseLike<never>;

    let rejection: unknown;
    try {
      await rollback.run(() => {
        controller.abort(interruption);
        return rejectedProducer;
      }, controller.signal);
    } catch (error) {
      rejection = error;
    }

    assertStrictEquals(rejection, interruption);
    assertEquals(observations, 1);
  });

  it("does not misreport a late producer rejection as cleanup failure", async () => {
    const resourceReady = deferred<{ close(): void }>();
    const controller = new AbortController();
    const interruption = new Error("startup interrupted");
    const producerFailure = new Error("late producer failure");
    const cleanupFailures: ProxyShutdownStepFailure[] = [];
    const rollback = createProxyStartupRollback({
      cleanupTimeoutMs: 100,
      reportCleanupFailure: (failure) => cleanupFailures.push(failure),
    });
    let cleanupCalls = 0;

    const acquiring = rollback.acquire(
      "late-resource",
      () => resourceReady.promise,
      () => {
        cleanupCalls++;
      },
      controller.signal,
    );
    await Promise.resolve();
    controller.abort(interruption);
    resourceReady.reject(producerFailure);

    let rejection: unknown;
    try {
      await acquiring;
    } catch (error) {
      rejection = error;
    }

    assertStrictEquals(rejection, interruption);
    assertEquals(cleanupCalls, 0);
    assertEquals(cleanupFailures, []);
  });

  it("closes a producer that resolves after the rollback deadline", async () => {
    const resourceReady = deferred<{ close(): void }>();
    const controller = new AbortController();
    const interruption = new Error("startup interrupted");
    const cleanupFailures: ProxyShutdownStepFailure[] = [];
    const rollback = createProxyStartupRollback({
      cleanupTimeoutMs: 0,
      reportCleanupFailure: (failure) => cleanupFailures.push(failure),
    });
    let closeCalls = 0;

    const acquiring = rollback.acquire(
      "late-resource",
      () => resourceReady.promise,
      (resource: { close(): void }) => resource.close(),
      controller.signal,
    );
    await Promise.resolve();
    controller.abort(interruption);

    let rejection: unknown;
    try {
      await acquiring;
    } catch (error) {
      rejection = error;
    }
    assertStrictEquals(rejection, interruption);
    assertEquals(cleanupFailures.map(({ step, status }) => ({ step, status })), [
      { step: "late-resource", status: "timeout" },
    ]);

    resourceReady.resolve({
      close: () => {
        closeCalls++;
      },
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    assertEquals(closeCalls, 1);
  });

  it("releases later acquisitions first and preserves the startup error", async () => {
    const events: string[] = [];
    const startupError = new Error("HTTP listener failed");
    const rollback = createProxyStartupRollback({
      cleanupTimeoutMs: 100,
    });

    rollback.own("renderer-router", () => {
      events.push("renderer-router");
    });
    rollback.own("proxy-handler", async () => {
      await Promise.resolve();
      events.push("proxy-handler");
    });

    let rejection: unknown;
    try {
      await rollback.run(() => {
        throw startupError;
      });
    } catch (error) {
      rejection = error;
    }

    assertStrictEquals(rejection, startupError);
    assertEquals(events, ["proxy-handler", "renderer-router"]);
  });

  it("supports explicit ownership transfer without closing a resource twice", async () => {
    const events: string[] = [];
    const startupError = new Error("routing bus failed");
    const rollback = createProxyStartupRollback({
      cleanupTimeoutMs: 100,
    });

    const releaseCache = rollback.own("token-cache", () => {
      events.push("token-cache");
    });
    rollback.own("proxy-handler", () => {
      events.push("proxy-handler");
    });
    releaseCache();
    releaseCache();

    await assertRejects(
      () => rollback.run(() => Promise.reject(startupError)),
      Error,
      startupError.message,
    );
    assertEquals(events, ["proxy-handler"]);
  });

  it("bounds rollback, continues cleanup, and reports failures", async () => {
    const events: string[] = [];
    const reported: ProxyShutdownStepFailure[] = [];
    const startupError = new Error("late startup failure");
    const cleanupError = new Error("server close failed");
    const rollback = createProxyStartupRollback({
      cleanupTimeoutMs: 5,
      reportCleanupFailure: (failure) => {
        reported.push(failure);
      },
    });

    rollback.own("final-sync-cleanup", () => {
      events.push("final-sync-cleanup");
    });
    rollback.own("failed-cleanup", () => {
      events.push("failed-cleanup");
      throw cleanupError;
    });
    rollback.own("stalled-cleanup", () => new Promise<void>(() => {}));

    const startedAt = performance.now();
    let rejection: unknown;
    try {
      await rollback.run(() => Promise.reject(startupError));
    } catch (error) {
      rejection = error;
    }

    assertEquals(performance.now() - startedAt < 500, true);
    assertStrictEquals(rejection, startupError);
    assertEquals(events, ["failed-cleanup", "final-sync-cleanup"]);
    assertEquals(reported.map(({ step, status }) => ({ step, status })), [
      { step: "stalled-cleanup", status: "timeout" },
      { step: "failed-cleanup", status: "failed" },
    ]);
    assertStrictEquals(
      reported[1]?.status === "failed" ? reported[1].error : undefined,
      cleanupError,
    );
  });

  it("does not let a diagnostic callback replace the startup error", async () => {
    const startupError = new Error("startup failed");
    const rollback = createProxyStartupRollback({
      cleanupTimeoutMs: 100,
      reportStartupFailure: () => {
        throw new Error("startup diagnostic sink failed");
      },
      reportCleanupFailure: () => {
        throw new Error("diagnostic sink failed");
      },
    });
    rollback.own("cleanup", () => {
      throw new Error("cleanup failed");
    });

    let rejection: unknown;
    try {
      await rollback.run(() => Promise.reject(startupError));
    } catch (error) {
      rejection = error;
    }
    assertStrictEquals(rejection, startupError);
  });

  it("commits once, disarms cleanup, and rejects later startup stages", async () => {
    const events: string[] = [];
    const rollback = createProxyStartupRollback({
      cleanupTimeoutMs: 100,
    });
    rollback.own("resource", () => {
      events.push("resource");
    });

    const value = await rollback.run(async () => {
      assertEquals(rollback.commit(), true);
      await Promise.resolve();
      return "ready";
    });

    assertEquals(value, "ready");
    assertEquals(rollback.commit(), false);
    assertEquals(events, []);
    assertThrows(
      () => rollback.own("late-resource", () => {}),
      Error,
      "no longer accepting resources",
    );
    await assertRejects(
      () => rollback.run(() => Promise.resolve()),
      Error,
      "already committed",
    );
  });

  it("reports the startup failure before reverse cleanup and flush work", async () => {
    const startupError = new Error("startup failed");
    const events: string[] = [];
    const rollback = createProxyStartupRollback({
      cleanupTimeoutMs: 100,
      reportStartupFailure: (error) => {
        assertStrictEquals(error, startupError);
        events.push("capture");
      },
    });
    rollback.own("application-errors", () => {
      events.push("flush");
    });
    rollback.own("resource", () => {
      events.push("resource");
    });

    await assertRejects(
      () => rollback.run(() => Promise.reject(startupError)),
      Error,
      startupError.message,
    );
    assertEquals(events, ["capture", "resource", "flush"]);
  });

  it("validates rollback policy before resources can be registered", () => {
    assertThrows(
      () => createProxyStartupRollback({ cleanupTimeoutMs: Number.NaN }),
      RangeError,
      "cleanup timeout",
    );

    const rollback = createProxyStartupRollback({ cleanupTimeoutMs: 100 });
    assertThrows(
      () => rollback.own(" cleanup ", () => {}),
      TypeError,
      "canonical name",
    );
  });
});
