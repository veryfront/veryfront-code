import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __resetLogRecordEmitterForTests, agentLogger } from "#veryfront/utils/logger/index.ts";
import type {
  ApplicationErrorContext,
  ApplicationErrorReporter,
} from "#veryfront/observability/application-errors.ts";
import {
  captureApplicationError,
  setApplicationErrorReporter,
} from "#veryfront/observability/application-errors.ts";
import {
  createNodeAgentServiceLogApplicationErrorEmitter,
  initializeNodeAgentServiceSentryApplicationErrors,
  resolveNodeAgentServiceSentryConfig,
} from "./node-sentry.ts";

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

describe("agent/service/node-sentry", () => {
  it("resolves Agent Sentry config from the existing service env", () => {
    assertEquals(
      resolveNodeAgentServiceSentryConfig({
        SENTRY_DSN: " https://public@example.ingest.sentry.io/1 ",
        SENTRY_ENVIRONMENT: "staging",
        SENTRY_RELEASE: "release-1",
        SENTRY_SERVICE: "veryfront-agent",
      }),
      {
        dsn: "https://public@example.ingest.sentry.io/1",
        environment: "staging",
        release: "release-1",
        serviceName: "veryfront-agent",
      },
    );
    assertStrictEquals(resolveNodeAgentServiceSentryConfig({}), undefined);
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
    const lifecycle = await initializeNodeAgentServiceSentryApplicationErrors({
      env: {
        SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
        SENTRY_ENVIRONMENT: "staging",
      },
      loadExtension: () =>
        Promise.resolve({
          createNodeSentryApplicationErrorReporter: () => reporter,
        }),
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
      lifecycle.reset();
      withMutedConsole(() => {
        agentLogger.error("after reset");
      });
      assertEquals(otelRecords, ["agent failed", "after reset"]);
    } finally {
      lifecycle.reset();
      __resetLogRecordEmitterForTests();
      setApplicationErrorReporter(undefined);
    }
  });

  it("captures startup errors and uses a true wall-clock-bounded flush", async () => {
    const reporter = createReporter({ flush: () => new Promise<boolean>(() => {}) });
    const lifecycle = await initializeNodeAgentServiceSentryApplicationErrors({
      env: {
        SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
      },
      flushTimeoutMs: 5,
      loadExtension: () =>
        Promise.resolve({
          createNodeSentryApplicationErrorReporter: () => reporter,
        }),
    });

    try {
      const startupError = new Error("startup failed");
      lifecycle.captureStartupError(startupError);
      assertEquals(reporter.captured, [
        { error: startupError, context: { boundary: "agent.process.startup" } },
      ]);

      const started = Date.now();
      assertEquals(await lifecycle.flush(), false);
      assertEquals(Date.now() - started < 1_000, true);
      assertEquals(reporter.flushTimeouts, [5]);
    } finally {
      lifecycle.reset();
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
