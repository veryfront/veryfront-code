import { FakeTime } from "#std/testing/time";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { gracefullyShutdownProductionServerWithDependencies } from "#veryfront/server/graceful-shutdown.ts";
import { runProductionProcessOwner } from "#veryfront/server/production-shutdown-coordinator.ts";
import { requestTracker } from "#veryfront/server/runtime-handler/request-tracker.ts";

describe("production shutdown drain budget", () => {
  it("preserves cleanup time when the drain budget is shorter than the default polling interval", async () => {
    const time = new FakeTime();
    const events: string[] = [];
    const ready = Promise.withResolvers<void>();
    const shutdownStarted = Promise.withResolvers<void>();
    let requestShutdown: (() => void) | undefined;
    requestTracker.start("short-drain", "fixture", "/stream", "GET");
    const run = runProductionProcessOwner({
      start: () =>
        Promise.resolve({
          ready: Promise.resolve(),
          stop: () => {
            events.push("stop");
            return Promise.resolve();
          },
        }),
      onReady: () => ready.resolve(),
      shutdownTimeoutMs: 20,
      shutdown: (reason, server, abort) => {
        const shutdown = gracefullyShutdownProductionServerWithDependencies({
          signal: reason,
          drainTimeoutMs: 10,
          cleanupTimeoutMs: 10,
          abort,
          stop: server?.stop ?? (() => Promise.resolve()),
          dispose: () => {
            events.push("dispose");
          },
          logger: { info: () => {}, warn: () => {} },
        }, {
          markServerShuttingDown: () => {},
          setServerInitialized: () => {},
          requestTracker,
          shutdownTelemetry: () => {
            events.push("telemetry");
            return Promise.resolve();
          },
        }).then(() => {});
        shutdownStarted.resolve();
        return shutdown;
      },
      registerSignals: (handler) => {
        requestShutdown = () => handler("SIGTERM");
      },
      flush: () => {
        events.push("flush");
        return Promise.resolve();
      },
      exit: () => {
        events.push("exit");
      },
    });
    try {
      await ready.promise;
      requestShutdown?.();
      await shutdownStarted.promise;
      await time.tickAsync(10);
      await time.runMicrotasks();
      await time.tickAsync(10);
      await time.runMicrotasks();
      await run;
      assertEquals(events, ["dispose", "stop", "telemetry", "flush", "exit"]);
    } finally {
      requestTracker.complete("short-drain", 200);
      requestTracker.shutdown();
      await time.tickAsync(100);
      await run;
      time.restore();
    }
  });
});
