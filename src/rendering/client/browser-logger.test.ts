import "#veryfront/schemas/_test-setup.ts";
/**
 * Unit Tests for Browser Logger
 * Tests browser-specific logging functionality with conditional log levels
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  browserLogger,
  createBrowserLogger,
  getBrowserLogLevel,
  hydrateLogger,
  LogLevel,
  prefetchLogger,
  rscLogger,
} from "./browser-logger.ts";

type ConsoleLevel = "debug" | "log" | "warn" | "error";

class MockConsole {
  logs: Array<{ level: ConsoleLevel; args: unknown[] }> = [];

  // The logger forwards detached console methods, so these must stay bound.
  debug = (...args: unknown[]): void => {
    this.logs.push({ level: "debug", args });
  };

  log = (...args: unknown[]): void => {
    this.logs.push({ level: "log", args });
  };

  warn = (...args: unknown[]): void => {
    this.logs.push({ level: "warn", args });
  };

  error = (...args: unknown[]): void => {
    this.logs.push({ level: "error", args });
  };

  getLogs(level: ConsoleLevel): Array<{ level: ConsoleLevel; args: unknown[] }> {
    return this.logs.filter((log) => log.level === level);
  }
}

function withMockConsole<T>(fn: (mockConsole: MockConsole) => T): T {
  const mockConsole = new MockConsole();
  const originalConsole = globalThis.console;

  // @ts-ignore - Mock console
  globalThis.console = mockConsole;

  try {
    return fn(mockConsole);
  } finally {
    globalThis.console = originalConsole;
  }
}

const DEV_FLAG_NAMES = [
  "__VERYFRONT_DEV__",
  "__RSC_DEV__",
  "__VERYFRONT_DEBUG__",
  "__RSC_DEBUG__",
] as const;

/** Run `fn` with a browser-like global scope: an optional `window` plus dev flags. */
function withBrowserGlobals<T>(
  options: { window?: boolean; flags?: Record<string, boolean> },
  fn: () => T,
): T {
  const scope = globalThis as unknown as Record<string, unknown>;
  const hadWindow = "window" in scope;
  const previousWindow = scope.window;
  const previousFlags = DEV_FLAG_NAMES.map((name) => ({
    name,
    present: name in scope,
    value: scope[name],
  }));

  for (const name of DEV_FLAG_NAMES) delete scope[name];
  if (options.window) {
    scope.window = {};
  } else {
    delete scope.window;
  }
  for (const [name, value] of Object.entries(options.flags ?? {})) {
    scope[name] = value;
  }

  try {
    return fn();
  } finally {
    for (const flag of previousFlags) {
      if (flag.present) {
        scope[flag.name] = flag.value;
      } else {
        delete scope[flag.name];
      }
    }
    if (hadWindow) {
      scope.window = previousWindow;
    } else {
      delete scope.window;
    }
  }
}

