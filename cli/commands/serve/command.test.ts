import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createCliProductionShutdownHandler, serveCommand } from "./command.ts";
import type { ServeOptions } from "./command.ts";

describe("commands/serve/command", () => {
  describe("serveCommand", () => {
    it("is exported as a function", () => {
      assertExists(serveCommand);
      assertEquals(typeof serveCommand, "function");
    });

    it("is an async function", () => {
      assertEquals(serveCommand.constructor.name, "AsyncFunction");
    });

    it("accepts a single ServeOptions parameter", () => {
      assertEquals(serveCommand.length, 1);
    });
  });

  describe("ServeOptions interface", () => {
    it("supports production mode", () => {
      const options: ServeOptions = {
        mode: "production",
        port: 3000,
        bindAddress: "0.0.0.0",
        splitMode: false,
        useBinary: false,
        binaryPath: "./bin/veryfront",
        debug: false,
      };
      assertEquals(options.mode, "production");
    });

    it("supports proxy mode", () => {
      const options: ServeOptions = {
        mode: "proxy",
        port: 8080,
        bindAddress: "0.0.0.0",
        splitMode: false,
        useBinary: false,
        binaryPath: "./bin/veryfront",
        debug: false,
      };
      assertEquals(options.mode, "proxy");
    });

    it("supports combined mode", () => {
      const options: ServeOptions = {
        mode: "combined",
        port: 3000,
        bindAddress: "0.0.0.0",
        splitMode: false,
        useBinary: false,
        binaryPath: "./bin/veryfront",
        debug: false,
      };
      assertEquals(options.mode, "combined");
    });

    it("supports split mode configuration", () => {
      const options: ServeOptions = {
        mode: "production",
        port: 3000,
        bindAddress: "0.0.0.0",
        splitMode: true,
        useBinary: true,
        binaryPath: "/usr/local/bin/veryfront",
        debug: false,
      };
      assertEquals(options.splitMode, true);
      assertEquals(options.useBinary, true);
      assertEquals(options.binaryPath, "/usr/local/bin/veryfront");
    });

    it("supports debug flag", () => {
      const options: ServeOptions = {
        mode: "production",
        port: 3000,
        bindAddress: "0.0.0.0",
        splitMode: false,
        useBinary: false,
        binaryPath: "./bin/veryfront",
        debug: true,
      };
      assertEquals(options.debug, true);
    });

    it("supports custom bind address", () => {
      const options: ServeOptions = {
        mode: "production",
        port: 3000,
        bindAddress: "127.0.0.1",
        splitMode: false,
        useBinary: false,
        binaryPath: "./bin/veryfront",
        debug: false,
      };
      assertEquals(options.bindAddress, "127.0.0.1");
    });

    it("includes all required fields", () => {
      const options: ServeOptions = {
        mode: "production",
        port: 3000,
        bindAddress: "0.0.0.0",
        splitMode: false,
        useBinary: false,
        binaryPath: "./bin/veryfront",
        debug: false,
      };
      assertEquals(Object.keys(options).length, 7);
    });
  });

  describe("createCliProductionShutdownHandler", () => {
    it("exits zero after one shared successful shutdown", async () => {
      const exits: number[] = [];
      let shutdownCalls = 0;
      let flushCalls = 0;
      const shutdown = createCliProductionShutdownHandler({
        performShutdown: () => {
          shutdownCalls++;
          return Promise.resolve();
        },
        captureApplicationError: () => {},
        flushApplicationErrors: () => {
          flushCalls++;
          return Promise.resolve();
        },
        exitProcess: (code) => exits.push(code),
        logger: { warn: () => {} },
      });

      const first = shutdown("SIGTERM");
      assertStrictEquals(shutdown("SIGINT"), first);
      await first;

      assertEquals(shutdownCalls, 1);
      assertEquals(flushCalls, 1);
      assertEquals(exits, [0]);
    });

    it("reports incomplete shutdown and exits one", async () => {
      const shutdownError = new AggregateError(
        [new Error("listener live")],
        "cleanup incomplete",
      );
      const captured: Array<{ error: unknown; context: { boundary: string } }> = [];
      const warnings: unknown[][] = [];
      const exits: number[] = [];
      const shutdown = createCliProductionShutdownHandler({
        performShutdown: () => Promise.reject(shutdownError),
        captureApplicationError: (error, context) => captured.push({ error, context }),
        flushApplicationErrors: () => Promise.resolve(),
        exitProcess: (code) => exits.push(code),
        logger: { warn: (...args) => warnings.push(args) },
      });

      await shutdown("SIGTERM");

      assertEquals(captured.length, 1);
      assertStrictEquals(captured[0]?.error, shutdownError);
      assertEquals(captured[0]?.context, { boundary: "process.shutdown" });
      assertEquals(warnings.length, 1);
      assertEquals(exits, [1]);
    });

    it("reports an incomplete diagnostics flush and exits one", async () => {
      const captured: Array<{ error: unknown; context: { boundary: string } }> = [];
      const warnings: unknown[][] = [];
      const exits: number[] = [];
      const shutdown = createCliProductionShutdownHandler({
        performShutdown: () => Promise.resolve(),
        captureApplicationError: (error, context) => captured.push({ error, context }),
        flushApplicationErrors: () => Promise.resolve(false),
        exitProcess: (code) => exits.push(code),
        logger: { warn: (...args) => warnings.push(args) },
      });

      await shutdown("SIGTERM");

      assertEquals(captured.length, 1);
      assertEquals(captured[0]?.context, { boundary: "process.shutdown.flush" });
      assertEquals(
        captured[0]?.error instanceof Error && captured[0].error.message,
        "Application error diagnostics did not flush completely",
      );
      assertEquals(warnings.length, 1);
      assertEquals(exits, [1]);
    });
  });
});
