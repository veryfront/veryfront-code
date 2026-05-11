import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { bootstrapAgentService, runAgentServiceMain } from "./agent-service-bootstrap.ts";
import type { AbortRejectionProcessTarget } from "./abort-rejection-guard.ts";

function createProcessTarget(): {
  target: AbortRejectionProcessTarget;
  listenerCount(): number;
} {
  const listeners: Array<(reason: unknown) => void> = [];
  return {
    target: {
      on(_event, listener) {
        listeners.push(listener);
      },
      off(_event, listener) {
        const index = listeners.indexOf(listener);
        if (index >= 0) listeners.splice(index, 1);
      },
    },
    listenerCount() {
      return listeners.length;
    },
  };
}

describe("agent/agent-service-bootstrap", () => {
  it("runs generic service startup steps in order", async () => {
    const events: string[] = [];
    const traceContext = { traceId: "trace-1", spanId: "span-1" };
    let registeredTraceContext: (() => typeof traceContext) | undefined;

    await bootstrapAgentService({
      initializeTelemetry: () => {
        events.push("initialize-telemetry");
        return true;
      },
      onTelemetryInitialized: () => {
        events.push("telemetry-initialized");
      },
      getTraceContext: () => traceContext,
      registerTraceContextGetter: (getter) => {
        events.push("register-trace-context");
        registeredTraceContext = getter;
      },
      start: () => {
        events.push("start");
      },
    });

    assertEquals(events, [
      "initialize-telemetry",
      "telemetry-initialized",
      "register-trace-context",
      "start",
    ]);
    assertEquals(registeredTraceContext?.(), traceContext);
  });

  it("skips telemetry initialized callback when telemetry setup is disabled", async () => {
    const events: string[] = [];

    await bootstrapAgentService({
      initializeTelemetry: () => {
        events.push("initialize-telemetry");
        return false;
      },
      onTelemetryInitialized: () => {
        events.push("telemetry-initialized");
      },
      start: () => {
        events.push("start");
      },
    });

    assertEquals(events, ["initialize-telemetry", "start"]);
  });

  it("handles fatal startup errors through the host callback and exit hook", async () => {
    const events: string[] = [];
    let exitCode: number | undefined;
    const processTarget = createProcessTarget();

    await runAgentServiceMain({
      processTarget: processTarget.target,
      start: () => {
        throw new Error("startup failed");
      },
      onStartupError: (error) => {
        events.push(error instanceof Error ? error.message : String(error));
      },
      exit: (code) => {
        exitCode = code;
      },
    });

    assertEquals(events, ["startup failed"]);
    assertStrictEquals(exitCode, 1);
    assertStrictEquals(processTarget.listenerCount(), 1);
  });
});
