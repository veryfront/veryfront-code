import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { bootstrapAgentService, runAgentServiceMain } from "./bootstrap.ts";
import type { AbortRejectionProcessTarget } from "./abort-rejection-guard.ts";
import type { AgentServiceTraceContextGetter } from "./bootstrap.ts";

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
    let registeredTraceContext: AgentServiceTraceContextGetter | undefined;

    await bootstrapAgentService({
      initializeApplicationErrors: () => {
        events.push("initialize-application-errors");
      },
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
      "initialize-application-errors",
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
      initializeApplicationErrors: () => {
        events.push("initialize-application-errors");
      },
      initializeTelemetry: () => {
        events.push("initialize-telemetry");
        return true;
      },
      start: () => {
        events.push("start");
        throw new Error("startup failed");
      },
      onStartupError: (error) => {
        events.push(error instanceof Error ? error.message : String(error));
      },
      onFinally: () => {
        events.push("cleanup");
      },
      exit: (code) => {
        exitCode = code;
      },
    });

    assertEquals(events, [
      "initialize-application-errors",
      "initialize-telemetry",
      "start",
      "startup failed",
      "cleanup",
    ]);
    assertStrictEquals(exitCode, 1);
    assertStrictEquals(processTarget.listenerCount(), 1);
  });

  it("propagates fatal startup errors when no exit hook is provided", async () => {
    const events: string[] = [];
    const processTarget = createProcessTarget();

    await assertRejects(
      () =>
        runAgentServiceMain({
          processTarget: processTarget.target,
          initializeApplicationErrors: () => {
            events.push("initialize-application-errors");
          },
          initializeTelemetry: () => {
            events.push("initialize-telemetry");
            return true;
          },
          start: () => {
            events.push("start");
            throw new Error("startup failed");
          },
          onStartupError: (error) => {
            events.push(error instanceof Error ? error.message : String(error));
          },
          onFinally: () => {
            events.push("cleanup");
          },
        }),
      Error,
      "startup failed",
      "a startup error must propagate when no exit hook is provided",
    );

    assertEquals(
      events,
      [
        "initialize-application-errors",
        "initialize-telemetry",
        "start",
        "startup failed",
        "cleanup",
      ],
      "onFinally must still run when the error propagates",
    );
  });
});
