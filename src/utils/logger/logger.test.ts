import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __registerTraceContextGetter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  __resetTraceContextGetterForTests,
  createRunUserLogger,
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
import { LOG_PREVIEW_MAX_LENGTH_CHARS, MAX_STRING_DISPLAY_LENGTH } from "../constants/limits.ts";

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

    it("should not format or redact arguments for suppressed log levels", () => {
      const previousLogLevel = Deno.env.get("LOG_LEVEL");
      const previousLogFormat = Deno.env.get("LOG_FORMAT");
      let getterReads = 0;

      try {
        Deno.env.set("LOG_LEVEL", "ERROR");
        Deno.env.set("LOG_FORMAT", "json");
        __resetLoggerConfigForTests();

        const context = {
          get password() {
            getterReads += 1;
            throw new Error("suppressed log context was formatted");
          },
        };

        serverLogger.debug("Suppressed debug log", context);

        assertEquals(getterReads, 0);
      } finally {
        if (previousLogLevel === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", previousLogLevel);
        if (previousLogFormat === undefined) Deno.env.delete("LOG_FORMAT");
        else Deno.env.set("LOG_FORMAT", previousLogFormat);
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

    it("redacts credential-like context keys before serialization (#1989)", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          serverLogger.info("Authenticating", {
            userId: "u-1",
            password: "hunter2",
            authorization: "Bearer abc",
            headers: { cookie: "session=xyz", accept: "json" },
          });

          const line = getOutput();
          const entry = JSON.parse(line) as LogEntry;
          const context = entry.context as Record<string, unknown>;
          assertEquals(context.password, "[REDACTED]");
          assertEquals(context.authorization, "[REDACTED]");
          assertEquals((context.headers as Record<string, unknown>).cookie, "[REDACTED]");
          // Non-sensitive fields survive.
          assertEquals((context.headers as Record<string, unknown>).accept, "json");
          // userId is a deliberate extracted field, not a secret.
          assertEquals(entry.userId, "u-1");
          // The raw secret must not appear anywhere in the serialized line.
          assertEquals(line.includes("hunter2"), false);
          assertEquals(line.includes("session=xyz"), false);
        });
      } finally {
        restore();
      }
    });

    it("fails closed when a context getter throws", () => {
      const { getOutput, restore } = captureConsoleLog();
      const context: Record<string, unknown> = { password: "must-not-leak" };
      Object.defineProperty(context, "error", {
        enumerable: true,
        get() {
          throw new Error("getter failure");
        },
      });

      try {
        withJsonLogFormat(() => {
          serverLogger.info("Unsafe context", context);

          const line = getOutput();
          const entry = JSON.parse(line) as LogEntry;
          assertEquals(line.includes("must-not-leak"), false);
          assertEquals(entry.context?.unreadable_context, "[REDACTED]");
        });
      } finally {
        restore();
      }
    });

    it("scrubs credentials embedded in the log message", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          serverLogger.info(
            "Fetching https://user:password@example.com/cb?access_token=secret",
          );

          const line = getOutput();
          const entry = JSON.parse(line) as LogEntry;
          assertEquals(line.includes("password"), false);
          assertEquals(line.includes("secret"), false);
          assertEquals(entry.message.includes("[REDACTED]"), true);
        });
      } finally {
        restore();
      }
    });

    it("scrubs every cookie value from JSON messages and errors", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          serverLogger.info(
            "upstream headers Cookie: session=json-first; admin=json-second",
            {
              error: new Error(
                "response Set-Cookie: access=json-third; refresh=json-fourth; Path=/",
              ),
            },
          );
        });

        const output = getOutput();
        const entry = JSON.parse(output) as LogEntry;
        for (
          const secret of [
            "json-first",
            "json-second",
            "json-third",
            "json-fourth",
          ]
        ) {
          assertEquals(output.includes(secret), false);
        }
        assertEquals(entry.message.includes("[REDACTED]"), true);
        assertEquals(entry.error?.message?.includes("[REDACTED]"), true);
      } finally {
        restore();
      }
    });

    it("bounds messages, errors, lifted fields, context keys, and context values after redaction", () => {
      const { getOutput, restore } = captureConsoleLog();
      const messageSecret = "json-message-secret";
      const contextSecret = "json-context-secret";
      const fieldSecret = "json-field-secret";
      const errorSecret = "json-error-secret";
      const longKey = `long-field-${"k".repeat(LOG_PREVIEW_MAX_LENGTH_CHARS * 4)}`;

      try {
        withJsonLogFormat(() => {
          serverLogger.info(
            `${"m".repeat(900)} token=${messageSecret} ${"m".repeat(900)}`,
            {
              note: `${"c".repeat(400)} token=${contextSecret} ${"c".repeat(900)}`,
              project_id: `${"p".repeat(400)} token=${fieldSecret} ${"p".repeat(900)}`,
              [longKey]: "bounded-key",
              error: new Error(
                `${"e".repeat(900)} token=${errorSecret} ${"e".repeat(900)}`,
              ),
            },
          );
        });

        const output = getOutput();
        const entry = JSON.parse(output) as LogEntry;
        assertEquals(entry.message.length <= MAX_STRING_DISPLAY_LENGTH, true);
        assertEquals(
          (entry.context?.note as string).length <= LOG_PREVIEW_MAX_LENGTH_CHARS,
          true,
        );
        assertEquals(
          (entry.project_id?.length ?? 0) <= LOG_PREVIEW_MAX_LENGTH_CHARS,
          true,
        );
        assertEquals(
          Object.keys(entry.context ?? {}).every((key) =>
            key.length <= LOG_PREVIEW_MAX_LENGTH_CHARS
          ),
          true,
        );
        assertEquals(
          (entry.error?.message.length ?? 0) <= MAX_STRING_DISPLAY_LENGTH,
          true,
        );
        assertEquals(
          (entry.error?.stack?.length ?? 0) <= MAX_STRING_DISPLAY_LENGTH,
          true,
        );
        for (const secret of [messageSecret, contextSecret, fieldSecret, errorSecret]) {
          assertEquals(output.includes(secret), false);
        }
        assertEquals(output.includes("[REDACTED]"), true);
      } finally {
        restore();
      }
    });

    it("scrubs URL credentials from every structured string representation", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          serverLogger.info("Structured values", {
            nested: {
              raw: "https://user:raw-pass@example.test/?token=raw-token",
              url: new URL(
                "https://client:url-pass@example.test/callback#access_token=url-token",
              ),
              serialized: {
                toJSON: () => "https://example.test/#secret=serialized-token",
              },
            },
          });

          const line = getOutput();
          for (
            const secret of ["raw-pass", "raw-token", "url-pass", "url-token", "serialized-token"]
          ) {
            assertEquals(line.includes(secret), false);
          }
          assertEquals(line.includes("[REDACTED]"), true);
        });
      } finally {
        restore();
      }
    });

    it("serializes BigInt and hostile toJSON getters without throwing", () => {
      const { getOutput, restore } = captureConsoleLog();
      const hostile: Record<string, unknown> = {};
      Object.defineProperty(hostile, "toJSON", {
        get() {
          throw new Error("hostile serializer getter");
        },
      });

      try {
        withJsonLogFormat(() => {
          serverLogger.info("Unusual values", { count: 42n, hostile });
        });

        const entry = JSON.parse(getOutput()) as LogEntry;
        assertEquals(entry.context?.count, "42");
        assertEquals(entry.context?.hostile, "[REDACTED]");
      } finally {
        restore();
      }
    });

    it("fails closed when a structured array has a hostile element getter", () => {
      const { getOutput, restore } = captureConsoleLog();
      const hostile: unknown[] = [];
      Object.defineProperty(hostile, 0, {
        enumerable: true,
        get() {
          throw new Error("hostile array element getter");
        },
      });

      try {
        withJsonLogFormat(() => {
          serverLogger.info("Hostile array", { values: hostile });
        });

        const output = getOutput();
        const entry = JSON.parse(output) as LogEntry;
        assertEquals(entry.context?.values, "[REDACTED]");
        assertEquals(output.includes("hostile array element getter"), false);
      } finally {
        restore();
      }
    });

    it("fails closed when root or nested log context proxies are revoked", () => {
      const { getOutput, reset, restore } = captureConsoleLog();
      const root = Proxy.revocable({ token: "root-secret" }, {});
      const nested = Proxy.revocable(["nested-secret"], {});
      root.revoke();
      nested.revoke();

      try {
        withJsonLogFormat(() => {
          serverLogger.info("Revoked root", root.proxy);
        });
        const rootOutput = getOutput();
        const rootEntry = JSON.parse(rootOutput) as LogEntry;
        assertEquals(rootEntry.context?.unreadable_context, "[REDACTED]");
        assertEquals(rootOutput.includes("root-secret"), false);

        reset();
        withJsonLogFormat(() => {
          serverLogger.info("Revoked nested", { values: nested.proxy });
        });
        const nestedOutput = getOutput();
        const nestedEntry = JSON.parse(nestedOutput) as LogEntry;
        assertEquals(nestedEntry.context?.values, "[REDACTED]");
        assertEquals(nestedOutput.includes("nested-secret"), false);
      } finally {
        restore();
      }
    });

    it("should surface run user log routing fields as top-level JSON fields", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          const runLogger = createRunUserLogger(serverLogger, {
            projectId: "project-123",
            runExecutionId: "run-exec-456",
            batchId: "batch-789",
            runTarget: "task:knowledge-ingest",
            task: "knowledge-ingest",
          });

          runLogger.info("Knowledge source ingested", {
            phase: "file_completed",
            progress_current: 3,
            progress_total: 10,
          });

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.project_id, "project-123");
          assertEquals(entry.run_execution_id, "run-exec-456");
          assertEquals(entry.batch_id, "batch-789");
          assertEquals(entry.run_target, "task:knowledge-ingest");
          assertEquals(entry.task, "knowledge-ingest");
          assertEquals(entry.event_kind, "run_user_log");
          assertEquals(entry.user_visible, "true");
          assertEquals(entry.context?.phase, "file_completed");
          assertEquals(entry.context?.progress_current, 3);
          assertEquals(entry.context?.progress_total, 10);
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

    it("scrubs credentials embedded in error message/stack (#1989)", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          const err = new Error("db connect failed: postgres://admin:s3cret@db.host/app");
          serverLogger.info("DB error", err);

          const line = getOutput();
          const entry = JSON.parse(line) as LogEntry;
          assertEquals(line.includes("s3cret"), false);
          assertEquals(entry.error?.message?.includes("[REDACTED]"), true);
        });
      } finally {
        restore();
      }
    });

    it("scrubs credentials from lifted request_url (#1989)", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          serverLogger.info("Incoming request", {
            request_url: "https://api.example.com/cb?code=abc123&access_token=xyz&page=2",
          });

          const line = getOutput();
          const entry = JSON.parse(line) as LogEntry;
          assertEquals(line.includes("abc123"), false);
          assertEquals(line.includes("xyz"), false);
          assertEquals(entry.request_url?.includes("page=2"), true);
          assertEquals(entry.request_url?.includes("[REDACTED]"), true);
        });
      } finally {
        restore();
      }
    });
  });

  describe("text output format", () => {
    it("scrubs credentials embedded in the rendered message", () => {
      Deno.env.set("LOG_FORMAT", "text");
      Deno.env.set("NO_COLOR", "1");
      __resetLoggerConfigForTests();
      const { getOutput, restore } = captureConsoleLog();

      try {
        serverLogger.info("Fetching https://user:password@example.com?token=secret");
        const output = getOutput();
        assertEquals(output.includes("password"), false);
        assertEquals(output.includes("secret"), false);
        assertEquals(output.includes("[REDACTED]"), true);
      } finally {
        restore();
        Deno.env.delete("LOG_FORMAT");
        Deno.env.delete("NO_COLOR");
        __resetLoggerConfigForTests();
      }
    });

    it("scrubs URL credentials from nested text context values", () => {
      Deno.env.set("LOG_FORMAT", "text");
      Deno.env.set("NO_COLOR", "1");
      __resetLoggerConfigForTests();
      const { getOutput, restore } = captureConsoleLog();

      try {
        serverLogger.info("Structured text", {
          nested: {
            raw: "https://user:text-pass@example.test/#token=text-token",
            url: new URL("https://client:url-pass@example.test/callback?secret=url-token"),
          },
        });
        const output = getOutput();
        for (const secret of ["text-pass", "text-token", "url-pass", "url-token"]) {
          assertEquals(output.includes(secret), false);
        }
        assertEquals(output.includes("[REDACTED]"), true);
      } finally {
        restore();
        Deno.env.delete("LOG_FORMAT");
        Deno.env.delete("NO_COLOR");
        __resetLoggerConfigForTests();
      }
    });

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

    it("scrubs credentials from rendered error message (#1989)", () => {
      Deno.env.set("LOG_FORMAT", "text");
      Deno.env.set("NO_COLOR", "1");
      __resetLoggerConfigForTests();

      const { getOutput, restore } = captureConsoleLog();

      try {
        serverLogger.info("DB error", {
          error: new Error("connect failed: mongodb://root:p4ss@cluster/db"),
        });

        const output = getOutput();
        assertEquals(output.includes("p4ss"), false);
        assertEquals(output.includes("[REDACTED]"), true);
      } finally {
        restore();
        Deno.env.delete("LOG_FORMAT");
        Deno.env.delete("NO_COLOR");
        __resetLoggerConfigForTests();
      }
    });

    it("neutralizes forged lines and terminal controls in untrusted text", () => {
      Deno.env.set("LOG_FORMAT", "text");
      Deno.env.set("NO_COLOR", "1");
      __resetLoggerConfigForTests();

      const { getOutput, restore } = captureConsoleLog();

      try {
        const component = serverLogger.component(
          "component\nFORGED\u001b[31mred\u001b[0m",
        );
        component.info("entry\r\nFORGED\u001b]0;owned\u0007", {
          "key\nFORGED": "value\u009b31mred\u009b0m",
          error: new Error("boom\nFORGED\u001b[2J"),
        });

        const output = getOutput();
        assertEquals(output.split("\n").length, 2);
        assertEquals(output.includes("\r"), false);
        assertEquals(output.includes("\u001b"), false);
        assertEquals(output.includes("\u0007"), false);
        assertEquals(output.includes("\u009b"), false);
      } finally {
        restore();
        Deno.env.delete("LOG_FORMAT");
        Deno.env.delete("NO_COLOR");
        __resetLoggerConfigForTests();
      }
    });

    it("scrubs raw authorization and secret assignments from free-form text", () => {
      Deno.env.set("LOG_FORMAT", "text");
      Deno.env.set("NO_COLOR", "1");
      __resetLoggerConfigForTests();

      const { getOutput, restore } = captureConsoleLog();

      try {
        serverLogger.info(
          "Authorization: Bearer bearer-secret Basic basic-secret " +
            "password=hunter2 api_key: key-secret",
          {
            note: "Authorization=Basic context-secret",
            error: new Error("refresh_token: refresh-secret"),
          },
        );

        const output = getOutput();
        for (
          const secret of [
            "bearer-secret",
            "basic-secret",
            "hunter2",
            "key-secret",
            "context-secret",
            "refresh-secret",
          ]
        ) {
          assertEquals(output.includes(secret), false);
        }
        assertEquals(output.includes("[REDACTED]"), true);
      } finally {
        restore();
        Deno.env.delete("LOG_FORMAT");
        Deno.env.delete("NO_COLOR");
        __resetLoggerConfigForTests();
      }
    });

    it("scrubs every cookie value from text messages, context, and errors", () => {
      Deno.env.set("LOG_FORMAT", "text");
      Deno.env.set("NO_COLOR", "1");
      __resetLoggerConfigForTests();
      const { getOutput, restore } = captureConsoleLog();

      try {
        serverLogger.info(
          "request Cookie: session=text-first; admin=text-second",
          {
            note: "headers Set-Cookie: access=text-third; refresh=text-fourth; Path=/",
            error: new Error(
              "upstream Cookie: token=text-fifth; session=text-sixth",
            ),
          },
        );

        const output = getOutput();
        for (
          const secret of [
            "text-first",
            "text-second",
            "text-third",
            "text-fourth",
            "text-fifth",
            "text-sixth",
          ]
        ) {
          assertEquals(output.includes(secret), false);
        }
        assertEquals(output.includes("[REDACTED]"), true);
      } finally {
        restore();
        Deno.env.delete("LOG_FORMAT");
        Deno.env.delete("NO_COLOR");
        __resetLoggerConfigForTests();
      }
    });

    it("bounds sanitized text messages and context values", () => {
      Deno.env.set("LOG_FORMAT", "text");
      Deno.env.set("NO_COLOR", "1");
      __resetLoggerConfigForTests();
      const { getOutput, restore } = captureConsoleLog();
      const messageSecret = "text-message-secret";
      const contextSecret = "text-context-secret";

      try {
        serverLogger.info(
          `${"m".repeat(900)} token=${messageSecret} ${"m".repeat(900)}`,
          {
            note: `${"c".repeat(400)} token=${contextSecret} ${"c".repeat(1_500)}`,
          },
        );

        const output = getOutput();
        assertEquals(output.length < 2_000, true);
        assertEquals(output.includes(messageSecret), false);
        assertEquals(output.includes(contextSecret), false);
        assertEquals(output.includes("[REDACTED]"), true);
      } finally {
        restore();
        Deno.env.delete("LOG_FORMAT");
        Deno.env.delete("NO_COLOR");
        __resetLoggerConfigForTests();
      }
    });

    it("uses one redacted snapshot for the text sink and structured emitter", () => {
      Deno.env.set("LOG_FORMAT", "text");
      Deno.env.set("NO_COLOR", "1");
      __resetLoggerConfigForTests();
      const { getOutput, restore } = captureConsoleLog();
      let serializationCount = 0;
      let emittedEntry: LogEntry | undefined;

      __registerLogRecordEmitter((entry) => {
        emittedEntry = entry;
      });

      try {
        serverLogger.info("Stateful context", {
          state: {
            toJSON() {
              serializationCount++;
              return { version: serializationCount };
            },
          },
        });

        assertEquals(serializationCount, 1);
        assertEquals(getOutput().includes('"version":1'), true);
        assertEquals(
          (emittedEntry?.context?.state as { version?: number } | undefined)?.version,
          1,
        );
      } finally {
        __resetLogRecordEmitterForTests();
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

    it("should emit user_id alias for userId", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          const base = getBaseLogger("SERVER");
          base.info("With user", { userId: "usr-123" });

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.userId, "usr-123");
          assertEquals(entry.user_id, "usr-123");
        });
      } finally {
        restore();
      }
    });

    it("should emit conversation_id alias for conversationId", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          const base = getBaseLogger("SERVER");
          base.info("With conversation", { conversationId: "conv-456" });

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.conversationId, "conv-456");
          assertEquals(entry.conversation_id, "conv-456");
        });
      } finally {
        restore();
      }
    });

    it("should promote snake_case user_id and conversation_id directly", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          const base = getBaseLogger("SERVER");
          base.info("Snake case", { user_id: "usr-789", conversation_id: "conv-012" });

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.user_id, "usr-789");
          assertEquals(entry.conversation_id, "conv-012");
        });
      } finally {
        restore();
      }
    });

    it("should promote runtime run and tool identifiers", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          const base = getBaseLogger("SERVER");
          base.info("Runtime event", {
            runId: "run_123",
            agentId: "triage-sweeper",
            threadId: "thread_123",
            scheduleId: "sched_123",
            scheduleName: "Triage sweep",
            toolName: "query_loki",
            toolCallId: "call_123",
          });

          const entry = JSON.parse(getOutput()) as LogEntry;
          assertEquals(entry.run_id, "run_123");
          assertEquals(entry.agent_id, "triage-sweeper");
          assertEquals(entry.thread_id, "thread_123");
          assertEquals(entry.schedule_id, "sched_123");
          assertEquals(entry.schedule_name, "Triage sweep");
          assertEquals(entry.tool_name, "query_loki");
          assertEquals(entry.tool_call_id, "call_123");
          assertEquals(entry.context, undefined);
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
    it("should read host config when the first log occurs inside a project env overlay", async () => {
      const projectEnvUrl = new URL("../../server/project-env/storage.ts", import.meta.url).href;
      const loggerUrl = new URL("./logger.ts", import.meta.url).href;
      const source = `
        import { runWithProjectEnv } from ${JSON.stringify(projectEnvUrl)};
        import { serverLogger } from ${JSON.stringify(loggerUrl)};

        runWithProjectEnv({}, () => serverLogger.info("Cold overlay log"));
        serverLogger.info("After overlay log");
      `;
      const command = new Deno.Command(Deno.execPath(), {
        args: ["eval", "--frozen", "--config=deno.json", source],
        env: {
          LOG_FORMAT: "json",
          LOG_LEVEL: "INFO",
          NODE_ENV: "production",
        },
        stdout: "piped",
        stderr: "piped",
      });

      const result = await command.output();
      const stderr = new TextDecoder().decode(result.stderr);
      assertEquals(result.success, true, stderr);

      const entries = new TextDecoder().decode(result.stdout).trim().split("\n").map((line) =>
        JSON.parse(line) as LogEntry
      );
      assertEquals(entries.map((entry) => entry.message), [
        "Cold overlay log",
        "After overlay log",
      ]);
    });

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
