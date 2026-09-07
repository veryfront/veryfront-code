import { runProductionProcessOwner } from "#veryfront/server/production-shutdown-coordinator.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";

describe("production shutdown readiness rejection", () => {
  it("observes a late server readiness rejection while its stop is pending", async () => {
    const readinessError = new Error("late readiness failed");
    const releaseStop = Promise.withResolvers<void>();
    let requestSignal: (() => void) | undefined;
    let resumeStartup: (() => void) | undefined;
    const unhandled: unknown[] = [];
    const observeUnhandled = (event: PromiseRejectionEvent): void => {
      if (event.reason !== readinessError) return;
      event.preventDefault();
      unhandled.push(event.reason);
    };
    globalThis.addEventListener("unhandledrejection", observeUnhandled);

    const run = runProductionProcessOwner({
      start: () =>
        new Promise((resolve) => {
          resumeStartup = () =>
            resolve({
              ready: Promise.reject(readinessError),
              stop: () => releaseStop.promise,
            });
        }),
      shutdown: (_reason, _server, abort) => {
        abort();
        resumeStartup?.();
        return Promise.resolve();
      },
      shutdownTimeoutMs: 1_000,
      flush: () => Promise.resolve(),
      exit: () => {},
      registerSignals: (handler) => {
        requestSignal = () => handler("SIGTERM");
      },
    });

    try {
      requestSignal?.();
      await new Promise((resolve) => setTimeout(resolve, 20));
      assertEquals(unhandled, []);
    } finally {
      releaseStop.resolve();
      await run;
      globalThis.removeEventListener("unhandledrejection", observeUnhandled);
    }
  });
});