describe("Browser Logger", () => {
  describe("LogLevel Enum", () => {
    it("should have correct log level values", () => {
      assertEquals(LogLevel.DEBUG, 0);
      assertEquals(LogLevel.INFO, 1);
      assertEquals(LogLevel.WARN, 2);
      assertEquals(LogLevel.ERROR, 3);
    });
  });

  describe("ConditionalBrowserLogger", () => {
    it("should log debug messages when level is DEBUG", () => {
      withMockConsole((mockConsole) => {
        const logger = createBrowserLogger("TEST", LogLevel.DEBUG);
        logger.debug("test debug", { data: 123 });
        logger.info("test info");
        logger.warn("test warn");
        logger.error("test error");

        assertEquals(mockConsole.getLogs("debug").length, 1, "debug() reaches console.debug");
        assertEquals(mockConsole.getLogs("log").length, 1, "info() reaches console.log");
        assertEquals(mockConsole.getLogs("warn").length, 1, "warn() reaches console.warn");
        assertEquals(mockConsole.getLogs("error").length, 1, "error() reaches console.error");
      });
    });

    it("routes each level to its own console channel", () => {
      withMockConsole((mockConsole) => {
        const logger = createBrowserLogger("TEST", LogLevel.DEBUG);
        logger.warn("test warn");

        assertEquals(
          mockConsole.getLogs("warn").length,
          1,
          "warn() must route to console.warn",
        );
        assertEquals(
          mockConsole.getLogs("error").length,
          0,
          "warn() must not route to console.error",
        );
        assertEquals(
          mockConsole.getLogs("warn")[0]?.args[0],
          "[TEST] WARN: test warn",
          "warn() carries the WARN prefix",
        );
      });
    });

    it("should not log debug when level is INFO", () => {
      withMockConsole((mockConsole) => {
        const logger = createBrowserLogger("TEST", LogLevel.INFO);
        logger.debug("test debug");
        logger.info("test info");

        assertEquals(mockConsole.getLogs("debug").length, 0, "debug() is dropped below its level");
        assertEquals(mockConsole.getLogs("log").length, 1, "info() still logs at INFO");
      });
    });

    it("should only log errors when level is ERROR", () => {
      withMockConsole((mockConsole) => {
        const logger = createBrowserLogger("TEST", LogLevel.ERROR);
        logger.debug("test debug");
        logger.info("test info");
        logger.warn("test warn");
        logger.error("test error");

        assertEquals(mockConsole.getLogs("debug").length, 0, "debug() is dropped at ERROR");
        assertEquals(mockConsole.getLogs("log").length, 0, "info() is dropped at ERROR");
        assertEquals(mockConsole.getLogs("warn").length, 0, "warn() is dropped at ERROR");
        assertEquals(mockConsole.getLogs("error").length, 1, "error() still logs at ERROR");
      });
    });

    it("should format log messages with prefix", () => {
      withMockConsole((mockConsole) => {
        const logger = createBrowserLogger("CUSTOM", LogLevel.DEBUG);
        logger.info("test message");

        const logs = mockConsole.getLogs("log");
        assertEquals(logs.length, 1, "info() logged exactly once");
        assertEquals(logs[0]?.args[0], "[CUSTOM] test message", "info() carries the prefix");
      });
    });
  });

  describe("Exported Loggers", () => {
    function assertLoggerShape(logger: unknown): void {
      assertExists(logger);
      assertEquals(typeof (logger as { debug: unknown }).debug, "function");
      assertEquals(typeof (logger as { info: unknown }).info, "function");
      assertEquals(typeof (logger as { warn: unknown }).warn, "function");
      assertEquals(typeof (logger as { error: unknown }).error, "function");
    }

    it("should export rscLogger", () => {
      assertLoggerShape(rscLogger);
    });

    it("should export prefetchLogger", () => {
      assertLoggerShape(prefetchLogger);
    });

    it("should export hydrateLogger", () => {
      assertLoggerShape(hydrateLogger);
    });

    it("should export browserLogger", () => {
      assertLoggerShape(browserLogger);
    });
  });

  describe("Log Level Detection", () => {
    it("should use WARN level when not in development", () => {
      assertEquals(
        withBrowserGlobals({ window: false }, getBrowserLogLevel),
        LogLevel.WARN,
        "a non-browser scope logs at WARN",
      );
      assertEquals(
        withBrowserGlobals({ window: true }, getBrowserLogLevel),
        LogLevel.WARN,
        "a browser without a dev flag logs at WARN",
      );
    });

    it("should use DEBUG level when __VERYFRONT_DEBUG__ is set", () => {
      assertEquals(
        withBrowserGlobals(
          { window: true, flags: { __VERYFRONT_DEV__: true, __VERYFRONT_DEBUG__: true } },
          getBrowserLogLevel,
        ),
        LogLevel.DEBUG,
        "__VERYFRONT_DEBUG__ in development logs at DEBUG",
      );
      assertEquals(
        withBrowserGlobals(
          { window: true, flags: { __RSC_DEV__: true, __RSC_DEBUG__: true } },
          getBrowserLogLevel,
        ),
        LogLevel.DEBUG,
        "the __RSC_DEBUG__ alias logs at DEBUG",
      );
    });

    it("should use INFO level when __VERYFRONT_DEV__ is set without DEBUG", () => {
      assertEquals(
        withBrowserGlobals(
          { window: true, flags: { __VERYFRONT_DEV__: true } },
          getBrowserLogLevel,
        ),
        LogLevel.INFO,
        "development without a debug flag logs at INFO",
      );
      assertEquals(
        withBrowserGlobals({ window: true, flags: { __RSC_DEV__: true } }, getBrowserLogLevel),
        LogLevel.INFO,
        "the __RSC_DEV__ alias logs at INFO",
      );
    });

    it("does not inherit dev flags omitted from a nested test scope", () => {
      withBrowserGlobals(
        { window: true, flags: { __VERYFRONT_DEV__: true } },
        () => {
          assertEquals(
            withBrowserGlobals({ window: true }, getBrowserLogLevel),
            LogLevel.WARN,
            "each browser test scope must declare its own development flags",
          );
        },
      );
    });

    it("keeps WARN outside a browser even when the dev flags are set", () => {
      assertEquals(
        withBrowserGlobals(
          { window: false, flags: { __VERYFRONT_DEV__: true, __VERYFRONT_DEBUG__: true } },
          getBrowserLogLevel,
        ),
        LogLevel.WARN,
        "server-side rendering never drops below WARN",
      );
    });
  });

  describe("Additional Arguments Support", () => {
    it("should pass additional arguments to console methods", () => {
      withMockConsole((mockConsole) => {
        const logger = createBrowserLogger("TEST", LogLevel.DEBUG);
        const obj = { key: "value" };
        const arr = [1, 2, 3];

        logger.info("test", obj, arr);

        const logs = mockConsole.getLogs("log");
        assertEquals(logs.length, 1, "info() logged exactly once");
        assertEquals(logs[0]?.args.length, 3, "the extra arguments are forwarded");
        assertEquals(logs[0]?.args[1], obj, "the object argument is forwarded unchanged");
        assertEquals(logs[0]?.args[2], arr, "the array argument is forwarded unchanged");
      });
    });
  });

  describe("Missing Console Methods", () => {
    it("should handle missing console.debug gracefully", () => {
      const originalConsole = globalThis.console;
      const logged: unknown[][] = [];
      const partialConsole = {
        log: (...args: unknown[]) => {
          logged.push(args);
        },
        warn: () => {},
        error: () => {},
      };

      // @ts-ignore - Partial console
      globalThis.console = partialConsole;

      try {
        const logger = createBrowserLogger("TEST", LogLevel.DEBUG);
        logger.debug("test");
        logger.info("test");
      } finally {
        globalThis.console = originalConsole;
      }

      assertEquals(logged.length, 1, "a console without debug() still receives info() logs");
      assertEquals(logged[0]?.[0], "[TEST] test", "the info message survives the missing method");
    });
  });
});
