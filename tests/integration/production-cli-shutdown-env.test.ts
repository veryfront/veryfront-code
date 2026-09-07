import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { setEnv, withEnv } from "#veryfront/testing/deno-compat.ts";
import { runProductionServer } from "../../cli/commands/serve/command.ts";

describe("production CLI shutdown environment", () => {
  it("uses one post-bootstrap timeout budget throughout CLI shutdown", async () => {
    await withEnv(
      {
        SHUTDOWN_DRAIN_TIMEOUT_MS: "1000",
        SHUTDOWN_CLEANUP_TIMEOUT_MS: "2000",
      },
      async () => {
        const shutdownTimeouts: Array<{
          drainTimeoutMs: number | undefined;
          cleanupTimeoutMs: number | undefined;
        }> = [];

        await runProductionServer(
          {
            mode: "production",
            port: 0,
            bindAddress: "127.0.0.1",
            splitMode: false,
            useBinary: false,
            binaryPath: "./bin/veryfront",
            debug: false,
          },
          {
            ensureBundlerContracts: () => Promise.resolve(),
            initializeErrorReporting: () => Promise.resolve(),
            initializeRuntime: () => Promise.resolve(),
            startServer: async ({ onMemoryRecycle }) => {
              // The server bootstrap has loaded project .env values by the time
              // it can request recycling.
              setEnv("SHUTDOWN_DRAIN_TIMEOUT_MS", "3000");
              setEnv("SHUTDOWN_CLEANUP_TIMEOUT_MS", "4000");
              await onMemoryRecycle?.({
                rssMB: 101,
                rssThresholdMB: 100,
                consecutiveSamples: 2,
              });

              // Later environment writes cannot change an in-flight shutdown's
              // deadline or its drain/cleanup split.
              setEnv("SHUTDOWN_DRAIN_TIMEOUT_MS", "5000");
              setEnv("SHUTDOWN_CLEANUP_TIMEOUT_MS", "6000");
              return { ready: Promise.resolve(), stop: () => Promise.resolve() };
            },
            gracefullyShutdown: (options) => {
              shutdownTimeouts.push({
                drainTimeoutMs: options.drainTimeoutMs,
                cleanupTimeoutMs: options.cleanupTimeoutMs,
              });
              return Promise.resolve(true);
            },
            registerTerminationSignals: () => undefined,
            exit: () => {},
            reporter: {
              captureApplicationError: () => undefined,
              flushApplicationErrors: () => Promise.resolve(true),
            },
          },
        );

        assertEquals(shutdownTimeouts, [{
          drainTimeoutMs: 3000,
          cleanupTimeoutMs: 4000,
        }]);
      },
    );
  });
});
