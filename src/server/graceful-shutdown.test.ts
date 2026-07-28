import { assertEquals, assertInstanceOf, assertStrictEquals } from "#veryfront/testing/assert.ts";
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

    let received: unknown;
    try {
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
    } catch (error) {
      received = error;
    }

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
    assertInstanceOf(received, AggregateError);
    assertEquals(received.errors.length, 2);
    assertInstanceOf(received.errors[0], Error);
    assertEquals(received.errors[0].name, "GracefulShutdownTimeoutError");
    assertEquals(
      received.errors[0].message,
      "Timed out while trying to dispose the production bootstrap",
    );
    assertInstanceOf(received.errors[1], Error);
    assertEquals(received.errors[1].name, "GracefulShutdownTimeoutError");
    assertEquals(received.errors[1].message, "Timed out while trying to shut down telemetry");
  });

  it("keeps bootstrap resources live when the HTTP listener fails to stop", async () => {
    const events: string[] = [];
    const warnings: string[] = [];
    const infos: string[] = [];
    const listenerError = new Error("listener still live");

    let received: unknown;
    try {
      await gracefullyShutdownProductionServerWithDependencies({
        signal: "SIGTERM",
        drainTimeoutMs: 0,
        abort: () => events.push("abort"),
        stop: () => {
          events.push("stop");
          return Promise.reject(listenerError);
        },
        dispose: () => {
          events.push("dispose");
        },
        logger: {
          info: (message) => infos.push(message),
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
    } catch (error) {
      received = error;
    }

    assertEquals(events, ["tracker-shutdown", "abort", "stop", "telemetry-shutdown"]);
    assertInstanceOf(received, AggregateError);
    assertEquals(received.errors.length, 1);
    assertStrictEquals(received.errors[0], listenerError);
    assertEquals(infos.includes("Graceful shutdown complete"), false);
    assertEquals(
      warnings.includes(
        "Skipping production bootstrap disposal because the HTTP server may still be live",
      ),
      true,
    );
    assertEquals(warnings.includes("Graceful shutdown incomplete"), true);
  });

  it("aggregates cleanup failures and timeouts in execution order", async () => {
    const events: string[] = [];
    const warnings: string[] = [];
    const abortError = new Error("abort failed");
    const telemetryError = new Error("telemetry failed");
    let received: unknown;

    try {
      await gracefullyShutdownProductionServerWithDependencies({
        signal: "SIGTERM",
        drainTimeoutMs: 0,
        cleanupTimeoutMs: 10,
        abort: () => {
          events.push("abort");
          throw abortError;
        },
        stop: () => {
          events.push("stop");
          return new Promise<void>(() => {});
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
          throw telemetryError;
        },
      });
    } catch (error) {
      received = error;
    }

    assertEquals(events, ["tracker-shutdown", "abort", "stop", "telemetry-shutdown"]);
    assertInstanceOf(received, AggregateError);
    assertEquals(received.errors.length, 3);
    assertStrictEquals(received.errors[0], abortError);
    assertInstanceOf(received.errors[1], Error);
    assertEquals(received.errors[1].name, "GracefulShutdownTimeoutError");
    assertEquals(
      received.errors[1].message,
      "Timed out while trying to stop the production server",
    );
    assertStrictEquals(received.errors[2], telemetryError);
    assertEquals(warnings.at(-1), "Graceful shutdown incomplete");
  });
});
