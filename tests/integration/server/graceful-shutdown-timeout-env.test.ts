/**
 * The shutdown timeout fallbacks read SHUTDOWN_DRAIN_TIMEOUT_MS and
 * SHUTDOWN_CLEANUP_TIMEOUT_MS from the process environment, so these cases
 * mutate host state and belong with the integration suites. The hermetic
 * parsing and cleanup-ordering cases stay in src/server/graceful-shutdown.test.ts.
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/testing/deno-compat.ts";
import {
  DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS,
  gracefullyShutdownProductionServerWithDependencies,
} from "#veryfront/server/graceful-shutdown.ts";

const timeoutEnvKeys = ["SHUTDOWN_DRAIN_TIMEOUT_MS", "SHUTDOWN_CLEANUP_TIMEOUT_MS"] as const;

async function withShutdownTimeoutEnv(
  values: Partial<Record<typeof timeoutEnvKeys[number], string>>,
  run: () => Promise<void>,
): Promise<void> {
  const previous = timeoutEnvKeys.map((key) => [key, getEnv(key)] as const);
  for (const key of timeoutEnvKeys) {
    const value = values[key];
    if (value === undefined) deleteEnv(key);
    else setEnv(key, value);
  }

  try {
    await run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) deleteEnv(key);
      else setEnv(key, value);
    }
  }
}

describe("server/graceful-shutdown timeout environment fallbacks", () => {
  it("falls back to the shutdown timeout environment variables", async () => {
    await withShutdownTimeoutEnv(
      { SHUTDOWN_DRAIN_TIMEOUT_MS: "1234", SHUTDOWN_CLEANUP_TIMEOUT_MS: "5678" },
      async () => {
        let observedDrainTimeoutMs: number | undefined;
        let observedCleanupTimeoutMs: unknown;

        await gracefullyShutdownProductionServerWithDependencies({
          signal: "SIGTERM",
          abort: () => {},
          stop: () => Promise.resolve(),
          logger: {
            info: (_message, context) => {
              if (context && "cleanupTimeoutMs" in context) {
                observedCleanupTimeoutMs = context.cleanupTimeoutMs;
              }
            },
            warn: () => {},
          },
        }, {
          markServerShuttingDown: () => {},
          setServerInitialized: () => {},
          requestTracker: {
            getInFlightCount: () => 0,
            waitForDrain: (timeoutMs) => {
              observedDrainTimeoutMs = timeoutMs;
              return Promise.resolve(true);
            },
            shutdown: () => {},
          },
          shutdownTelemetry: () => Promise.resolve(),
        });

        assertEquals(
          observedDrainTimeoutMs,
          1234,
          "SHUTDOWN_DRAIN_TIMEOUT_MS must supply the drain budget, not the cleanup budget",
        );
        assertEquals(
          observedCleanupTimeoutMs,
          5678,
          "SHUTDOWN_CLEANUP_TIMEOUT_MS must supply the cleanup budget",
        );
      },
    );
  });

  it("ignores an invalid explicit drain timeout", async () => {
    await withShutdownTimeoutEnv({}, async () => {
      let observedDrainTimeoutMs: number | undefined;

      await gracefullyShutdownProductionServerWithDependencies({
        signal: "SIGTERM",
        drainTimeoutMs: -5,
        abort: () => {},
        stop: () => Promise.resolve(),
        logger: { info: () => {}, warn: () => {} },
      }, {
        markServerShuttingDown: () => {},
        setServerInitialized: () => {},
        requestTracker: {
          getInFlightCount: () => 0,
          waitForDrain: (timeoutMs) => {
            observedDrainTimeoutMs = timeoutMs;
            return Promise.resolve(true);
          },
          shutdown: () => {},
        },
        shutdownTelemetry: () => Promise.resolve(),
      });

      assertEquals(
        observedDrainTimeoutMs,
        DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS,
        "a negative explicit drain timeout must fall back, never reach waitForDrain",
      );
    });
  });
});
