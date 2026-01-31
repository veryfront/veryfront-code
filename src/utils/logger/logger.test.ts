import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __resetLoggerConfigForTesting,
  getBaseLogger,
  getDefaultLevel,
  type LogEntry,
  LogLevel,
  serverLogger,
} from "./logger.ts";
import { type RequestContext, runWithRequestContextAsync } from "./request-context.ts";
import { VERSION } from "../version.ts";

function captureConsoleLog(): { getOutput: () => string; restore: () => void } {
  const originalLog = console.log;
  let capturedOutput = "";

  console.log = (msg: string) => {
    capturedOutput = msg;
  };

  return {
    getOutput: () => capturedOutput,
    restore: () => {
      console.log = originalLog;
    },
  };
}

function withJsonLogFormat<T>(fn: () => T): T {
  __resetLoggerConfigForTesting();
  Deno.env.set("LOG_FORMAT", "json");

  try {
    return fn();
  } finally {
    Deno.env.delete("LOG_FORMAT");
    __resetLoggerConfigForTesting();
  }
}

describe("logger", () => {
  describe("getDefaultLevel", () => {
    it("should return DEBUG for LOG_LEVEL=DEBUG", () => {
      assertEquals(getDefaultLevel("DEBUG", undefined), LogLevel.DEBUG);
    });

    it("should return INFO for LOG_LEVEL=INFO", () => {
      assertEquals(getDefaultLevel("INFO", undefined), LogLevel.INFO);
    });

    it("should return WARN for LOG_LEVEL=WARN", () => {
      assertEquals(getDefaultLevel("WARN", undefined), LogLevel.WARN);
    });

    it("should return ERROR for LOG_LEVEL=ERROR", () => {
      assertEquals(getDefaultLevel("ERROR", undefined), LogLevel.ERROR);
    });

    it("should be case-insensitive for LOG_LEVEL", () => {
      assertEquals(getDefaultLevel("debug", undefined), LogLevel.DEBUG);
      assertEquals(getDefaultLevel("Info", undefined), LogLevel.INFO);
    });

    it("should return DEBUG when VERYFRONT_DEBUG=1", () => {
      assertEquals(getDefaultLevel(undefined, "1"), LogLevel.DEBUG);
    });

    it("should return DEBUG when VERYFRONT_DEBUG=true", () => {
      assertEquals(getDefaultLevel(undefined, "true"), LogLevel.DEBUG);
    });

    it("should return INFO by default", () => {
      assertEquals(getDefaultLevel(undefined, undefined), LogLevel.INFO);
    });

    it("should prefer LOG_LEVEL over VERYFRONT_DEBUG", () => {
      assertEquals(getDefaultLevel("ERROR", "1"), LogLevel.ERROR);
    });

    it("should return INFO for invalid LOG_LEVEL without debug flag", () => {
      assertEquals(getDefaultLevel("INVALID", undefined), LogLevel.INFO);
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
  });
});
