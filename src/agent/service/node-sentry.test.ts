import { assertEquals, assertExists, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { __resetLogRecordEmitterForTests, agentLogger } from "#veryfront/utils/logger/logger.ts";
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
  resetNodeAgentServiceSentryForTests,
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
        SENTRY_ENABLED: "true",
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

  it("requires explicit Sentry enablement", () => {
    const dsn = "https://public@errors.example.test/42";

    assertEquals(
      resolveNodeAgentServiceSentryConfig({ SENTRY_ENABLED: "true", SENTRY_DSN: dsn })?.dsn,
      dsn,
    );
    assertStrictEquals(
      resolveNodeAgentServiceSentryConfig({ SENTRY_ENABLED: "false", SENTRY_DSN: dsn }),
      undefined,
    );
    assertStrictEquals(resolveNodeAgentServiceSentryConfig({ SENTRY_DSN: dsn }), undefined);
  });

  it("warns once without exposing secrets when Sentry is explicitly enabled without a DSN", async () => {
    resetNodeAgentServiceSentryForTests();
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    let loadCount = 0;
    try {
      console.warn = (...args: unknown[]) => warnings.push(args);

      const options = {
        env: {
          SENTRY_ENABLED: "true",
          SENTRY_DSN: "   ",
          SENTRY_AUTH_TOKEN: "super-secret-token",
        },
        loadExtension: () => {
          loadCount += 1;
          return Promise.resolve({
            createNodeSentryApplicationErrorReporter: () => createReporter(),
          });
        },
      };

      assertStrictEquals(resolveNodeAgentServiceSentryConfig(options.env), undefined);
      assertStrictEquals(resolveNodeAgentServiceSentryConfig(options.env), undefined);
      assertEquals(warnings, []);
      const lifecycles = await Promise.all([
        initializeNodeAgentServiceSentryApplicationErrors(options),
        initializeNodeAgentServiceSentryApplicationErrors(options),
        initializeNodeAgentServiceSentryApplicationErrors(options),
      ]);
      const repeated = await initializeNodeAgentServiceSentryApplicationErrors(options);

      assertEquals(lifecycles.map((lifecycle) => lifecycle.enabled), [false, false, false]);
      assertEquals(repeated.enabled, false);
      assertEquals(loadCount, 0);
      assertEquals(warnings, [[
        "Sentry is enabled, but SENTRY_DSN is empty. Sentry reporting is disabled.",
      ]]);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("does not warn or load the SDK when disabled or unset without a DSN", async () => {
    resetNodeAgentServiceSentryForTests();
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    let loadCount = 0;
    const loadExtension = () => {
      loadCount += 1;
      return Promise.resolve({
        createNodeSentryApplicationErrorReporter: () => createReporter(),
      });
    };
    try {
      console.warn = (...args: unknown[]) => warnings.push(args);

      const disabled = await initializeNodeAgentServiceSentryApplicationErrors({
        env: { SENTRY_ENABLED: "false", SENTRY_DSN: "   " },
        loadExtension,
      });
      const unset = await initializeNodeAgentServiceSentryApplicationErrors({
        env: { SENTRY_DSN: "   " },
        loadExtension,
      });

      assertEquals(disabled.enabled, false);
      assertEquals(unset.enabled, false);
      assertEquals(warnings, []);
      assertEquals(loadCount, 0);
    } finally {
      console.warn = originalWarn;
    }
  });

  it("does not load the Sentry SDK when explicitly disabled with a valid DSN", async () => {
    let loadCount = 0;
    const lifecycle = await initializeNodeAgentServiceSentryApplicationErrors({
      env: {
        SENTRY_ENABLED: "false",
        SENTRY_DSN: "https://public@errors.example.test/42",
      },
      loadExtension: () => {
        loadCount += 1;
        return Promise.resolve({
          createNodeSentryApplicationErrorReporter: () => createReporter(),
        });
      },
    });

    assertEquals(lifecycle.enabled, false);
    assertEquals(loadCount, 0);
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
        process_role: "api",
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
        processRole: "api",
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

      assertEquals(reporter.captured, [], "expected Agent error logs must not reach Sentry");

      for (
        const entry of [
          { message: "server exploded", context: { statusCode: 500 } },
          { message: "unknown code", context: { errorCode: "UNEXPECTED_RUNTIME_FAILURE" } },
        ]
      ) {
        emitter({
          timestamp: "2026-07-29T00:00:00.000Z",
          level: "error",
          service: "agent",
          veryfrontVersion: "0.0.0",
          ...entry,
        });
      }

      assertEquals(
        reporter.captured.length,
        2,
        "5xx status logs and non-whitelisted error codes must still reach Sentry",
      );
      assertEquals(
        reporter.captured.map((record) =>
          record.error instanceof Error ? record.error.message : ""
        ),
        ["server exploded", "unknown code"],
        "the unexpected logs are reported under their own log messages",
      );
    } finally {
      setApplicationErrorReporter(undefined);
    }
  });

  it("filters provider rate-limit error logs as expected upstream throttling", () => {
    // Sentry group VERYFRONT-AGENT-G (veryfront-issue-inbox#829): a provider
    // 429 thrown as ProviderRateLimitError reaches the agent error log without
    // a context statusCode, so the emitter reports expected upstream
    // throttling as an application error.
    const reporter = createReporter();
    const emitter = createNodeAgentServiceLogApplicationErrorEmitter();

    try {
      setApplicationErrorReporter(reporter);
      emitter({
        timestamp: "2026-08-30T00:00:00.000Z",
        level: "error",
        service: "agent",
        component: "runtime",
        veryfrontVersion: "0.0.0",
        message: "Chat stream failed",
        error: {
          name: "ProviderRateLimitError",
          message: "veryfront-cloud request failed: Provider request failed with status 429",
          stack: "ProviderRateLimitError: veryfront-cloud request failed: " +
            "Provider request failed with status 429\n    at buildProviderError",
        },
      });

      assertEquals(
        reporter.captured,
        [],
        "a provider rate-limit error log must not reach Sentry",
      );
    } finally {
      setApplicationErrorReporter(undefined);
    }
  });

  it("reports message-only Agent error logs under their own log message", () => {
    const reporter = createReporter();
    const emitter = createNodeAgentServiceLogApplicationErrorEmitter();

    try {
      setApplicationErrorReporter(reporter);
      emitter({
        timestamp: "2026-07-29T00:00:00.000Z",
        level: "error",
        service: "agent",
        veryfrontVersion: "0.0.0",
        message: "runtime failed without an error object",
      });

      assertEquals(reporter.captured.length, 1, "a message-only error log must be captured");
      const captured = reporter.captured[0];
      assertExists(captured);
      assertEquals(
        captured.error instanceof Error ? captured.error.message : "",
        "runtime failed without an error object",
        "a message-only error log must be reported under its own log message",
      );
    } finally {
      setApplicationErrorReporter(undefined);
    }
  });

  it("initializes before OTel, coexists with OTel emitter, isolates capture failures, and cleans up", async () => {
    const reporter = createReporter({ captureThrows: true });
    const otelRecords: string[] = [];
    const lifecycle = await initializeNodeAgentServiceSentryApplicationErrors({
      env: {
        SENTRY_ENABLED: "true",
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
      const { __registerLogRecordEmitter } = await import("#veryfront/utils/logger/logger.ts");
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

  it("captures one startup error, leaves OTel log delivery intact, and flushes once", async () => {
    const reporter = createReporter({ flush: () => new Promise<boolean>(() => {}) });
    const otelRecords: string[] = [];
    const lifecycle = await initializeNodeAgentServiceSentryApplicationErrors({
      env: {
        SENTRY_ENABLED: "true",
        SENTRY_DSN: "https://public@example.ingest.sentry.io/1",
      },
      flushTimeoutMs: 5,
      loadExtension: () =>
        Promise.resolve({
          createNodeSentryApplicationErrorReporter: () => reporter,
        }),
    });

    try {
      const { __registerLogRecordEmitter } = await import("#veryfront/utils/logger/logger.ts");
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
      lifecycle.reset();
      __resetLogRecordEmitterForTests();
      setApplicationErrorReporter(undefined);
    }
  });

  it("repeated initialization replaces subscribers and old reset cannot clear the newer reporter", async () => {
    const firstReporter = createReporter();
    const secondReporter = createReporter();

    const firstLifecycle = await initializeNodeAgentServiceSentryApplicationErrors({
      env: { SENTRY_ENABLED: "true", SENTRY_DSN: "https://public@example.ingest.sentry.io/1" },
      loadExtension: () =>
        Promise.resolve({
          createNodeSentryApplicationErrorReporter: () => firstReporter,
        }),
    });
    const secondLifecycle = await initializeNodeAgentServiceSentryApplicationErrors({
      env: { SENTRY_ENABLED: "true", SENTRY_DSN: "https://public@example.ingest.sentry.io/2" },
      loadExtension: () =>
        Promise.resolve({
          createNodeSentryApplicationErrorReporter: () => secondReporter,
        }),
    });

    try {
      withMutedConsole(() => {
        agentLogger.error("after replace");
      });
      assertEquals(firstReporter.captured, []);
      assertEquals(secondReporter.captured.length, 1);

      firstLifecycle.reset();
      withMutedConsole(() => {
        agentLogger.error("after stale reset");
      });
      assertEquals(firstReporter.captured, []);
      assertEquals(secondReporter.captured.length, 2);

      secondLifecycle.reset();
      withMutedConsole(() => {
        agentLogger.error("after current reset");
      });
      assertEquals(secondReporter.captured.length, 2);
    } finally {
      firstLifecycle.reset();
      secondLifecycle.reset();
      __resetLogRecordEmitterForTests();
      setApplicationErrorReporter(undefined);
    }
  });

  it("keeps the current reporter active until a concurrent replacement is ready", async () => {
    const firstReporter = createReporter();
    const secondReporter = createReporter();
    const firstLifecycle = await initializeNodeAgentServiceSentryApplicationErrors({
      env: { SENTRY_ENABLED: "true", SENTRY_DSN: "https://public@example.ingest.sentry.io/1" },
      loadExtension: () =>
        Promise.resolve({
          createNodeSentryApplicationErrorReporter: () => firstReporter,
        }),
    });
    let resolveReplacement:
      | ((
        extension: { createNodeSentryApplicationErrorReporter: () => ApplicationErrorReporter },
      ) => void)
      | undefined;
    const replacement = initializeNodeAgentServiceSentryApplicationErrors({
      env: { SENTRY_ENABLED: "true", SENTRY_DSN: "https://public@example.ingest.sentry.io/2" },
      loadExtension: () =>
        new Promise((resolve) => {
          resolveReplacement = resolve;
        }),
    });

    try {
      withMutedConsole(() => {
        agentLogger.error("while replacement loads");
      });
      assertEquals(firstReporter.captured.length, 1);
      assertEquals(secondReporter.captured, []);

      resolveReplacement?.({
        createNodeSentryApplicationErrorReporter: () => secondReporter,
      });
      const secondLifecycle = await replacement;
      try {
        withMutedConsole(() => {
          agentLogger.error("after replacement");
        });
        assertEquals(firstReporter.captured.length, 1);
        assertEquals(secondReporter.captured.length, 1);

        firstLifecycle.reset();
        withMutedConsole(() => {
          agentLogger.error("after stale reset");
        });
        assertEquals(secondReporter.captured.length, 2);
      } finally {
        secondLifecycle.reset();
      }
    } finally {
      firstLifecycle.reset();
      __resetLogRecordEmitterForTests();
      setApplicationErrorReporter(undefined);
    }
  });

  it("preserves the current reporter when replacement loading or construction fails", async () => {
    const reporter = createReporter();
    const lifecycle = await initializeNodeAgentServiceSentryApplicationErrors({
      env: { SENTRY_ENABLED: "true", SENTRY_DSN: "https://public@example.ingest.sentry.io/1" },
      loadExtension: () =>
        Promise.resolve({
          createNodeSentryApplicationErrorReporter: () => reporter,
        }),
    });

    try {
      for (
        const loadExtension of [
          () => Promise.reject(new Error("replacement load failed")),
          () =>
            Promise.resolve({
              createNodeSentryApplicationErrorReporter: () => {
                throw new Error("replacement construction failed");
              },
            }),
        ]
      ) {
        try {
          await initializeNodeAgentServiceSentryApplicationErrors({
            env: {
              SENTRY_ENABLED: "true",
              SENTRY_DSN: "https://public@example.ingest.sentry.io/2",
            },
            loadExtension,
          });
          throw new Error("Expected replacement initialization to fail");
        } catch (error) {
          assertEquals(
            error instanceof Error && error.message.startsWith("replacement "),
            true,
          );
        }
        withMutedConsole(() => {
          agentLogger.error("after failed replacement");
        });
      }

      assertEquals(reporter.captured.length, 2);
      lifecycle.reset();
      withMutedConsole(() => {
        agentLogger.error("after cleanup");
      });
      assertEquals(reporter.captured.length, 2);
    } finally {
      lifecycle.reset();
      __resetLogRecordEmitterForTests();
      setApplicationErrorReporter(undefined);
    }
  });

  it("prevents stale concurrent initialization from winning reporter ownership", async () => {
    const firstReporter = createReporter();
    const secondReporter = createReporter();
    let resolveFirst:
      | ((
        extension: { createNodeSentryApplicationErrorReporter: () => ApplicationErrorReporter },
      ) => void)
      | undefined;
    const firstInit = initializeNodeAgentServiceSentryApplicationErrors({
      env: { SENTRY_ENABLED: "true", SENTRY_DSN: "https://public@example.ingest.sentry.io/1" },
      loadExtension: () =>
        new Promise((resolve) => {
          resolveFirst = resolve;
        }),
    });
    const secondLifecycle = await initializeNodeAgentServiceSentryApplicationErrors({
      env: { SENTRY_ENABLED: "true", SENTRY_DSN: "https://public@example.ingest.sentry.io/2" },
      loadExtension: () =>
        Promise.resolve({
          createNodeSentryApplicationErrorReporter: () => secondReporter,
        }),
    });
    resolveFirst?.({
      createNodeSentryApplicationErrorReporter: () => firstReporter,
    });
    const firstLifecycle = await firstInit;

    try {
      assertEquals(firstLifecycle.enabled, false);
      withMutedConsole(() => {
        agentLogger.error("after concurrent init");
      });
      assertEquals(firstReporter.captured, []);
      assertEquals(secondReporter.captured.length, 1);
    } finally {
      firstLifecycle.reset();
      secondLifecycle.reset();
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
