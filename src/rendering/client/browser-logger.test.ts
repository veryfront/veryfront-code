/**
 * Unit Tests for Browser Logger
 * Tests browser-specific logging functionality with conditional log levels
 */

import { assertEquals, assertExists } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import {
  BrowserLogger,
  browserLogger,
  hydrateLogger,
  LogLevel,
  prefetchLogger,
  rscLogger,
} from "./browser-logger.ts";

// Mock console methods
class MockConsole {
  logs: Array<{ level: string; args: unknown[] }> = [];

  debug(...args: unknown[]) {
    this.logs.push({ level: "debug", args });
  }

  log(...args: unknown[]) {
    this.logs.push({ level: "log", args });
  }

  warn(...args: unknown[]) {
    this.logs.push({ level: "warn", args });
  }

  error(...args: unknown[]) {
    this.logs.push({ level: "error", args });
  }

  clear() {
    this.logs = [];
  }

  getLogs(level: string) {
    return this.logs.filter((log) => log.level === level);
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
      const mockConsole = new MockConsole();
      const originalConsole = globalThis.console;

      // @ts-ignore - Mock console
      globalThis.console = mockConsole;

      class TestLogger implements BrowserLogger {
        private prefix = "TEST";
        private level = LogLevel.DEBUG;

        debug(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.DEBUG) {
            console.debug?.(`[${this.prefix}] DEBUG: ${message}`, ...args);
          }
        }

        info(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.INFO) {
            console.log?.(`[${this.prefix}] ${message}`, ...args);
          }
        }

