import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS,
  gracefullyShutdownProductionServerWithDependencies,
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
      "abort",
      "stop",
      "dispose",
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
      "abort",
      "stop",
      "dispose",
      "telemetry-shutdown",
    ]);
    assertEquals(
      warnings.includes("Graceful shutdown cleanup deadline exceeded"),
      true,
    );
  });

  it("keeps bootstrap resources live when the HTTP listener fails to stop", async () => {
    const events: string[] = [];
    const warnings: string[] = [];

    await gracefullyShutdownProductionServerWithDependencies({
      signal: "SIGTERM",
      drainTimeoutMs: 0,
      abort: () => events.push("abort"),
      stop: () => {
        events.push("stop");
        return Promise.reject(new Error("listener still live"));
      },
      dispose: () => {
        events.push("dispose");
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

    assertEquals(events, ["tracker-shutdown", "abort", "stop", "telemetry-shutdown"]);
    assertEquals(
      warnings.includes(
        "Skipping production bootstrap disposal because the HTTP server may still be live",
      ),
      true,
    );
  });
});
