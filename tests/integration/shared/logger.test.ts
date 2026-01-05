import { assertEquals, assertRejects } from "std/assert/mod.ts";
import { describe } from "std/testing/bdd.ts";
import { __loggerResetForTests, LogLevel } from "@veryfront/utils/logger/index.ts";

async function importFresh() {
  const mod = await import(`@veryfront/utils/logger/index.ts?ts=${Date.now()}&r=${Math.random()}`);
  __loggerResetForTests();
  return mod;
}

async function importSharedLogger(query: string) {
  const mod = await import(`@veryfront/utils/logger/index.ts?${query}`);
  __loggerResetForTests();
  return mod;
}

function assertExists(value: unknown): asserts value is NonNullable<unknown> {
  if (value === null || value === undefined) {
    throw new Error("Expected value to exist");
  }
}

describe("Logger", () => {
  describe("Log Levels", () => {
    Deno.test(
      {
        name: "LogLevel enum has correct values",
        sanitizeResources: false,
        sanitizeOps: false,
      },
      () => {
        assertEquals(LogLevel.DEBUG, 0);
        assertEquals(LogLevel.INFO, 1);
        assertEquals(LogLevel.WARN, 2);
        assertEquals(LogLevel.ERROR, 3);
      },
    );

    Deno.test("logger test", async () => {
      const prevVF = Deno.env.get("VERYFRONT_DEBUG");
      const prevLV = Deno.env.get("LOG_LEVEL");
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
        Deno.env.set("LOG_LEVEL", "DEBUG");
        Deno.env.delete("VERYFRONT_DEBUG");
        const mod = await importSharedLogger(`ts=${Date.now()}`);
        const logger = mod.logger;

        messages.length = 0;
        logger.debug("debug msg");
        logger.info("info msg");
        logger.warn("warn msg");
        logger.error("error msg");

        assertEquals(
          messages.some((m) => m.includes("DEBUG: debug msg")),
          true,
        );
        assertEquals(
          messages.some((m) => m.includes("info msg")),
          true,
        );
        assertEquals(
          messages.some((m) => m.includes("WARN: warn msg")),
          true,
        );
        assertEquals(
          messages.some((m) => m.includes("ERROR: error msg")),
          true,
        );
      } finally {
        if (prevVF === undefined) Deno.env.delete("VERYFRONT_DEBUG");
        else Deno.env.set("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });

    Deno.test("logger test", async () => {
      const prevVF = Deno.env.get("VERYFRONT_DEBUG");
      const prevLV = Deno.env.get("LOG_LEVEL");
      const original = { debug: console.debug, log: console.log };
      const counts = { debug: 0, log: 0 };
      console.debug = () => {
        counts.debug++;
      };
      console.log = () => {
        counts.log++;
      };
      try {
        Deno.env.set("VERYFRONT_DEBUG", "true");
        Deno.env.set("LOG_LEVEL", "INFO");
        const { logger } = await importFresh();
        logger.debug("d");
        logger.info("i");
        assertEquals(counts.debug, 0);
        assertEquals(counts.log >= 1, true);
      } finally {
        if (prevVF === undefined) Deno.env.delete("VERYFRONT_DEBUG");
        else Deno.env.set("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", prevLV);
        console.debug = original.debug;
        console.log = original.log;
      }
    });

    Deno.test("logger test", async () => {
      const prevVF = Deno.env.get("VERYFRONT_DEBUG");
      const prevLV = Deno.env.get("LOG_LEVEL");
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
        Deno.env.set("LOG_LEVEL", "WARN");
        Deno.env.delete("VERYFRONT_DEBUG");
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
          messages.some((m) => m.includes("WARN: warn msg")),
          true,
        );
        assertEquals(
          messages.some((m) => m.includes("ERROR: error msg")),
          true,
        );
      } finally {
        if (prevVF === undefined) Deno.env.delete("VERYFRONT_DEBUG");
        else Deno.env.set("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });

    Deno.test("logger test", async () => {
      const prevVF = Deno.env.get("VERYFRONT_DEBUG");
      const prevLV = Deno.env.get("LOG_LEVEL");
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
        Deno.env.set("VERYFRONT_DEBUG", "0");
        Deno.env.set("LOG_LEVEL", "ERROR");
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
        if (prevVF === undefined) Deno.env.delete("VERYFRONT_DEBUG");
        else Deno.env.set("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });

    Deno.test("logger test", async () => {
      const prevVF = Deno.env.get("VERYFRONT_DEBUG");
      const prevLV = Deno.env.get("LOG_LEVEL");
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
        Deno.env.set("LOG_LEVEL", "INVALID");
        Deno.env.delete("VERYFRONT_DEBUG");
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
        if (prevVF === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", prevVF);
        if (prevLV === undefined) Deno.env.delete("VERYFRONT_DEBUG");
        else Deno.env.set("VERYFRONT_DEBUG", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });

    Deno.test("logger test", async () => {
      const prevVF = Deno.env.get("VERYFRONT_DEBUG");
      const prevLV = Deno.env.get("LOG_LEVEL");
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
        Deno.env.set("VERYFRONT_DEBUG", "1");
        Deno.env.delete("LOG_LEVEL");
        const mod = await importSharedLogger(`ts=${Date.now()}-vf1`);
        const logger = mod.logger;

        messages.length = 0;
        logger.debug("debug msg");

        assertEquals(
          messages.some((m) => m.includes("DEBUG: debug msg")),
          true,
        );
      } finally {
        if (prevVF === undefined) Deno.env.delete("VERYFRONT_DEBUG");
        else Deno.env.set("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });
  });

  describe("Instances", () => {
    Deno.test("logger test", async () => {
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

    Deno.test("logger test", async () => {
      const prevVF = Deno.env.get("VERYFRONT_DEBUG");
      const prevLV = Deno.env.get("LOG_LEVEL");
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
        Deno.env.set("VERYFRONT_DEBUG", "true");
        Deno.env.set("LOG_LEVEL", "INFO");
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
        if (prevVF === undefined) Deno.env.delete("VERYFRONT_DEBUG");
        else Deno.env.set("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });

    Deno.test("logger test", async () => {
      const prevVF = Deno.env.get("VERYFRONT_DEBUG");
      const prevLV = Deno.env.get("LOG_LEVEL");
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
        Deno.env.set("VERYFRONT_DEBUG", "true");
        Deno.env.set("LOG_LEVEL", "DEBUG");
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
        if (prevVF === undefined) Deno.env.delete("VERYFRONT_DEBUG");
        else Deno.env.set("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });
  });

  describe("Formatting", () => {
    Deno.test("logger test", async () => {
      const prevVF = Deno.env.get("VERYFRONT_DEBUG");
      const prevLV = Deno.env.get("LOG_LEVEL");
      const orig = { debug: console.debug };
      const messages: string[] = [];
      console.debug = (msg: string) => messages.push(msg);

      try {
        Deno.env.set("VERYFRONT_DEBUG", "true");
        Deno.env.set("LOG_LEVEL", "DEBUG");
        const mod = await importSharedLogger(`ts=${Date.now()}`);
        const logger = mod.logger;

        messages.length = 0;
        logger.debug("test message");

        assertEquals(
          messages.some((m) => m.includes("DEBUG:")),
          true,
        );
      } finally {
        if (prevVF === undefined) Deno.env.delete("VERYFRONT_DEBUG");
        else Deno.env.set("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
      }
    });

    Deno.test("logger test", async () => {
      const prevLV = Deno.env.get("LOG_LEVEL");
      const orig = { log: console.log };
      const messages: string[] = [];
      console.log = (msg: string) => messages.push(msg);

      try {
        Deno.env.set("LOG_LEVEL", "INFO");
        const mod = await importSharedLogger(`ts=${Date.now()}-prefix`);

        messages.length = 0;
        mod.cliLogger.info("test");

        assertEquals(
          messages.some((m) => m.includes("[CLI]")),
          true,
        );
      } finally {
        if (prevLV === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", prevLV);
        console.log = orig.log;
      }
    });
  });

  describe("Time Method", () => {
    Deno.test("logger test", async () => {
      const prevVF = Deno.env.get("VERYFRONT_DEBUG");
      const prevLV = Deno.env.get("LOG_LEVEL");
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
        Deno.env.set("LOG_LEVEL", "DEBUG");
        const mod = await importSharedLogger(`ts=${Date.now()}-time`);
        const logger = mod.logger;

        messages.length = 0;
        const result = await logger.time("test operation", async () => {
          await new Promise((r) => setTimeout(r, 10));
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
        if (prevVF === undefined) Deno.env.delete("VERYFRONT_DEBUG");
        else Deno.env.set("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });

    Deno.test("logger test", async () => {
      const prevVF = Deno.env.get("VERYFRONT_DEBUG");
      const prevLV = Deno.env.get("LOG_LEVEL");
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
        Deno.env.set("LOG_LEVEL", "ERROR");
        const mod = await importSharedLogger(`ts=${Date.now()}-time-error`);
        const logger = mod.logger;

        messages.length = 0;

        await assertRejects(
          async () => {
            await logger.time("failing operation", async () => {
              await new Promise((r) => setTimeout(r, 10));
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
        if (prevVF === undefined) Deno.env.delete("VERYFRONT_DEBUG");
        else Deno.env.set("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", prevLV);
        console.debug = orig.debug;
        console.log = orig.log;
        console.warn = orig.warn;
        console.error = orig.error;
      }
    });
  });

  describe("Environment Configuration", () => {
    Deno.test("logger test", async () => {
      const prevVF = Deno.env.get("VERYFRONT_DEBUG");
      const prevLV = Deno.env.get("LOG_LEVEL");

      try {
        Deno.env.set("LOG_LEVEL", "DEBUG");
        Deno.env.delete("VERYFRONT_DEBUG");
        let mod = await importSharedLogger(`t=debug-${Date.now()}`);
        assertExists(mod.logger);

        Deno.env.set("LOG_LEVEL", "WARN");
        mod = await importSharedLogger(`t=warn-${Date.now()}`);
        assertExists(mod.logger);

        Deno.env.set("LOG_LEVEL", "ERROR");
        mod = await importSharedLogger(`t=error-${Date.now()}`);
        assertExists(mod.logger);

        Deno.env.set("LOG_LEVEL", "INFO");
        mod = await importSharedLogger(`t=info-${Date.now()}`);
        assertExists(mod.logger);

        Deno.env.delete("LOG_LEVEL");
        Deno.env.set("VERYFRONT_DEBUG", "true");
        mod = await importSharedLogger(`t=vftrue-${Date.now()}`);
        assertExists(mod.logger);

        Deno.env.delete("LOG_LEVEL");
        Deno.env.delete("VERYFRONT_DEBUG");
        mod = await importSharedLogger(`t=default-${Date.now()}`);
        assertExists(mod.logger);
      } finally {
        if (prevVF === undefined) Deno.env.delete("VERYFRONT_DEBUG");
        else Deno.env.set("VERYFRONT_DEBUG", prevVF);
        if (prevLV === undefined) Deno.env.delete("LOG_LEVEL");
        else Deno.env.set("LOG_LEVEL", prevLV);
      }
    });
  });
});
