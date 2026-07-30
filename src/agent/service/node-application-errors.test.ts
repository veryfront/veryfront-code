import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __resetLogRecordEmitterForTests, agentLogger } from "#veryfront/utils/logger/index.ts";
import type {
  ApplicationErrorContext,
  ApplicationErrorReporter,
  ApplicationErrorReporterInitializer,
} from "#veryfront/observability/application-errors.ts";
import {
  captureApplicationError,
  setApplicationErrorReporter,
} from "#veryfront/observability/application-errors.ts";
import {
  createNodeAgentServiceLogApplicationErrorEmitter,
  initializeNodeAgentServiceApplicationErrors,
} from "./node-application-errors.ts";

type CaptureRecord = {
  error: unknown;
  context: ApplicationErrorContext;
};

function withMutedConsole<T>(fn: () => T): T {
  const originalError = console.error;
  console.error = () => {};
  try {
    return fn();
  } finally {
    console.error = originalError;
  }
}

function createReporter(options: {
  flush?: () => Promise<boolean>;
  captureThrows?: boolean;
} = {}): ApplicationErrorReporter & {
  captured: CaptureRecord[];
  flushTimeouts: Array<number | undefined>;
} {
  const reporter = {
    captured: [] as CaptureRecord[],
    flushTimeouts: [] as Array<number | undefined>,
    capture(error: unknown, context: ApplicationErrorContext) {
      if (options.captureThrows) throw new Error("capture failed");
      reporter.captured.push({ error, context });
      return "event-id";
    },
    async flush(timeoutMs?: number) {
      reporter.flushTimeouts.push(timeoutMs);
      return await (options.flush?.() ?? Promise.resolve(true));
    },
  };
  return reporter;
}

function createInitializer(
  reporter: ApplicationErrorReporter,
  onDispose: () => void | Promise<void> = () => {},
): ApplicationErrorReporterInitializer {
  return {
    initialize: () => ({ reporter, dispose: onDispose }),
  };
}