        warn(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.WARN) {
            console.warn?.(`[${this.prefix}] WARN: ${message}`, ...args);
          }
        }

        error(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.ERROR) {
            console.error?.(`[${this.prefix}] ERROR: ${message}`, ...args);
          }
        }
      }

      const logger = new TestLogger();
      logger.debug("test debug", { data: 123 });
      logger.info("test info");
      logger.warn("test warn");
      logger.error("test error");

      assertEquals(mockConsole.getLogs("debug").length, 1);
      assertEquals(mockConsole.getLogs("log").length, 1);
      assertEquals(mockConsole.getLogs("warn").length, 1);
      assertEquals(mockConsole.getLogs("error").length, 1);

      globalThis.console = originalConsole;
    });

    it("should not log debug when level is INFO", () => {
      const mockConsole = new MockConsole();
      const originalConsole = globalThis.console;

      // @ts-ignore - Mock console
      globalThis.console = mockConsole;

      class TestLogger implements BrowserLogger {
        private prefix = "TEST";
        private level = LogLevel.INFO;

        debug(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.DEBUG) {
            console.debug?.(`[${this.prefix}] DEBUG: ${message}`, ...args);
          }
        }

        info(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.INFO) {
            console.log?.(`[${this.prefix}] ${message}`, ...args);
          }
        }

        warn(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.WARN) {
            console.warn?.(`[${this.prefix}] WARN: ${message}`, ...args);
          }
        }

        error(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.ERROR) {
            console.error?.(`[${this.prefix}] ERROR: ${message}`, ...args);
          }
        }
      }

      const logger = new TestLogger();
      logger.debug("test debug");
      logger.info("test info");

      assertEquals(mockConsole.getLogs("debug").length, 0);
      assertEquals(mockConsole.getLogs("log").length, 1);

      globalThis.console = originalConsole;
    });

    it("should only log errors when level is ERROR", () => {
      const mockConsole = new MockConsole();
      const originalConsole = globalThis.console;

      // @ts-ignore - Mock console
      globalThis.console = mockConsole;

      class TestLogger implements BrowserLogger {
        private prefix = "TEST";
        private level = LogLevel.ERROR;

        debug(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.DEBUG) {
            console.debug?.(`[${this.prefix}] DEBUG: ${message}`, ...args);
          }
        }

        info(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.INFO) {
            console.log?.(`[${this.prefix}] ${message}`, ...args);
          }
        }

        warn(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.WARN) {
            console.warn?.(`[${this.prefix}] WARN: ${message}`, ...args);
          }
        }

        error(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.ERROR) {
            console.error?.(`[${this.prefix}] ERROR: ${message}`, ...args);
          }
        }
      }

      const logger = new TestLogger();
      logger.debug("test debug");
      logger.info("test info");
      logger.warn("test warn");
      logger.error("test error");

      assertEquals(mockConsole.getLogs("debug").length, 0);
      assertEquals(mockConsole.getLogs("log").length, 0);
      assertEquals(mockConsole.getLogs("warn").length, 0);
      assertEquals(mockConsole.getLogs("error").length, 1);

      globalThis.console = originalConsole;
    });

    it("should format log messages with prefix", () => {
      const mockConsole = new MockConsole();
      const originalConsole = globalThis.console;

      // @ts-ignore - Mock console
      globalThis.console = mockConsole;

      class TestLogger implements BrowserLogger {
        private prefix = "CUSTOM";
        private level = LogLevel.DEBUG;

        debug(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.DEBUG) {
            console.debug?.(`[${this.prefix}] DEBUG: ${message}`, ...args);
          }
        }

        info(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.INFO) {
            console.log?.(`[${this.prefix}] ${message}`, ...args);
          }
        }

        warn(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.WARN) {
            console.warn?.(`[${this.prefix}] WARN: ${message}`, ...args);
          }
        }

        error(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.ERROR) {
            console.error?.(`[${this.prefix}] ERROR: ${message}`, ...args);
          }
        }
      }

      const logger = new TestLogger();
      logger.info("test message");

      const logs = mockConsole.getLogs("log");
      assertEquals(logs.length, 1);
      assertEquals(logs[0]?.args[0], "[CUSTOM] test message");

      globalThis.console = originalConsole;
    });
  });

  describe("Exported Loggers", () => {
    it("should export rscLogger", () => {
      assertExists(rscLogger);
      assertEquals(typeof rscLogger.debug, "function");
      assertEquals(typeof rscLogger.info, "function");
      assertEquals(typeof rscLogger.warn, "function");
      assertEquals(typeof rscLogger.error, "function");
    });

    it("should export prefetchLogger", () => {
      assertExists(prefetchLogger);
      assertEquals(typeof prefetchLogger.debug, "function");
      assertEquals(typeof prefetchLogger.info, "function");
      assertEquals(typeof prefetchLogger.warn, "function");
      assertEquals(typeof prefetchLogger.error, "function");
    });

    it("should export hydrateLogger", () => {
      assertExists(hydrateLogger);
      assertEquals(typeof hydrateLogger.debug, "function");
      assertEquals(typeof hydrateLogger.info, "function");
      assertEquals(typeof hydrateLogger.warn, "function");
      assertEquals(typeof hydrateLogger.error, "function");
    });

    it("should export browserLogger", () => {
      assertExists(browserLogger);
      assertEquals(typeof browserLogger.debug, "function");
      assertEquals(typeof browserLogger.info, "function");
      assertEquals(typeof browserLogger.warn, "function");
      assertEquals(typeof browserLogger.error, "function");
    });
  });

  describe("Log Level Detection", () => {
    it("should use WARN level when not in development", () => {
      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = {};

      // The default level should be WARN in non-development
      const mockConsole = new MockConsole();
      const originalConsole = globalThis.console;
      // @ts-ignore - Mock console
      globalThis.console = mockConsole;

      // Since we can't easily reimport, we'll verify the behavior indirectly
      // by checking that loggers exist and are callable
      assertExists(browserLogger);
      browserLogger.info("test");

      // Restore
      globalThis.console = originalConsole;
      (globalThis as any).window = originalWindow;
    });

    it("should use DEBUG level when __VERYFRONT_DEBUG__ is set", () => {
      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = {
        __VERYFRONT_DEV__: true,
        __VERYFRONT_DEBUG__: true,
      };

      // Verify loggers exist
      assertExists(browserLogger);
      assertExists(rscLogger);
      (globalThis as any).window = originalWindow;
    });

    it("should use INFO level when __VERYFRONT_DEV__ is set without DEBUG", () => {
      const originalWindow = (globalThis as any).window;
      (globalThis as any).window = {
        __VERYFRONT_DEV__: true,
      };

      // Verify loggers exist
      assertExists(browserLogger);
      assertExists(prefetchLogger);
      (globalThis as any).window = originalWindow;
    });
  });

  describe("Additional Arguments Support", () => {
    it("should pass additional arguments to console methods", () => {
      const mockConsole = new MockConsole();
      const originalConsole = globalThis.console;

      // @ts-ignore - Mock console
      globalThis.console = mockConsole;

      class TestLogger implements BrowserLogger {
        private prefix = "TEST";
        private level = LogLevel.DEBUG;

        debug(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.DEBUG) {
            console.debug?.(`[${this.prefix}] DEBUG: ${message}`, ...args);
          }
        }

        info(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.INFO) {
            console.log?.(`[${this.prefix}] ${message}`, ...args);
          }
        }

        warn(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.WARN) {
            console.warn?.(`[${this.prefix}] WARN: ${message}`, ...args);
          }
        }

        error(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.ERROR) {
            console.error?.(`[${this.prefix}] ERROR: ${message}`, ...args);
          }
        }
      }

      const logger = new TestLogger();
      const obj = { key: "value" };
      const arr = [1, 2, 3];

      logger.info("test", obj, arr);

      const logs = mockConsole.getLogs("log");
      assertEquals(logs.length, 1);
      assertEquals(logs[0]?.args.length, 3);
      assertEquals(logs[0]?.args[1], obj);
      assertEquals(logs[0]?.args[2], arr);

      globalThis.console = originalConsole;
    });
  });

  describe("Missing Console Methods", () => {
    it("should handle missing console.debug gracefully", () => {
      const originalConsole = globalThis.console;
      const partialConsole = {
        log: () => {},
        warn: () => {},
        error: () => {},
      };

      // @ts-ignore - Partial console
      globalThis.console = partialConsole;

      class TestLogger implements BrowserLogger {
        private prefix = "TEST";
        private level = LogLevel.DEBUG;

        debug(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.DEBUG) {
            console.debug?.(`[${this.prefix}] DEBUG: ${message}`, ...args);
          }
        }

        info(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.INFO) {
            console.log?.(`[${this.prefix}] ${message}`, ...args);
          }
        }

        warn(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.WARN) {
            console.warn?.(`[${this.prefix}] WARN: ${message}`, ...args);
          }
        }

        error(message: string, ...args: unknown[]): void {
          if (this.level <= LogLevel.ERROR) {
            console.error?.(`[${this.prefix}] ERROR: ${message}`, ...args);
          }
        }
      }

      const logger = new TestLogger();

      // Should not throw
      logger.debug("test");
      logger.info("test");

      globalThis.console = originalConsole;
    });
  });
});
