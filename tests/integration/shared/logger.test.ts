import { assertEquals, assertRejects } from "@veryfront/testing/assert";
import { describe, it } from "@veryfront/testing/bdd";
import { deleteEnv, getEnv, setEnv } from "@veryfront/compat/process.ts";
import { LogLevel } from "@veryfront/utils/logger/index.ts";
import { delay } from "@std/async";

async function importFresh() {
  const mod = await import(`@veryfront/utils/logger/index.ts?ts=${Date.now()}&r=${Math.random()}`);
  return mod;
}

async function importSharedLogger(query: string) {
  const mod = await import(`@veryfront/utils/logger/index.ts?${query}`);
  return mod;
}

function assertExists(value: unknown): asserts value is NonNullable<unknown> {
  if (value === null || value === undefined) {
    throw new Error("Expected value to exist");
  }
}

describe("Logger", () => {
  describe("Log Levels", () => {
    it("LogLevel enum has correct values", () => {
      assertEquals(LogLevel.DEBUG, 0);
      assertEquals(LogLevel.INFO, 1);
      assertEquals(LogLevel.WARN, 2);
      assertEquals(LogLevel.ERROR, 3);
    });

    it("logs all levels when LOG_LEVEL is DEBUG", async () => {
      const prevVF = getEnv("VERYFRONT_DEBUG");
      const prevLV = getEnv("LOG_LEVEL");
      const orig = {
        debug: console.debug,
        log: console.log,
        warn: console.warn,
        error: console.error,
      };

      const messages: string[] = [];
      console.debug = (msg: string) => messages.push(msg);
      console.log = (msg: string) => messages.push(msg);
      console.warn = (msg: string) => messages.push(msg);
      console.error = (msg: string) => messages.push(msg);

      try {
        setEnv("LOG_LEVEL", "DEBUG");
        deleteEnv("VERYFRONT_DEBUG");
        const mod = await importSharedLogger(`ts=${Date.now()}`);
        const logger = mod.logger;

        messages.length = 0;
        logger.debug("debug msg");
        logger.info("info msg");
        logger.warn("warn msg");
        logger.error("error msg");

        assertEquals(
          messages.some((m) => m.includes("debug msg")),
          true,
        );
        assertEquals(
          messages.some((m) => m.includes("info msg")),
          true,
        );
        assertEquals(
          messages.some((m) => m.includes("warn msg")),
          true,
        );
        assertEquals(
          messages.some((m) => m.includes("error msg")),
          true,
        );
      } finally {
        if (prevVF === undefined) deleteEnv("VERYFRONT_DEBUG");
        else setEnv("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) deleteEnv("LOG_LEVEL");
        else setEnv("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });

    it("respects LOG_LEVEL=INFO and skips debug messages", async () => {
      const prevVF = getEnv("VERYFRONT_DEBUG");
      const prevLV = getEnv("LOG_LEVEL");
      const original = { debug: console.debug, log: console.log };
      const counts = { debug: 0, log: 0 };
      console.debug = () => {
        counts.debug++;
      };
      console.log = () => {
        counts.log++;
      };
      try {
        setEnv("VERYFRONT_DEBUG", "true");
        setEnv("LOG_LEVEL", "INFO");
        const { logger } = await importFresh();
        logger.debug("d");
        logger.info("i");
        assertEquals(counts.debug, 0);
        assertEquals(counts.log >= 1, true);
      } finally {
        if (prevVF === undefined) deleteEnv("VERYFRONT_DEBUG");
        else setEnv("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) deleteEnv("LOG_LEVEL");
        else setEnv("LOG_LEVEL", prevLV);
        console.debug = original.debug;
        console.log = original.log;
      }
    });

    it("respects LOG_LEVEL=WARN and skips debug and info messages", async () => {
      const prevVF = getEnv("VERYFRONT_DEBUG");
      const prevLV = getEnv("LOG_LEVEL");
      const orig = {
        debug: console.debug,
        log: console.log,
        warn: console.warn,
        error: console.error,
      };

      const messages: string[] = [];
      console.debug = (msg: string) => messages.push(msg);
      console.log = (msg: string) => messages.push(msg);
      console.warn = (msg: string) => messages.push(msg);
      console.error = (msg: string) => messages.push(msg);

      try {
        setEnv("LOG_LEVEL", "WARN");
        deleteEnv("VERYFRONT_DEBUG");
        const mod = await importSharedLogger(`ts=${Date.now()}-warn`);
        const logger = mod.logger;

        messages.length = 0;
        logger.debug("debug msg");
        logger.info("info msg");
        logger.warn("warn msg");
        logger.error("error msg");

        assertEquals(
          messages.some((m) => m.includes("debug msg")),
          false,
        );
        assertEquals(
          messages.some((m) => m.includes("info msg")),
          false,
        );
        assertEquals(
          messages.some((m) => m.includes("warn msg")),
          true,
        );
        assertEquals(
          messages.some((m) => m.includes("error msg")),
          true,
        );
      } finally {
        if (prevVF === undefined) deleteEnv("VERYFRONT_DEBUG");
        else setEnv("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) deleteEnv("LOG_LEVEL");
        else setEnv("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });

    it("respects LOG_LEVEL=ERROR and only logs errors", async () => {
      const prevVF = getEnv("VERYFRONT_DEBUG");
      const prevLV = getEnv("LOG_LEVEL");
      const orig = {
        debug: console.debug,
        log: console.log,
        warn: console.warn,
        error: console.error,
      };
      const counts = { debug: 0, log: 0, warn: 0, error: 0 };
      console.debug = (..._a: unknown[]) => {
        counts.debug++;
      };
      console.log = (..._a: unknown[]) => {
        counts.log++;
      };
      console.warn = (..._a: unknown[]) => {
        counts.warn++;
      };
      console.error = (..._a: unknown[]) => {
        counts.error++;
      };
      try {
        setEnv("VERYFRONT_DEBUG", "0");
        setEnv("LOG_LEVEL", "ERROR");
        const mod = await importSharedLogger(`ts=${Date.now()}`);
        const logger = mod.logger;
        logger.debug("d");
        logger.info("i");
        logger.warn("w");
        logger.error("e");
        assertEquals(counts.debug, 0);
        assertEquals(counts.log, 0);
        assertEquals(counts.warn, 0);
        assertEquals(counts.error >= 1, true);
      } finally {
        if (prevVF === undefined) deleteEnv("VERYFRONT_DEBUG");
        else setEnv("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) deleteEnv("LOG_LEVEL");
        else setEnv("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });

    it("defaults to INFO when LOG_LEVEL is invalid", async () => {
      const prevVF = getEnv("VERYFRONT_DEBUG");
      const prevLV = getEnv("LOG_LEVEL");
      const orig = {
        debug: console.debug,
        log: console.log,
        warn: console.warn,
        error: console.error,
      };

      const messages: string[] = [];
      console.debug = (msg: string) => messages.push(msg);
      console.log = (msg: string) => messages.push(msg);
      console.warn = (msg: string) => messages.push(msg);
      console.error = (msg: string) => messages.push(msg);

      try {
        setEnv("LOG_LEVEL", "INVALID");
        deleteEnv("VERYFRONT_DEBUG");
        const mod = await importSharedLogger(`ts=${Date.now()}-invalid`);
        const logger = mod.logger;

        messages.length = 0;
        logger.debug("debug msg");
        logger.info("info msg");

        assertEquals(
          messages.some((m) => m.includes("debug msg")),
          false,
        );
        assertEquals(
          messages.some((m) => m.includes("info msg")),
          true,
        );
      } finally {
        if (prevVF === undefined) deleteEnv("LOG_LEVEL");
        else setEnv("LOG_LEVEL", prevVF);
        if (prevLV === undefined) deleteEnv("VERYFRONT_DEBUG");
        else setEnv("VERYFRONT_DEBUG", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });

    it("enables debug logging when VERYFRONT_DEBUG=1", async () => {
      const prevVF = getEnv("VERYFRONT_DEBUG");
      const prevLV = getEnv("LOG_LEVEL");
      const orig = {
        debug: console.debug,
        log: console.log,
        warn: console.warn,
        error: console.error,
      };

      const messages: string[] = [];
      console.debug = (msg: string) => messages.push(msg);
      console.log = (msg: string) => messages.push(msg);
      console.warn = (msg: string) => messages.push(msg);
      console.error = (msg: string) => messages.push(msg);

      try {
        setEnv("VERYFRONT_DEBUG", "1");
        deleteEnv("LOG_LEVEL");
        const mod = await importSharedLogger(`ts=${Date.now()}-vf1`);
        const logger = mod.logger;

        messages.length = 0;
        logger.debug("debug msg");

        assertEquals(
          messages.some((m) => m.includes("debug msg")),
          true,
        );
      } finally {
        if (prevVF === undefined) deleteEnv("VERYFRONT_DEBUG");
        else setEnv("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) deleteEnv("LOG_LEVEL");
        else setEnv("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });
  });

  describe("Instances", () => {
    it("exports all named logger instances with required methods", async () => {
      const mod = await importSharedLogger(`ts=${Date.now()}-exports`);

      assertExists(mod.cliLogger);
      assertExists(mod.serverLogger);
      assertExists(mod.rendererLogger);
      assertExists(mod.bundlerLogger);
      assertExists(mod.agentLogger);
      assertExists(mod.logger);

      const loggers = [
        mod.cliLogger,
        mod.serverLogger,
        mod.rendererLogger,
        mod.bundlerLogger,
        mod.agentLogger,
        mod.logger,
      ];
      for (const logger of loggers) {
        assertEquals(typeof logger.debug, "function");
        assertEquals(typeof logger.info, "function");
        assertEquals(typeof logger.warn, "function");
        assertEquals(typeof logger.error, "function");
        assertEquals(typeof logger.time, "function");
      }
    });

    it("all logger instances respect LOG_LEVEL=INFO", async () => {
      const prevVF = getEnv("VERYFRONT_DEBUG");
      const prevLV = getEnv("LOG_LEVEL");
      const orig = {
        debug: console.debug,
        log: console.log,
        warn: console.warn,
        error: console.error,
      };
      const counts = { debug: 0, log: 0, warn: 0, error: 0 };
      console.debug = () => {
        counts.debug++;
      };
      console.log = () => {
        counts.log++;
      };
      console.warn = () => {
        counts.warn++;
      };
      console.error = () => {
        counts.error++;
      };
      try {
        setEnv("VERYFRONT_DEBUG", "true");
        setEnv("LOG_LEVEL", "INFO");
        const mod = await importFresh();
        const instances = [
          mod.cliLogger,
          mod.serverLogger,
          mod.rendererLogger,
          mod.bundlerLogger,
          mod.agentLogger,
        ];
        for (const logger of instances) {
          logger.debug("d");
          logger.info("i");
          logger.warn("w");
          logger.error("e");
        }
        assertEquals(counts.debug, 0);
        assertEquals(counts.log >= 5, true);
        assertEquals(counts.warn >= 5, true);
        assertEquals(counts.error >= 5, true);
      } finally {
        if (prevVF === undefined) deleteEnv("VERYFRONT_DEBUG");
        else setEnv("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) deleteEnv("LOG_LEVEL");
        else setEnv("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });

    it("all logger instances respect LOG_LEVEL=DEBUG", async () => {
      const prevVF = getEnv("VERYFRONT_DEBUG");
      const prevLV = getEnv("LOG_LEVEL");
      const orig = {
        debug: console.debug,
        log: console.log,
        warn: console.warn,
        error: console.error,
      };
      const counts = { debug: 0, log: 0, warn: 0, error: 0 };
      console.debug = () => {
        counts.debug++;
      };
      console.log = () => {
        counts.log++;
      };
      console.warn = () => {
        counts.warn++;
      };
      console.error = () => {
        counts.error++;
      };
      try {
        setEnv("VERYFRONT_DEBUG", "true");
        setEnv("LOG_LEVEL", "DEBUG");
        const mod = await importFresh();
        const instances = [
          mod.logger,
          mod.cliLogger,
          mod.serverLogger,
          mod.rendererLogger,
          mod.bundlerLogger,
          mod.agentLogger,
        ];
        for (const logger of instances) {
          logger.debug("d");
          logger.info("i");
          logger.warn("w");
          logger.error("e");
        }
        assertEquals(counts.debug >= 6, true);
        assertEquals(counts.log >= 6, true);
        assertEquals(counts.warn >= 6, true);
        assertEquals(counts.error >= 6, true);
      } finally {
        if (prevVF === undefined) deleteEnv("VERYFRONT_DEBUG");
        else setEnv("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) deleteEnv("LOG_LEVEL");
        else setEnv("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });
  });

  describe("Formatting", () => {
    it("includes message content in log output", async () => {
      const prevVF = getEnv("VERYFRONT_DEBUG");
      const prevLV = getEnv("LOG_LEVEL");
      const orig = { debug: console.debug };
      const messages: string[] = [];
      console.debug = (msg: string) => messages.push(msg);

      try {
        setEnv("VERYFRONT_DEBUG", "true");
        setEnv("LOG_LEVEL", "DEBUG");
        const mod = await importSharedLogger(`ts=${Date.now()}`);
        const logger = mod.logger;

        messages.length = 0;
        logger.debug("test message");

        assertEquals(
          messages.some((m) => m.includes("test message")),
          true,
        );
      } finally {
        if (prevVF === undefined) deleteEnv("VERYFRONT_DEBUG");
        else setEnv("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) deleteEnv("LOG_LEVEL");
        else setEnv("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
      }
    });

    it("includes logger prefix in output", async () => {
      const prevLV = getEnv("LOG_LEVEL");
      const orig = { log: console.log };
      const messages: string[] = [];
      console.log = (msg: string) => messages.push(msg);

      try {
        setEnv("LOG_LEVEL", "INFO");
        const mod = await importSharedLogger(`ts=${Date.now()}-prefix`);

        messages.length = 0;
        mod.cliLogger.info("test");

        assertEquals(
          messages.some((m) => m.includes("CLI") && m.includes("test")),
          true,
        );
      } finally {
        if (prevLV === undefined) deleteEnv("LOG_LEVEL");
        else setEnv("LOG_LEVEL", prevLV);
        console.log = orig.log;
      }
    });
  });

  describe("Time Method", () => {
    it("times operations and logs duration on success", async () => {
      const prevVF = getEnv("VERYFRONT_DEBUG");
      const prevLV = getEnv("LOG_LEVEL");
      const orig = {
        debug: console.debug,
        log: console.log,
        warn: console.warn,
        error: console.error,
      };

      const messages: string[] = [];
      // Capture all args and stringify objects for proper matching
      const capture = (...args: unknown[]) => {
        for (const arg of args) {
          if (typeof arg === "string") {
            messages.push(arg);
          } else if (arg !== null && typeof arg === "object") {
            messages.push(JSON.stringify(arg));
          }
        }
      };
      console.debug = capture;
      console.log = capture;
      console.warn = capture;
      console.error = capture;

      try {
        setEnv("LOG_LEVEL", "DEBUG");
        const mod = await importSharedLogger(`ts=${Date.now()}-time`);
        const logger = mod.logger;

        messages.length = 0;
        const result = await logger.time("test operation", async () => {
          await delay(10);
          return 42;
        });

        assertEquals(result, 42);
        // New format: "test operation completed" with durationMs in context
        assertEquals(
          messages.some((m) => m.includes("test operation completed")),
          true,
        );
        // durationMs is now in context object, which is logged as second arg
        // or included in JSON output - check for durationMs in any message
        assertEquals(
          messages.some((m) => m.includes("durationMs")),
          true,
        );
      } finally {
        if (prevVF === undefined) deleteEnv("VERYFRONT_DEBUG");
        else setEnv("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) deleteEnv("LOG_LEVEL");
        else setEnv("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });

    it("times operations and logs duration on failure", async () => {
      const prevVF = getEnv("VERYFRONT_DEBUG");
      const prevLV = getEnv("LOG_LEVEL");
      const orig = {
        debug: console.debug,
        log: console.log,
        warn: console.warn,
        error: console.error,
      };

      const messages: string[] = [];
      // Capture all args and stringify objects for proper matching
      const capture = (...args: unknown[]) => {
        for (const arg of args) {
          if (typeof arg === "string") {
            messages.push(arg);
          } else if (arg !== null && typeof arg === "object") {
            messages.push(JSON.stringify(arg));
          }
        }
      };
      console.debug = capture;
      console.log = capture;
      console.warn = capture;
      console.error = capture;

      try {
        setEnv("LOG_LEVEL", "ERROR");
        const mod = await importSharedLogger(`ts=${Date.now()}-time-error`);
        const logger = mod.logger;

        messages.length = 0;

        await assertRejects(
          async () => {
            await logger.time("failing operation", async () => {
              await delay(10);
              throw new Error("Test error");
            });
          },
          Error,
          "Test error",
        );

        // New format: "failing operation failed" with durationMs in context
        assertEquals(
          messages.some((m) => m.includes("failing operation failed")),
          true,
        );
        // durationMs is now in context object
        assertEquals(
          messages.some((m) => m.includes("durationMs")),
          true,
        );
      } finally {
        if (prevVF === undefined) deleteEnv("VERYFRONT_DEBUG");
        else setEnv("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) deleteEnv("LOG_LEVEL");
        else setEnv("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });
  });

  describe("Environment Configuration", () => {
    it("creates logger instances with various environment configurations", async () => {
      const prevVF = getEnv("VERYFRONT_DEBUG");
      const prevLV = getEnv("LOG_LEVEL");

      try {
        setEnv("LOG_LEVEL", "DEBUG");
        deleteEnv("VERYFRONT_DEBUG");
        let mod = await importSharedLogger(`t=debug-${Date.now()}`);
        assertExists(mod.logger);

        setEnv("LOG_LEVEL", "WARN");
        mod = await importSharedLogger(`t=warn-${Date.now()}`);
        assertExists(mod.logger);

        setEnv("LOG_LEVEL", "ERROR");
        mod = await importSharedLogger(`t=error-${Date.now()}`);
        assertExists(mod.logger);

        setEnv("LOG_LEVEL", "INFO");
        mod = await importSharedLogger(`t=info-${Date.now()}`);
        assertExists(mod.logger);

        deleteEnv("LOG_LEVEL");
        setEnv("VERYFRONT_DEBUG", "true");
        mod = await importSharedLogger(`t=vftrue-${Date.now()}`);
        assertExists(mod.logger);

        deleteEnv("LOG_LEVEL");
        deleteEnv("VERYFRONT_DEBUG");
        mod = await importSharedLogger(`t=default-${Date.now()}`);
        assertExists(mod.logger);
      } finally {
        if (prevVF === undefined) deleteEnv("VERYFRONT_DEBUG");
        else setEnv("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) deleteEnv("LOG_LEVEL");
        else setEnv("LOG_LEVEL", prevLV);
      }
    });
  });
});