describe("agent/service/node-application-errors", () => {
  it("stays explicitly disabled when no reporter initializer is selected", async () => {
    const lifecycle = await initializeNodeAgentServiceApplicationErrors({});
    assertEquals(lifecycle.enabled, false);
    assertEquals(await lifecycle.flush(), true);
    await lifecycle.dispose();
  });

  it("rejects invalid flush deadlines before changing reporter ownership", async () => {
    await assertRejects(
      () => initializeNodeAgentServiceApplicationErrors({ flushTimeoutMs: -1 }),
      RangeError,
      "non-negative timer delay",
    );
  });

  it("converts unexpected Agent error logs into application errors with structured attributes", () => {
    const reporter = createReporter();
    const emitter = createNodeAgentServiceLogApplicationErrorEmitter();
    const error = { name: "TypeError", message: "boom", stack: "stack" };

    try {
      setApplicationErrorReporter(reporter);
      emitter({
        timestamp: "2026-07-29T00:00:00.000Z",
        level: "error",
        service: "agent",
        component: "runtime",
        veryfrontVersion: "0.0.0",
        message: "runtime failed",
        error,
        request_id: "req-1",
        trace_id: "trace-1",
        span_id: "span-1",
        project_id: "project-1",
        project_slug: "test-project",
        run_id: "run-1",
        agent_id: "agent-1",
        conversation_id: "conversation-1",
        tool_name: "create_file",
        duration_ms: 123,
      });

      assertEquals(reporter.captured.length, 1);
      const captured = reporter.captured[0];
      assertExists(captured);
      assertEquals(captured.error instanceof Error ? captured.error.message : "", "boom");
      assertEquals(captured.context, {
        boundary: "agent.framework-log",
        requestId: "req-1",
        traceId: "trace-1",
        spanId: "span-1",
        attributes: {
          "log.service": "agent",
          "log.component": "runtime",
          "request.id": "req-1",
          "trace.id": "trace-1",
          "span.id": "span-1",
          "project.id": "project-1",
          "project.slug": "test-project",
          "run.id": "run-1",
          "agent.id": "agent-1",
          "conversation.id": "conversation-1",
          "tool.name": "create_file",
          "duration.ms": 123,
        },
      });
    } finally {
      setApplicationErrorReporter(undefined);
    }
  });

  it("filters expected Agent AbortError, known error-code, and 4xx status logs", () => {
    const reporter = createReporter();
    const emitter = createNodeAgentServiceLogApplicationErrorEmitter();
    try {
      setApplicationErrorReporter(reporter);
      for (
        const entry of [
          { error: { name: "AbortError", message: "aborted" } },
          { context: { errorCode: "VALIDATION_ERROR" } },
          { context: { statusCode: 404 } },
        ]
      ) {
        emitter({
          timestamp: "2026-07-29T00:00:00.000Z",
          level: "error",
          service: "agent",
          veryfrontVersion: "0.0.0",
          message: "expected",
          ...entry,
        });
      }

      assertEquals(reporter.captured, []);
    } finally {
      setApplicationErrorReporter(undefined);
    }
  });

  it("initializes before OTel, coexists with OTel emitter, isolates capture failures, and cleans up", async () => {
    const reporter = createReporter({ captureThrows: true });
    const otelRecords: string[] = [];
    const lifecycle = await initializeNodeAgentServiceApplicationErrors({
      initializer: createInitializer(reporter),
    });

    try {
      assertEquals(lifecycle.enabled, true);
      const { __registerLogRecordEmitter } = await import("#veryfront/utils/logger/index.ts");
      __registerLogRecordEmitter((entry) => {
        otelRecords.push(entry.message);
      });

      withMutedConsole(() => {
        agentLogger.error("agent failed");
      });

      assertEquals(otelRecords, ["agent failed"]);
      await lifecycle.dispose();
      withMutedConsole(() => {
        agentLogger.error("after reset");
      });
      assertEquals(otelRecords, ["agent failed", "after reset"]);
    } finally {
      await lifecycle.dispose();
      __resetLogRecordEmitterForTests();
      setApplicationErrorReporter(undefined);
    }
  });

  it("captures one startup error, leaves OTel log delivery intact, and flushes once", async () => {
    const reporter = createReporter({ flush: () => new Promise<boolean>(() => {}) });
    const otelRecords: string[] = [];
    const lifecycle = await initializeNodeAgentServiceApplicationErrors({
      flushTimeoutMs: 5,
      initializer: createInitializer(reporter),
    });

    try {
      const { __registerLogRecordEmitter } = await import("#veryfront/utils/logger/index.ts");
      __registerLogRecordEmitter((entry) => {
        otelRecords.push(entry.message);
      });

      const startupError = new Error("startup failed");
      lifecycle.captureStartupError(startupError);
      withMutedConsole(() => {
        agentLogger.error("Error in server startup:", { error: startupError });
      });
      assertEquals(reporter.captured, [
        { error: startupError, context: { boundary: "agent.process.startup" } },
      ]);
      assertEquals(otelRecords, ["Error in server startup:"]);

      const started = Date.now();
      assertEquals(await lifecycle.flush(), false);
      assertEquals(Date.now() - started < 1_000, true);
      assertEquals(reporter.flushTimeouts, [5]);
    } finally {
      await lifecycle.dispose();
      __resetLogRecordEmitterForTests();
      setApplicationErrorReporter(undefined);
    }
  });

  it("repeated initialization replaces subscribers and stale disposal cannot clear the newer reporter", async () => {
    const firstReporter = createReporter();
    const secondReporter = createReporter();

    const firstLifecycle = await initializeNodeAgentServiceApplicationErrors({
      initializer: createInitializer(firstReporter),
    });
    const secondLifecycle = await initializeNodeAgentServiceApplicationErrors({
      initializer: createInitializer(secondReporter),
    });

    try {
      withMutedConsole(() => {
        agentLogger.error("after replace");
      });
      assertEquals(firstReporter.captured, []);
      assertEquals(secondReporter.captured.length, 1);

      await firstLifecycle.dispose();
      withMutedConsole(() => {
        agentLogger.error("after stale reset");
      });
      assertEquals(firstReporter.captured, []);
      assertEquals(secondReporter.captured.length, 2);

      await secondLifecycle.dispose();
      withMutedConsole(() => {
        agentLogger.error("after current reset");
      });
      assertEquals(secondReporter.captured.length, 2);
    } finally {
      await firstLifecycle.dispose();
      await secondLifecycle.dispose();
      __resetLogRecordEmitterForTests();
      setApplicationErrorReporter(undefined);
    }
  });

  it("prevents stale concurrent initialization from winning reporter ownership", async () => {
    const firstReporter = createReporter();
    const secondReporter = createReporter();
    let markFirstStarted: (() => void) | undefined;
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    let resolveFirst:
      | ((session: { reporter: ApplicationErrorReporter; dispose(): void }) => void)
      | undefined;
    const firstInit = initializeNodeAgentServiceApplicationErrors({
      initializer: {
        initialize: () =>
          new Promise((resolve) => {
            resolveFirst = resolve;
            markFirstStarted?.();
          }),
      },
    });
    await firstStarted;
    const secondPending = initializeNodeAgentServiceApplicationErrors({
      initializer: createInitializer(secondReporter),
    });
    resolveFirst?.({
      reporter: firstReporter,
      dispose() {},
    });
    const firstLifecycle = await firstInit;
    const secondLifecycle = await secondPending;

    try {
      assertEquals(firstLifecycle.enabled, false);
      withMutedConsole(() => {
        agentLogger.error("after concurrent init");
      });
      assertEquals(firstReporter.captured, []);
      assertEquals(secondReporter.captured.length, 1);
    } finally {
      await firstLifecycle.dispose();
      await secondLifecycle.dispose();
      __resetLogRecordEmitterForTests();
      setApplicationErrorReporter(undefined);
    }
  });

  it("isolates reporter capture failures from direct application error capture", () => {
    const reporter = createReporter({ captureThrows: true });
    try {
      setApplicationErrorReporter(reporter);
      assertStrictEquals(
        captureApplicationError(new Error("boom"), { boundary: "agent.framework-log" }),
        undefined,
      );
    } finally {
      setApplicationErrorReporter(undefined);
    }
  });
});
