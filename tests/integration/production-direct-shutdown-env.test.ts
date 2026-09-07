import { runDirectProductionServer } from "#veryfront/server/production-server.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";

describe("direct production shutdown environment", () => {
  it("uses the process timeout budget when a signal arrives before adapter acquisition", async () => {
    await withEnv(
      {
        SHUTDOWN_DRAIN_TIMEOUT_MS: "0",
        SHUTDOWN_CLEANUP_TIMEOUT_MS: "0",
      },
      async () => {
        const releaseFlush = Promise.withResolvers<void>();
        let receivedTimeouts: [number | undefined, number | undefined] | undefined;
        const run = runDirectProductionServer({
          initializeErrorReporting: () => new Promise<void>(() => {}),
          registerSignals: (handler) => {
            queueMicrotask(() => handler("SIGTERM"));
          },
          gracefullyShutdown: (options) => {
            receivedTimeouts = [options.drainTimeoutMs, options.cleanupTimeoutMs];
            options.abort();
            return Promise.resolve(true);
          },
          flush: () => releaseFlush.promise,
          captureError: () => {},
          exit: () => {},
        });

        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const outcome = await Promise.race([
            run.then(() => "completed"),
            new Promise<string>((resolve) => {
              timer = setTimeout(() => resolve("still waiting"), 50);
            }),
          ]);
          assertEquals(outcome, "completed");
          assertEquals(receivedTimeouts, [0, 0]);
        } finally {
          if (timer !== undefined) clearTimeout(timer);
          releaseFlush.resolve();
          await run;
        }
      },
    );
  });
});
