import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  __registerLogRecordEmitter,
  __registerRequestContextGetter,
  __registerTraceContextGetter,
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  __resetTraceContextGetterForTests,
  __subscribeLogRecordEmitter,
  createRunUserLogger,
  getBaseLogger,
  getDefaultLevel,
  type LogEntry,
  type Logger,
  LogLevel,
  refreshLoggerConfig,
  serverLogger,
} from "./logger.ts";
import {
  getRequestContext,
  type RequestContext,
  requestContextStore,
  runWithRequestContextAsync,
} from "./request-context.ts";
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
  it("fans out structured records, isolates subscriber failures, and unregisters subscribers", () => {
    const originalError = console.error;
    const records: string[] = [];
    const legacyRecords: string[] = [];
    console.error = () => {};

    try {
      __resetLogRecordEmitterForTests();
      __registerLogRecordEmitter((entry) => {
        legacyRecords.push(entry.message);
      });
      const unsubscribeThrowing = __subscribeLogRecordEmitter(() => {
        throw new Error("subscriber failed");
      });
      const unsubscribe = __subscribeLogRecordEmitter((entry) => {
        records.push(entry.message);
      });

      serverLogger.error("first fanout");
      unsubscribeThrowing();
      unsubscribe();
      serverLogger.error("after unregister");

      assertEquals(legacyRecords, ["first fanout", "after unregister"]);
      assertEquals(records, ["first fanout"]);
    } finally {
      __resetLogRecordEmitterForTests();
      console.error = originalError;
    }
  });

  it("does not duplicate a legacy emitter that is also subscribed", () => {
    const originalError = console.error;
    const records: string[] = [];
    const emitter = (entry: LogEntry) => {
      records.push(entry.message);
    };
    console.error = () => {};

    try {
      __resetLogRecordEmitterForTests();
      __registerLogRecordEmitter(emitter);
      const unsubscribe = __subscribeLogRecordEmitter(emitter);
      serverLogger.error("one record");
      unsubscribe();

      assertEquals(records, ["one record"]);
    } finally {
      __resetLogRecordEmitterForTests();
      console.error = originalError;
    }
  });

  it("contains throwing console access inside the logging boundary", () => {
    const originalLog = Object.getOwnPropertyDescriptor(console, "log")!;
    let threw = false;

    Object.defineProperty(console, "log", {
      configurable: true,
      get() {
        throw new Error("project code replaced the console sink");
      },
    });
    try {
      try {
        getBaseLogger("SERVER").info("contained console getter");
      } catch {
        threw = true;
      }
    } finally {
      Object.defineProperty(console, "log", originalLog);
    }

    assertEquals(threw, false);
  });

  it("uses captured subscriber iteration after the Set iterator changes", () => {
    const originalIterator = Object.getOwnPropertyDescriptor(Set.prototype, Symbol.iterator)!;
    const messages: string[] = [];
    const unsubscribe = __subscribeLogRecordEmitter((entry) => messages.push(entry.message));
    let threw = false;

    Object.defineProperty(Set.prototype, Symbol.iterator, {
      configurable: true,
      value() {
        throw new Error("project code replaced Set iteration");
      },
    });
    try {
      try {
        getBaseLogger("SERVER").info("captured subscriber iteration");
      } catch {
        threw = true;
      }
    } finally {
      Object.defineProperty(Set.prototype, Symbol.iterator, originalIterator);
      unsubscribe();
    }

    assertEquals(threw, false);
    assertEquals(messages, ["captured subscriber iteration"]);
  });

  it("delivers one record once when a subscriber reinserts itself", () => {
    const originalLog = console.log;
    let calls = 0;
    let unsubscribe = () => {};
    const subscriber = () => {
      calls++;
      unsubscribe();
      unsubscribe = __subscribeLogRecordEmitter(subscriber);
    };

    console.log = () => {};
    unsubscribe = __subscribeLogRecordEmitter(subscriber);
    try {
      getBaseLogger("SERVER").info("single delivery");
    } finally {
      unsubscribe();
      console.log = originalLog;
    }

    assertEquals(calls, 1);
  });

  it("keeps emitting after the Date constructor and prototype method change", () => {
    const { getOutput, restore } = captureConsoleLog();
    const OriginalDate = globalThis.Date;
    const originalToISOString = OriginalDate.prototype.toISOString;

    try {
      withJsonLogFormat(() => {
        globalThis.Date = function ReplacementDate() {
          throw new Error("project code replaced Date");
        } as unknown as DateConstructor;
        OriginalDate.prototype.toISOString = () => {
          throw new Error("project code replaced Date serialization");
        };
        getBaseLogger("SERVER").info("captured timestamp intrinsics");
      });
    } finally {
      globalThis.Date = OriginalDate;
      OriginalDate.prototype.toISOString = originalToISOString;
      restore();
    }

    const entry = JSON.parse(getOutput()) as LogEntry;
    assertEquals(entry.message, "captured timestamp intrinsics");
  });

  it("uses captured case conversion in normal and emergency logging", () => {
    const { getOutput, restore } = captureConsoleLog();
    const originalToLowerCase = String.prototype.toLowerCase;
    let threw = false;

    try {
      withJsonLogFormat(() => {
        String.prototype.toLowerCase = () => {
          throw new Error("project code replaced lowercase conversion");
        };
        try {
          getBaseLogger("SERVER").info("captured lowercase conversion");
        } catch {
          threw = true;
        } finally {
          String.prototype.toLowerCase = originalToLowerCase;
        }
      });
    } finally {
      String.prototype.toLowerCase = originalToLowerCase;
      restore();
    }

    assertEquals(threw, false);
    const entry = JSON.parse(getOutput()) as LogEntry;
    assertEquals(entry.message, "captured lowercase conversion");
  });

  it("omits empty component names in emergency JSON entries", () => {
    const { getOutput, restore } = captureConsoleLog();
    const originalKeys = Object.keys;

    try {
      withJsonLogFormat(() => {
        Object.keys = () => {
          throw new Error("project code replaced Object.keys");
        };
        getBaseLogger("SERVER").component("").info("emergency component");
      });
    } finally {
      Object.keys = originalKeys;
      restore();
    }

    const entry = JSON.parse(getOutput()) as LogEntry;
    assertEquals(entry.message, "[REDACTED]");
    assertEquals(entry.component, undefined);
  });

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

    it("should use the shared truthy semantics for VERYFRONT_DEBUG", () => {
      assertEquals(getDefaultLevel("", " Yes "), LogLevel.DEBUG);
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

    it("falls back when the request-context provider or logger accessor throws", () => {
      const { getOutput, restore } = captureConsoleLog();
      const hostileContext = Object.create(null) as { logger: Logger };
      Object.defineProperty(hostileContext, "logger", {
        get() {
          throw new Error("unreadable request logger");
        },
      });

      try {
        withJsonLogFormat(() => {
          __registerRequestContextGetter(() => {
            throw new Error("request context unavailable");
          });
          serverLogger.info("provider fallback");
          assertEquals((JSON.parse(getOutput()) as LogEntry).message, "provider fallback");

          __registerRequestContextGetter(() => hostileContext);
          serverLogger.info("accessor fallback");
          assertEquals((JSON.parse(getOutput()) as LogEntry).message, "accessor fallback");
        });
      } finally {
        __registerRequestContextGetter(getRequestContext);
        restore();
      }
    });

    it("falls back when request logger dispatch or AsyncLocalStorage lookup throws", () => {
      const { getOutput, restore } = captureConsoleLog();
      const hostileLogger = new Proxy({} as Logger, {
        get(_target, property) {
          if (property === "info") throw new Error("unreadable logger method");
          return undefined;
        },
      });
      const storagePrototype = Object.getPrototypeOf(requestContextStore);
      const originalGetStore = Object.getOwnPropertyDescriptor(storagePrototype, "getStore")!;

      try {
        withJsonLogFormat(() => {
          __registerRequestContextGetter(() => ({ logger: hostileLogger }));
          serverLogger.info("dispatch fallback");
          assertEquals((JSON.parse(getOutput()) as LogEntry).message, "dispatch fallback");

          __registerRequestContextGetter(getRequestContext);
          Object.defineProperty(storagePrototype, "getStore", {
            configurable: true,
            value() {
              throw new Error("project code replaced AsyncLocalStorage.getStore");
            },
          });
          try {
            serverLogger.info("storage fallback");
          } finally {
            Object.defineProperty(storagePrototype, "getStore", originalGetStore);
          }
          assertEquals((JSON.parse(getOutput()) as LogEntry).message, "storage fallback");
        });
      } finally {
        Object.defineProperty(storagePrototype, "getStore", originalGetStore);
        __registerRequestContextGetter(getRequestContext);
        restore();
      }
    });

    it("contains hostile request logger timing and child composition", async () => {
      const { getOutput, restore } = captureConsoleLog();
      const originalError = console.error;
      const hostileLogger = new Proxy({} as Logger, {
        get() {
          throw new Error("unreadable logger operation");
        },
      });
      let executions = 0;

      Deno.env.set("LOG_FORMAT", "json");
      console.error = () => {};
      __resetLoggerConfigForTests();
      __registerRequestContextGetter(() => ({ logger: hostileLogger }));
      try {
        const directResult = await serverLogger.time("direct timer", () => {
          executions++;
          return Promise.resolve("direct result");
        });
        assertEquals(directResult, "direct result");
        assertEquals(executions, 1);

        serverLogger.child({ scope: "direct" }).info("direct child fallback");
        assertEquals((JSON.parse(getOutput()) as LogEntry).message, "direct child fallback");

        const componentLogger = serverLogger.component("request");
        const componentResult = await componentLogger.time("component timer", () => {
          executions++;
          return Promise.resolve("component result");
        });
        assertEquals(componentResult, "component result");
        assertEquals(executions, 2);

        componentLogger.child({ scope: "component" }).info("component child fallback");
        const componentEntry = JSON.parse(getOutput()) as LogEntry;
        assertEquals(componentEntry.message, "component child fallback");
        assertEquals(componentEntry.component, "request");

        const applicationError = new Error("application failure");
        let caught: unknown;
        try {
          await serverLogger.time("rejected timer", () => {
            executions++;
            return Promise.reject(applicationError);
          });
        } catch (error) {
          caught = error;
        }
        assertEquals(caught, applicationError);
        assertEquals(executions, 3);

        const returnedHostileLogger = new Proxy({} as Logger, {
          get() {
            throw new Error("unreadable returned child logger");
          },
        });
        const hostileChildFactory = {
          child() {
            return returnedHostileLogger;
          },
          component() {
            return hostileChildFactory;
          },
        } as unknown as Logger;
        __registerRequestContextGetter(() => ({ logger: hostileChildFactory }));

        const guardedChild = serverLogger.child({ scope: "returned" });
        guardedChild.info("returned child fallback");
        assertEquals((JSON.parse(getOutput()) as LogEntry).message, "returned child fallback");
        assertEquals(
          await guardedChild.time("returned child timer", () => Promise.resolve("timed")),
          "timed",
        );
        guardedChild.child({ nested: true }).info("nested child fallback");
        assertEquals((JSON.parse(getOutput()) as LogEntry).message, "nested child fallback");
        guardedChild.component("nested").info("nested component fallback");
        assertEquals((JSON.parse(getOutput()) as LogEntry).message, "nested component fallback");

        serverLogger.component("request").child({ scope: "component" }).info(
          "returned component child fallback",
        );
        const returnedComponentEntry = JSON.parse(getOutput()) as LogEntry;
        assertEquals(returnedComponentEntry.message, "returned component child fallback");
        assertEquals(returnedComponentEntry.component, "request");
      } finally {
        __registerRequestContextGetter(getRequestContext);
        Deno.env.delete("LOG_FORMAT");
        __resetLoggerConfigForTests();
        console.error = originalError;
        restore();
      }
    });

    it("preserves timer outcomes when label coercion throws", async () => {
      const originalError = console.error;
      const hostileLabel = {
        [Symbol.toPrimitive]() {
          throw new Error("unreadable timer label");
        },
      } as unknown as string;
      const loggers: Logger[] = [
        getBaseLogger("timer"),
        serverLogger,
        serverLogger.component("timer"),
      ];
      let executions = 0;

      console.error = () => {};
      try {
        for (const timerLogger of loggers) {
          const result = await timerLogger.time(hostileLabel, () => {
            executions++;
            return Promise.resolve("application result");
          });
          assertEquals(result, "application result");

          const applicationError = new Error("application rejection");
          let caught: unknown;
          try {
            await timerLogger.time(hostileLabel, () => {
              executions++;
              return Promise.reject(applicationError);
            });
          } catch (error) {
            caught = error;
          }
          assertEquals(caught, applicationError);
        }
        assertEquals(executions, 6);
      } finally {
        console.error = originalError;
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
          assertEquals(
            entry.service,
            "server",
            "SERVER prefix must emit service=server for Loki queries",
          );
          assertEquals(entry.veryfrontVersion, VERSION);
          assertEquals(entry.message, "Test message");
          assertEquals(entry.context?.extra, "data");
        });
      } finally {
        restore();
      }
    });

    it("resolves a base logger prefix to its own service name", () => {
      const { getOutput, reset, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          getBaseLogger("server").info("x");
          assertEquals(
            (JSON.parse(getOutput()) as LogEntry).service,
            "server",
            "a lowercase prefix must resolve to the SERVER base logger",
          );

          reset();
          getBaseLogger("timer").info("x");
          assertEquals(
            (JSON.parse(getOutput()) as LogEntry).service,
            "veryfront",
            "an unknown prefix must fall back to the veryfront base logger",
          );
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

    it("scrubs credential-shaped text from string-valued lifted fields (#341)", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          serverLogger.info("Tool event", {
            tool_name: "browser_fetch?access_token=synthetic-probe-secret&page=2",
          });

          const line = getOutput();
          const entry = JSON.parse(line) as LogEntry;
          assertEquals(line.includes("synthetic-probe-secret"), false);
          assertEquals(entry.tool_name, "browser_fetch?access_token=[REDACTED]&page=2");
          assertEquals(entry.context, undefined);
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

    it("keeps benign assignment-shaped log messages intact", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          serverLogger.info("mapping: 4 routes resolved");
        });

        const entry = JSON.parse(getOutput()) as LogEntry;
        assertEquals(entry.message, "mapping: 4 routes resolved");
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

    it("contains hostile child context, component, and message values", () => {
      const { getOutput, restore } = captureConsoleLog();
      const hostileValue = new Proxy({}, {
        get() {
          throw new Error("hostile value read");
        },
        ownKeys() {
          throw new Error("hostile keys read");
        },
      });

      try {
        withJsonLogFormat(() => {
          const hostileContext = hostileValue as Record<string, unknown>;
          const hostileString = hostileValue as unknown as string;
          getBaseLogger("SERVER")
            .child(hostileContext)
            .component(hostileString)
            .info(hostileString, hostileContext);
        });

        const entry = JSON.parse(getOutput()) as LogEntry;
        assertEquals(entry.message, "[REDACTED]");
        assertEquals(entry.component, "[REDACTED]");
      } finally {
        restore();
      }
    });

    it("ignores inherited serialization hooks and preserves component fields", () => {
      const { getOutput, restore } = captureConsoleLog();
      const objectToJson = Object.getOwnPropertyDescriptor(Object.prototype, "toJSON");
      const arrayToJson = Object.getOwnPropertyDescriptor(Array.prototype, "toJSON");
      let hookCalls = 0;

      Object.defineProperty(Object.prototype, "toJSON", {
        configurable: true,
        value() {
          hookCalls += 1;
          throw new Error("inherited object serializer must not run");
        },
      });
      Object.defineProperty(Array.prototype, "toJSON", {
        configurable: true,
        value() {
          hookCalls += 1;
          throw new Error("inherited array serializer must not run");
        },
      });

      try {
        withJsonLogFormat(() => {
          getBaseLogger("SERVER").component("routing").info("Routes", {
            values: ["one", "two"],
          });
        });
      } finally {
        if (objectToJson) {
          Object.defineProperty(Object.prototype, "toJSON", objectToJson);
        } else {
          delete (Object.prototype as { toJSON?: unknown }).toJSON;
        }
        if (arrayToJson) {
          Object.defineProperty(Array.prototype, "toJSON", arrayToJson);
        } else {
          delete (Array.prototype as { toJSON?: unknown }).toJSON;
        }
        restore();
      }

      assertEquals(hookCalls, 0);
      const entry = JSON.parse(getOutput()) as LogEntry;
      assertEquals(entry.component, "routing");
      assertEquals(entry.context?.values, ["one", "two"]);
    });

    it("ignores hooks added through the intrinsic array prototype chain", () => {
      const { getOutput, restore } = captureConsoleLog();
      const originalArrayPrototypeParent = Object.getPrototypeOf(Array.prototype);
      let hookCalls = 0;
      const hostileParent = Object.create(originalArrayPrototypeParent) as {
        toJSON?: () => unknown;
      };
      hostileParent.toJSON = () => {
        hookCalls += 1;
        return "polluted-array";
      };

      Object.setPrototypeOf(Array.prototype, hostileParent);
      try {
        withJsonLogFormat(() => {
          serverLogger.info("Routes", {
            values: [{ apiKey: "secret", ok: true }],
          });
        });
      } finally {
        Object.setPrototypeOf(Array.prototype, originalArrayPrototypeParent);
        restore();
      }

      assertEquals(hookCalls, 0);
      const entry = JSON.parse(getOutput()) as LogEntry;
      assertEquals(entry.context?.values, [{ apiKey: "[REDACTED]", ok: true }]);
    });

    it("preserves non-callable own toJSON fields", () => {
      const { getOutput, restore } = captureConsoleLog();

      try {
        withJsonLogFormat(() => {
          serverLogger.info("Metadata", { toJSON: "plain metadata" });
        });

        const entry = JSON.parse(getOutput()) as LogEntry;
        assertEquals(entry.context?.toJSON, "plain metadata");
      } finally {
        restore();
      }
    });

    it("uses the captured JSON serializer when the global is replaced", () => {
      const { getOutput, restore } = captureConsoleLog();
      const originalStringify = JSON.stringify;

      try {
        withJsonLogFormat(() => {
          JSON.stringify = () => {
            throw new Error("project code replaced JSON.stringify");
          };
          serverLogger.info("Protected serializer", { apiKey: "sk-project-secret" });
        });
      } finally {
        JSON.stringify = originalStringify;
        restore();
      }

      const entry = JSON.parse(getOutput()) as LogEntry;
      assertEquals(entry.message, "Protected serializer");
      assertEquals(entry.context?.apiKey, "[REDACTED]");
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

    it("scrubs credential-shaped text from rendered context values (#341)", () => {
      Deno.env.set("LOG_FORMAT", "text");
      Deno.env.set("NO_COLOR", "1");
      __resetLoggerConfigForTests();

      const { getOutput, restore } = captureConsoleLog();

      try {
        serverLogger.info("Tool event", {
          toolName: "browser_fetch",
          callback: "https://api.example.com/cb?access_token=synthetic-text-secret&page=2",
          nested: {
            link: "https://api.example.com/cb?access_token=synthetic-nested-secret&page=2",
          },
          urlObject: new URL(
            "https://api.example.com/cb?access_token=synthetic-url-object-secret&page=2",
          ),
          attempt: 2,
        });

        const output = getOutput();
        assertEquals(output.includes("synthetic-text-secret"), false);
        assertEquals(output.includes("synthetic-nested-secret"), false);
        assertEquals(output.includes("synthetic-url-object-secret"), false);
        assertEquals(output.includes("toolName=browser_fetch"), true);
        assertEquals(
          output.includes("callback=https://api.example.com/cb?access_token=[REDACTED]&page=2"),
          true,
        );
        assertEquals(
          output.includes('"link":"https://api.example.com/cb?access_token=[REDACTED]&page=2"'),
          true,
        );
        assertEquals(
          output.includes("urlObject=https://api.example.com/cb?access_token=[REDACTED]&page=2"),
          true,
        );
        assertEquals(output.includes("attempt=2"), true);
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
