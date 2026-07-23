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
      shutdownProjectIsolation: () => events.push("project-isolation-shutdown"),
      shutdownWorkerPool: () => events.push("worker-pool-shutdown"),
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
      "abort",
      "info:Server marked as not ready, waiting for in-flight requests to drain...",
      "drain:290000",
      "tracker-shutdown",
      "stop",
      "dispose",
      "project-isolation-shutdown",
      "worker-pool-shutdown",
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
      "abort",
      "warn:Drain timeout exceeded, forcing shutdown",
      "tracker-shutdown",
      "stop",
      "telemetry-shutdown",
    ]);
  });

  it("bounds cleanup and still invokes every cleanup action", async () => {
    const events: string[] = [];
    const warnings: string[] = [];
    let telemetryTimeoutMs: number | undefined;
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
      shutdownTelemetry: (timeoutMs) => {
        telemetryTimeoutMs = timeoutMs;
        events.push("telemetry-shutdown");
        return Promise.resolve();
      },
    });

    assertEquals(Date.now() - startedAt < 500, true);
    assertEquals(events, [
      "abort",
      "tracker-shutdown",
      "stop",
      "dispose",
      "telemetry-shutdown",
    ]);
    assertEquals(
      warnings.includes("Graceful shutdown cleanup deadline exceeded"),
      true,
    );
    assertEquals(telemetryTimeoutMs, 0);
  });

  it("does not expose cleanup error messages or stacks in shutdown logs", async () => {
    const records: unknown[] = [];
    const privateError = new Error("private-shutdown-payload-canary");
    privateError.stack = "private-shutdown-stack-canary";

    await gracefullyShutdownProductionServerWithDependencies({
      signal: "SIGTERM",
      drainTimeoutMs: 0,
      cleanupTimeoutMs: 100,
      abort: () => {
        throw privateError;
      },
      stop: () => Promise.reject(privateError),
      logger: {
        info: () => {},
        warn: (message, context) => records.push({ message, context }),
      },
    }, {
      markServerShuttingDown: () => {},
      setServerInitialized: () => {},
      requestTracker: {
        getInFlightCount: () => 0,
        waitForDrain: () => Promise.reject(privateError),
        shutdown: () => {
          throw privateError;
        },
      },
      shutdownTelemetry: () => Promise.reject(privateError),
    });

    const serialized = JSON.stringify(records);
    assertEquals(serialized.includes("private-shutdown-payload-canary"), false);
    assertEquals(serialized.includes("private-shutdown-stack-canary"), false);
    assertEquals(serialized.includes('"errorName":"Error"'), true);
  });
});
