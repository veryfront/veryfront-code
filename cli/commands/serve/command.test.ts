import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { serveCommand } from "./command.ts";
import type { ServeOptions } from "./command.ts";

type RunWithStartupErrorReporting = <T>(
  startup: () => Promise<T>,
  reporter: {
    captureApplicationError: (
      error: unknown,
      context: { boundary: string },
    ) => string | undefined;
    flushApplicationErrors: (timeoutMs?: number) => Promise<boolean>;
    onReportingError?: (
      operation: "capture" | "flush",
      error: unknown,
    ) => void;
  },
) => Promise<T>;

type RunProductionStartupWithErrorReporting = <T>(
  startup: () => Promise<T>,
  reporter: Parameters<RunWithStartupErrorReporting>[1],
  ensureBundlerContracts: () => Promise<void>,
) => Promise<T>;

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

  it("captures, flushes, and rethrows production startup failures exactly once", async () => {
    const commandModule = await import("./command.ts") as {
      runWithStartupErrorReporting?: RunWithStartupErrorReporting;
    };
    const runWithStartupErrorReporting = commandModule.runWithStartupErrorReporting;
    assertExists(runWithStartupErrorReporting);

    const startupError = new Error("startup failed");
    const captures: Array<{ error: unknown; boundary: string }> = [];
    const flushTimeouts: Array<number | undefined> = [];

    const thrown = await assertRejects(() =>
      runWithStartupErrorReporting(
        () => Promise.reject(startupError),
        {
          captureApplicationError: (error, context) => {
            captures.push({ error, boundary: context.boundary });
            return "event-id";
          },
          flushApplicationErrors: (timeoutMs) => {
            flushTimeouts.push(timeoutMs);
            return Promise.resolve(true);
          },
        },
      )
    );

    assertStrictEquals(thrown, startupError);
    assertEquals(captures, [{
      error: startupError,
      boundary: "process.startup",
    }]);
    assertEquals(flushTimeouts, [2_000]);
  });

  it("preserves the startup failure when flushing the reporter fails", async () => {
    const commandModule = await import("./command.ts") as {
      runWithStartupErrorReporting?: RunWithStartupErrorReporting;
    };
    const runWithStartupErrorReporting = commandModule.runWithStartupErrorReporting;
    assertExists(runWithStartupErrorReporting);

    const startupError = new Error("startup failed");
    const flushError = new Error("flush failed");

    const thrown = await assertRejects(() =>
      runWithStartupErrorReporting(
        () => Promise.reject(startupError),
        {
          captureApplicationError: () => "event-id",
          flushApplicationErrors: () => Promise.reject(flushError),
        },
      )
    );

    assertStrictEquals(thrown, startupError);
  });

  it("captures bundler contract failures before production startup", async () => {
    const commandModule = await import("./command.ts") as {
      runProductionStartupWithErrorReporting?: RunProductionStartupWithErrorReporting;
    };
    const runProductionStartupWithErrorReporting =
      commandModule.runProductionStartupWithErrorReporting;
    assertExists(runProductionStartupWithErrorReporting);

    const bundlerError = new Error("bundler contracts failed");
    const captures: Array<{ error: unknown; boundary: string }> = [];
    let startupCalled = false;

    const thrown = await assertRejects(() =>
      runProductionStartupWithErrorReporting(
        () => {
          startupCalled = true;
          return Promise.resolve();
        },
        {
          captureApplicationError: (error, context) => {
            captures.push({ error, boundary: context.boundary });
            return "event-id";
          },
          flushApplicationErrors: () => Promise.resolve(true),
        },
        () => Promise.reject(bundlerError),
      )
    );

    assertStrictEquals(thrown, bundlerError);
    assertEquals(startupCalled, false);
    assertEquals(captures, [{
      error: bundlerError,
      boundary: "process.startup",
    }]);
  });

  it("reports reporter failures without replacing the startup failure", async () => {
    const commandModule = await import("./command.ts") as {
      runWithStartupErrorReporting?: RunWithStartupErrorReporting;
    };
    const runWithStartupErrorReporting = commandModule.runWithStartupErrorReporting;
    assertExists(runWithStartupErrorReporting);

    const startupError = new Error("startup failed");
    const captureError = new Error("capture failed");
    const flushError = new Error("flush failed");
    const reporterFailures: Array<{
      operation: "capture" | "flush";
      error: unknown;
    }> = [];

    const thrown = await assertRejects(() =>
      runWithStartupErrorReporting(
        () => Promise.reject(startupError),
        {
          captureApplicationError: () => {
            throw captureError;
          },
          flushApplicationErrors: () => Promise.reject(flushError),
          onReportingError: (operation, error) => {
            reporterFailures.push({ operation, error });
          },
        },
      )
    );

    assertStrictEquals(thrown, startupError);
    assertEquals(reporterFailures, [
      { operation: "capture", error: captureError },
      { operation: "flush", error: flushError },
    ]);
  });
});
