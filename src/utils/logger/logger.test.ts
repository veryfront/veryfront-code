import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerTraceContextGetter,
  __resetLoggerConfigForTests,
  __resetTraceContextGetterForTests,
  getBaseLogger,
  getDefaultLevel,
  type LogEntry,
  LogLevel,
  refreshLoggerConfig,
  serverLogger,
} from "./logger.ts";
import { type RequestContext, runWithRequestContextAsync } from "./request-context.ts";
import { runWithProjectEnv } from "../../server/project-env/storage.ts";
import { VERSION } from "../version.ts";

function captureConsoleLog(): { getOutput: () => string; reset: () => void; restore: () => void } {
  const originalLog = console.log;
  let capturedOutput = "";

  console.log = (msg: string) => {
    capturedOutput = msg;
  };

  return {
    getOutput: () => capturedOutput,
    reset: () => {
      capturedOutput = "";
    },
    restore: () => {
      console.log = originalLog;
    },
  };
}

function withJsonLogFormat<T>(fn: () => T): T {
  Deno.env.set("LOG_FORMAT", "json");
  __resetLoggerConfigForTests();

  try {
    return fn();
  } finally {
    Deno.env.delete("LOG_FORMAT");
    __resetLoggerConfigForTests();
  }
}

describe("logger", () => {
  describe("getDefaultLevel", () => {
    // Note: Pass explicit values to avoid reading process env in parallel tests.

    it("should return DEBUG for LOG_LEVEL=DEBUG", () => {
      assertEquals(getDefaultLevel("DEBUG", ""), LogLevel.DEBUG);
    });

    it("should return INFO for LOG_LEVEL=INFO", () => {
      assertEquals(getDefaultLevel("INFO", ""), LogLevel.INFO);
    });

    it("should return WARN for LOG_LEVEL=WARN", () => {
      assertEquals(getDefaultLevel("WARN", ""), LogLevel.WARN);
    });

    it("should return ERROR for LOG_LEVEL=ERROR", () => {
      assertEquals(getDefaultLevel("ERROR", ""), LogLevel.ERROR);
    });

    it("should be case-insensitive for LOG_LEVEL", () => {
      assertEquals(getDefaultLevel("debug", ""), LogLevel.DEBUG);
      assertEquals(getDefaultLevel("Info", ""), LogLevel.INFO);
    });

    it("should return DEBUG when VERYFRONT_DEBUG=1", () => {
      // Pass empty string for LOG_LEVEL to avoid triggering default parameter
      // (empty string is treated as invalid/no value by parseLogLevel)
      assertEquals(getDefaultLevel("", "1"), LogLevel.DEBUG);
    });

    it("should return DEBUG when VERYFRONT_DEBUG=true", () => {
      // Pass empty string for LOG_LEVEL to avoid triggering default parameter
      assertEquals(getDefaultLevel("", "true"), LogLevel.DEBUG);
    });

    it("should return INFO by default", () => {
      // Pass empty strings to test default behavior without env var interference
      assertEquals(getDefaultLevel("", ""), LogLevel.INFO);
    });

    it("should prefer LOG_LEVEL over VERYFRONT_DEBUG", () => {
      assertEquals(getDefaultLevel("ERROR", "1"), LogLevel.ERROR);
    });

    it("should return INFO for invalid LOG_LEVEL without debug flag", () => {
      assertEquals(getDefaultLevel("INVALID", ""), LogLevel.INFO);
    });
  });

  describe("refreshLoggerConfig", () => {
    it("should switch to JSON after NODE_ENV changes post-startup", () => {
      const previousNodeEnv = Deno.env.get("NODE_ENV");
      const previousLogFormat = Deno.env.get("LOG_FORMAT");
      const { getOutput, reset, restore } = captureConsoleLog();

      try {
        Deno.env.delete("NODE_ENV");
        Deno.env.delete("LOG_FORMAT");
        __resetLoggerConfigForTests();

        serverLogger.info("Text before refresh");
        assertEquals(getOutput().startsWith("{"), false);

        Deno.env.set("NODE_ENV", "production");
        refreshLoggerConfig();
        reset();

        serverLogger.info("JSON after refresh");

        const entry = JSON.parse(getOutput()) as LogEntry;
        assertEquals(entry.level, "info");
        assertEquals(entry.message, "JSON after refresh");
      } finally {
        restore();
        if (previousNodeEnv === undefined) Deno.env.delete("NODE_ENV");
        else Deno.env.set("NODE_ENV", previousNodeEnv);
        if (previousLogFormat === undefined) Deno.env.delete("LOG_FORMAT");
        else Deno.env.set("LOG_FORMAT", previousLogFormat);
        __resetLoggerConfigForTests();
      }
    });

    it("should pick up LOG_LEVEL changes after refresh", () => {
      const previousLogLevel = Deno.env.get("LOG_LEVEL");
      const { getOutput, reset, restore } = captureConsoleLog();

      try {
        Deno.env.delete("LOG_LEVEL");
        __resetLoggerConfigForTests();

        serverLogger.info("Visible before refresh");
        assertEquals(getOutput().includes("Visible before refresh"), true);

        Deno.env.set("LOG_LEVEL", "ERROR");
        refreshLoggerConfig();
        reset();

        serverLogger.info("Hidden after refresh");
        assertEquals(getOutput(), "");
      } finally {
        restore();
        if (previousLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", previousLogLevel);
        __resetLoggerConfigForTests();
      }
    });
  });

  describe("LogLevel enum", () => {
    it("should have correct ordering", () => {
      assertEquals(LogLevel.DEBUG < LogLevel.INFO, true);
      assertEquals(LogLevel.INFO < LogLevel.WARN, true);
      assertEquals(LogLevel.WARN < LogLevel.ERROR, true);
    });
  });

  describe("request context propagation", () => {
    it("should include request context in logs when running within context", async () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        await withJsonLogFormat(async () => {
          const baseLogger = getBaseLogger("SERVER");
          const reqLogger = baseLogger.child({
            requestId: "test-req-123",
            project_slug: "test-project",
          });

          const context: RequestContext = {
            logger: reqLogger,
            requestId: "test-req-123",
            projectSlug: "test-project",
          };

          await runWithRequestContextAsync(context, () => {
            // Using the global serverLogger should now pick up request context
            serverLogger.info("Test message from within context");
            return Promise.resolve();
          });

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.requestId, "test-req-123");
          assertEquals(entry.request_id, "test-req-123");
          assertEquals(entry.project_slug, "test-project");
          assertEquals(entry.veryfrontVersion, VERSION);
        });
      } finally {
        restore();
      }
    });

    it("should use base logger when not in request context", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          // Outside of request context
          serverLogger.info("Test message outside context");

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.requestId, undefined);
          assertEquals(entry.project_slug, undefined);
          assertEquals(entry.veryfrontVersion, VERSION);
        });
      } finally {
        restore();
      }
    });
  });

  describe("JSON output format", () => {
    it("should include version field in LogEntry", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          serverLogger.info("Test message");

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.veryfrontVersion, VERSION);
          assertEquals(typeof entry.veryfrontVersion, "string");
          assertEquals(entry.veryfrontVersion.length > 0, true);
        });
      } finally {
        restore();
      }
    });

    it("should include all required fields in JSON output", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          serverLogger.info("Test message", { extra: "data" });

          const entry = JSON.parse(getOutput()) as LogEntry;

          assertEquals(typeof entry.timestamp, "string");
          assertEquals(entry.level, "info");
          assertEquals(typeof entry.service, "string");
          assertEquals(entry.veryfrontVersion, VERSION);
          assertEquals(entry.message, "Test message");
          assertEquals(entry.context?.extra, "data");
        });
      } finally {
        restore();
      }
    });

    it("should serialize Error values provided inside context.error", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          serverLogger.info("Nested error", {
            path: "/tmp/file.ts",
            error: new Error("boom"),
          });

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.message, "Nested error");
          assertEquals(entry.context?.path, "/tmp/file.ts");
          assertEquals(entry.context?.error, undefined);
          assertEquals(entry.error?.name, "Error");
          assertEquals(entry.error?.message, "boom");
        });
      } finally {
        restore();
      }
    });
  });

  describe("text output format", () => {
    it("should render Error values provided inside context.error as err=", () => {
      Deno.env.set("LOG_FORMAT", "text");
      Deno.env.set("NO_COLOR", "1");
      __resetLoggerConfigForTests();

      const { getOutput, restore } = captureConsoleLog();

      try {
        serverLogger.info("Nested text error", {
          path: "/tmp/file.ts",
          error: new Error("boom"),
        });

        const output = getOutput();
        assertEquals(output.includes("Nested text error"), true);
        assertEquals(output.includes("path=/tmp/file.ts"), true);
        assertEquals(output.includes("err=Error: boom"), true);
        assertEquals(output.includes("error={}"), false);
      } finally {
        restore();
        Deno.env.delete("LOG_FORMAT");
        Deno.env.delete("NO_COLOR");
        __resetLoggerConfigForTests();
      }
    });
  });

  describe("component() logger", () => {
    it("should include component field in JSON output", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          const base = getBaseLogger("SERVER");
          const comp = base.component("cors");
          comp.info("CORS check");

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.component, "cors");
          assertEquals(entry.message, "CORS check");
        });
      } finally {
        restore();
      }
    });

    it("should not include component field when not set", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          const base = getBaseLogger("SERVER");
          base.info("No component");

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.component, undefined);
        });
      } finally {
        restore();
      }
    });

    it("should preserve bound context in component logger", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          const base = getBaseLogger("SERVER");
          const child = base.child({ requestId: "req-1" });
          const comp = child.component("discovery");
          comp.info("Discovering");

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.component, "discovery");
          assertEquals(entry.requestId, "req-1");
        });
      } finally {
        restore();
      }
    });

    it("should render [component] tag in text output", () => {
      Deno.env.set("LOG_FORMAT", "text");
      Deno.env.set("NO_COLOR", "1");
      __resetLoggerConfigForTests();

      const { getOutput, restore } = captureConsoleLog();

      try {
        const base = getBaseLogger("SERVER");
        const comp = base.component("cors");
        comp.info("Text mode");

        const output = getOutput();
        assertEquals(output.includes("[cors]"), true);
        assertEquals(output.includes("Text mode"), true);
      } finally {
        restore();
        Deno.env.delete("LOG_FORMAT");
        Deno.env.delete("NO_COLOR");
        __resetLoggerConfigForTests();
      }
    });

    it("should support component via context-aware logger proxy", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          const comp = serverLogger.component("middleware");
          comp.info("From proxy");

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.component, "middleware");
        });
      } finally {
        restore();
      }
    });

    it("should inherit request context when component logger is created at top level", async () => {
      // Simulates the real pattern: component logger created at module scope,
      // then used inside runWithRequestContextAsync during a request.
      const topLevelLog = serverLogger.component("ssr");

      const { getOutput, restore } = captureConsoleLog();

      try {
        await withJsonLogFormat(async () => {
          const reqLogger = getBaseLogger("SERVER").child({
            requestId: "req-42",
            project_slug: "my-proj",
          });
          const ctx: RequestContext = {
            logger: reqLogger,
            requestId: "req-42",
          };

          await runWithRequestContextAsync(ctx, async () => {
            topLevelLog.info("Rendering page");
          });

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.component, "ssr");
          assertEquals(entry.requestId, "req-42");
          assertEquals(entry.project_slug, "my-proj");
        });
      } finally {
        restore();
      }
    });
  });

  describe("trace context bridge", () => {
    it("should auto-inject traceId and spanId from getter", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        __registerTraceContextGetter(() => ({
          traceId: "abc123",
          spanId: "span456",
        }));

        withJsonLogFormat(() => {
          const base = getBaseLogger("SERVER");
          base.info("Traced log");

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.traceId, "abc123");
          assertEquals(entry.spanId, "span456");
          assertEquals(entry.trace_id, "abc123");
          assertEquals(entry.span_id, "span456");
        });
      } finally {
        __resetTraceContextGetterForTests();
        restore();
      }
    });

    it("should not inject when traceId is already in context", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        __registerTraceContextGetter(() => ({
          traceId: "from-otel",
          spanId: "from-otel-span",
        }));

        withJsonLogFormat(() => {
          const base = getBaseLogger("SERVER");
          base.info("Explicit trace", { traceId: "explicit-id" });

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.traceId, "explicit-id");
        });
      } finally {
        __resetTraceContextGetterForTests();
        restore();
      }
    });

    it("should not inject when getter returns no traceId", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        __registerTraceContextGetter(() => ({}));

        withJsonLogFormat(() => {
          const base = getBaseLogger("SERVER");
          base.info("No active span");

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.traceId, undefined);
          assertEquals(entry.spanId, undefined);
        });
      } finally {
        __resetTraceContextGetterForTests();
        restore();
      }
    });

    it("should not inject when getter is not registered", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        __resetTraceContextGetterForTests();

        withJsonLogFormat(() => {
          const base = getBaseLogger("SERVER");
          base.info("No bridge");

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.traceId, undefined);
          assertEquals(entry.spanId, undefined);
        });
      } finally {
        restore();
      }
    });

    it("should allow base loggers to opt out of auto trace injection", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        __registerTraceContextGetter(() => ({
          traceId: "from-otel",
          spanId: "from-otel-span",
        }));

        withJsonLogFormat(() => {
          const base = getBaseLogger("SERVER", { injectTraceContext: false });
          const component = base.component("web-socket-manager");
          component.info("No trace bridge");

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.component, "web-socket-manager");
          assertEquals(entry.traceId, undefined);
          assertEquals(entry.spanId, undefined);
          assertEquals(entry.trace_id, undefined);
          assertEquals(entry.span_id, undefined);
        });
      } finally {
        __resetTraceContextGetterForTests();
        restore();
      }
    });
  });

  describe("snake_case field aliases", () => {
    it("should emit request_id alias for requestId", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          const base = getBaseLogger("SERVER");
          base.info("With request", { requestId: "req-abc" });

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.requestId, "req-abc");
          assertEquals(entry.request_id, "req-abc");
        });
      } finally {
        restore();
      }
    });

    it("should emit project_slug alias for projectSlug", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          const base = getBaseLogger("SERVER");
          base.info("With slug", { projectSlug: "my-project" });

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.projectSlug, "my-project");
          assertEquals(entry.project_slug, "my-project");
        });
      } finally {
        restore();
      }
    });

    it("should emit duration_ms alias for durationMs", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          const base = getBaseLogger("SERVER");
          base.info("Timed op", { durationMs: 42 });

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.durationMs, 42);
          assertEquals(entry.duration_ms, 42);
        });
      } finally {
        restore();
      }
    });

    it("should not overwrite explicit snake_case with alias", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          const base = getBaseLogger("SERVER");
          base.info("Both forms", { requestId: "camel", request_id: "snake" });

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.requestId, "camel");
          assertEquals(entry.request_id, "snake");
        });
      } finally {
        restore();
      }
    });
  });

  describe("project env overlay isolation", () => {
    it("should output JSON even when project env overlay is active", () => {
      // This reproduces the production bug: during SSR, the project env overlay
      // blocks getEnv() from reading host-level LOG_FORMAT/NODE_ENV, which caused
      // the logger to fall back to "text" format instead of "json".
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          // Simulate an SSR request with a project env overlay active
          runWithProjectEnv({ SOME_PROJECT_VAR: "value" }, () => {
            const base = getBaseLogger("SERVER");
            base.info("SSR render log", { project_id: "test-project-123" });

            // Must be valid JSON, not logfmt text
            const entry = JSON.parse(getOutput()) as LogEntry;
            assertEquals(entry.level, "info");
            assertEquals(entry.message, "SSR render log");
            assertEquals(entry.project_id, "test-project-123");
          });
        });
      } finally {
        restore();
      }
    });

    it("should not change log format when project env sets LOG_FORMAT", () => {
      // Even if a project's env overlay contains LOG_FORMAT, the logger should
      // use the host-level config captured at startup, not the project's value.
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          runWithProjectEnv({ LOG_FORMAT: "text" }, () => {
            const base = getBaseLogger("SERVER");
            base.info("Should still be JSON");

            const entry = JSON.parse(getOutput()) as LogEntry;
            assertEquals(entry.level, "info");
            assertEquals(entry.message, "Should still be JSON");
          });
        });
      } finally {
        restore();
      }
    });
  });
});
