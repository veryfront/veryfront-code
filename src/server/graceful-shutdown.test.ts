import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DEFAULT_SHUTDOWN_CLEANUP_TIMEOUT_MS,
  DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS,
  gracefullyShutdownProductionServerWithDependencies,
  parseShutdownCleanupTimeoutMs,
  parseShutdownDrainTimeoutMs,
} from "./graceful-shutdown.ts";

describe("server/graceful-shutdown", () => {
  it("parses a configured drain timeout and rejects invalid values", () => {
    assertEquals(parseShutdownDrainTimeoutMs("290000"), 290_000);
    assertEquals(parseShutdownDrainTimeoutMs("0"), 0);
    assertEquals(parseShutdownDrainTimeoutMs(""), DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS);
    assertEquals(parseShutdownDrainTimeoutMs("   "), DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS);
    assertEquals(parseShutdownDrainTimeoutMs("invalid"), DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS);
    assertEquals(parseShutdownDrainTimeoutMs("-1"), DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS);
  });

  it("parses a configured cleanup timeout and rejects invalid values", () => {
    assertEquals(
      parseShutdownCleanupTimeoutMs(undefined),
      DEFAULT_SHUTDOWN_CLEANUP_TIMEOUT_MS,
      "an unset cleanup timeout must fall back to the documented default",
    );
    assertEquals(parseShutdownCleanupTimeoutMs("1500"), 1500);
    assertEquals(parseShutdownCleanupTimeoutMs("0"), 0);
    for (const raw of ["", "   ", "invalid", "-1"]) {
      assertEquals(
        parseShutdownCleanupTimeoutMs(raw),
        DEFAULT_SHUTDOWN_CLEANUP_TIMEOUT_MS,
        `an unusable cleanup timeout (${JSON.stringify(raw)}) must fall back to the default`,
      );
    }
    assertEquals(
      DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS + DEFAULT_SHUTDOWN_CLEANUP_TIMEOUT_MS < 30_000,
      true,
      "drain plus cleanup must stay inside the 30s Kubernetes termination grace period",
    );
  });

  it("enters lame-duck mode and drains before stopping the server", async () => {
    const events: string[] = [];

    const drained = await gracefullyShutdownProductionServerWithDependencies({
      signal: "SIGTERM",
      drainTimeoutMs: 290_000,
      abort: () => events.push("abort"),
      dispose: () => {
        events.push("dispose");
      },
      stop: () => {
        events.push("stop");
        return Promise.resolve();
      },
      logger: {
        info: (message) => events.push(`info:${message}`),
        warn: (message) => events.push(`warn:${message}`),
      },
    }, {
      markServerShuttingDown: () => events.push("lame-duck"),
      setServerInitialized: (ready) => events.push(`ready:${ready}`),
      requestTracker: {
        getInFlightCount: () => 1,
        waitForDrain: (timeoutMs) => {
          events.push(`drain:${timeoutMs}`);
          return Promise.resolve(true);
        },
        shutdown: () => events.push("tracker-shutdown"),
      },
      shutdownTelemetry: () => {
        events.push("telemetry-shutdown");
        return Promise.resolve();
      },
    });

    assertEquals(drained, true);
    assertEquals(events, [
      "info:Received SIGTERM, initiating graceful shutdown...",
      "lame-duck",
      "ready:false",
      "info:Server marked as not ready, waiting for in-flight requests to drain...",
      "drain:290000",
      "tracker-shutdown",
      "dispose",
      "abort",
      "stop",
      "telemetry-shutdown",
      "info:Graceful shutdown complete",
    ]);
  });

  it("continues shutdown after the drain timeout", async () => {
    const events: string[] = [];

    const drained = await gracefullyShutdownProductionServerWithDependencies({
      signal: "SIGTERM",
      drainTimeoutMs: 25_000,
      abort: () => events.push("abort"),
      stop: () => {
        events.push("stop");
        return Promise.resolve();
      },
      logger: {
        info: () => {},
        warn: (message) => events.push(`warn:${message}`),
      },
    }, {
      markServerShuttingDown: () => {},
      setServerInitialized: () => {},
      requestTracker: {
        getInFlightCount: () => 2,
        waitForDrain: () => Promise.resolve(false),
        shutdown: () => events.push("tracker-shutdown"),
      },
      shutdownTelemetry: () => {
        events.push("telemetry-shutdown");
        return Promise.resolve();
      },
    });

    assertEquals(drained, false);
    assertEquals(events, [
      "warn:Drain timeout exceeded, forcing shutdown",
      "tracker-shutdown",
      "abort",
      "stop",
      "telemetry-shutdown",
    ]);
  });

  it("bounds cleanup and still invokes every cleanup action", async () => {
    const events: string[] = [];
    const warnings: string[] = [];
    const startedAt = Date.now();

    await gracefullyShutdownProductionServerWithDependencies({
      signal: "SIGTERM",
      drainTimeoutMs: 25_000,
      cleanupTimeoutMs: 20,
      abort: () => events.push("abort"),
      dispose: () => {
        events.push("dispose");
        return new Promise<void>(() => {});
      },
      stop: () => {
        events.push("stop");
        return Promise.resolve();
      },
      logger: {
        info: () => {},
        warn: (message) => warnings.push(message),
      },
    }, {
      markServerShuttingDown: () => {},
      setServerInitialized: () => {},
      requestTracker: {
        getInFlightCount: () => 0,
        waitForDrain: () => Promise.resolve(true),
        shutdown: () => events.push("tracker-shutdown"),
      },
      shutdownTelemetry: () => {
        events.push("telemetry-shutdown");
        return Promise.resolve();
      },
    });

    assertEquals(Date.now() - startedAt < 500, true);
    assertEquals(events, [
      "tracker-shutdown",
      "dispose",
      "abort",
      "stop",
      "telemetry-shutdown",
    ]);
    assertEquals(
      warnings.includes("Graceful shutdown cleanup deadline exceeded"),
      true,
    );
  });

  it("continues shutdown when the drain tracker itself rejects", async () => {
    const events: string[] = [];
    const warnings: string[] = [];

    const drained = await gracefullyShutdownProductionServerWithDependencies({
      signal: "SIGTERM",
      drainTimeoutMs: 25_000,
      abort: () => events.push("abort"),
      stop: () => {
        events.push("stop");
        return Promise.resolve();
      },
      logger: {
        info: () => {},
        warn: (message) => warnings.push(message),
      },
    }, {
      markServerShuttingDown: () => {},
      setServerInitialized: () => {},
      requestTracker: {
        getInFlightCount: () => 2,
        waitForDrain: () => Promise.reject(new Error("tracker exploded")),
        shutdown: () => events.push("tracker-shutdown"),
      },
      shutdownTelemetry: () => {
        events.push("telemetry-shutdown");
        return Promise.resolve();
      },
    });

    assertEquals(drained, false, "a rejected waitForDrain must be treated as not drained");
    assertEquals(
      warnings.includes("Failed while waiting for in-flight requests to drain"),
      true,
      "the drain failure must be logged, not swallowed silently",
    );
    assertEquals(
      warnings.includes("Drain timeout exceeded, forcing shutdown"),
      true,
      "a rejected drain must take the forced-shutdown path",
    );
    assertEquals(
      events,
      ["tracker-shutdown", "abort", "stop", "telemetry-shutdown"],
      "every cleanup step must still run after a drain rejection",
    );
  });

  it("keeps cleaning up when a cleanup step throws synchronously", async () => {
    const events: string[] = [];
    const warnings: string[] = [];

    await gracefullyShutdownProductionServerWithDependencies({
      signal: "SIGTERM",
      drainTimeoutMs: 25_000,
      abort: () => {
        throw new Error("abort exploded");
      },
      stop: () => {
        events.push("stop");
        return Promise.resolve();
      },
      logger: {
        info: () => {},
        warn: (message) => warnings.push(message),
      },
    }, {
      markServerShuttingDown: () => {},
      setServerInitialized: () => {},
      requestTracker: {
        getInFlightCount: () => 0,
        waitForDrain: () => Promise.resolve(true),
        shutdown: () => events.push("tracker-shutdown"),
      },
      shutdownTelemetry: () => {
        events.push("telemetry-shutdown");
        return Promise.resolve();
      },
    });

    assertEquals(
      warnings.includes("Failed to abort the production server during graceful shutdown"),
      true,
      "a synchronously throwing cleanup step must be logged, not propagated",
    );
    assertEquals(
      events,
      ["tracker-shutdown", "stop", "telemetry-shutdown"],
      "a throwing abort must not skip the remaining cleanup steps",
    );
  });
});
