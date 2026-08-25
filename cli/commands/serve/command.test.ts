import "#veryfront/schemas/_test-setup.ts";
import { FakeTime } from "#std/testing/time";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { setJsonMode } from "../../shared/json-output.ts";
import { printServeReady, serveCommand, serveReadyUrl } from "./command.ts";
import type { ServeOptions } from "./command.ts";

function captureStdout(run: () => void): string {
  const originalLog = console.log;
  const lines: string[] = [];
  console.log = (...args: unknown[]) => lines.push(args.join(" "));
  try {
    run();
  } finally {
    console.log = originalLog;
  }
  return lines.join("\n");
}

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
  options?: { flushTimeoutMs?: number },
) => Promise<T>;

type RunProductionStartupWithErrorReporting = <T>(
  startup: () => Promise<T>,
  reporter: Parameters<RunWithStartupErrorReporting>[1],
  ensureBundlerContracts: () => Promise<void>,
  initializeObservability?: () => Promise<unknown>,
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
    assertEquals(flushTimeouts.length, 1);
    assertEquals((flushTimeouts[0] ?? Infinity) <= 2_000, true);
    assertEquals((flushTimeouts[0] ?? 0) > 0, true);
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

  it("preserves the startup failure when the reporting callback throws", async () => {
    const commandModule = await import("./command.ts") as {
      runWithStartupErrorReporting?: RunWithStartupErrorReporting;
    };
    const runWithStartupErrorReporting = commandModule.runWithStartupErrorReporting;
    assertExists(runWithStartupErrorReporting);

    const startupError = new Error("startup failed");
    const callbackError = new Error("diagnostic callback failed");

    const thrown = await assertRejects(() =>
      runWithStartupErrorReporting(
        () => Promise.reject(startupError),
        {
          captureApplicationError: () => {
            throw new Error("capture failed");
          },
          flushApplicationErrors: () => Promise.reject(new Error("flush failed")),
          onReportingError: () => {
            throw callbackError;
          },
        },
      )
    );

    assertStrictEquals(thrown, startupError);
  });

  it("bounds reporter flush by wall-clock timeout", async () => {
    using time = new FakeTime();
    const commandModule = await import("./command.ts") as {
      runWithStartupErrorReporting?: RunWithStartupErrorReporting;
    };
    const runWithStartupErrorReporting = commandModule.runWithStartupErrorReporting;
    assertExists(runWithStartupErrorReporting);

    const startupError = new Error("startup failed");
    const result = runWithStartupErrorReporting(
      () => Promise.reject(startupError),
      {
        captureApplicationError: () => "event-id",
        flushApplicationErrors: () => new Promise<boolean>(() => {}),
      },
      { flushTimeoutMs: 2_000 },
    ).then(
      (value: never) => ({ value }),
      (error: unknown) => ({ error }),
    );

    let settled = false;
    void result.then(() => settled = true);
    await time.tickAsync(1_999);
    assertEquals(settled, false);

    await time.tickAsync(1);
    const outcome = await result;
    assertEquals("value" in outcome, false);
    if ("error" in outcome) assertStrictEquals(outcome.error, startupError);
  });

  it("absorbs a flush rejection that arrives after the deadline", async () => {
    using time = new FakeTime();
    const commandModule = await import("./command.ts") as {
      runWithStartupErrorReporting?: RunWithStartupErrorReporting;
    };
    const runWithStartupErrorReporting = commandModule.runWithStartupErrorReporting;
    assertExists(runWithStartupErrorReporting);

    const startupError = new Error("startup failed");
    const flushError = new Error("flush failed late");
    let rejectFlush!: (error: unknown) => void;
    const reportingErrors: unknown[] = [];
    const flush = new Promise<boolean>((_resolve, reject) => rejectFlush = reject);

    const result = runWithStartupErrorReporting(
      () => Promise.reject(startupError),
      {
        captureApplicationError: () => "event-id",
        flushApplicationErrors: () => flush,
        onReportingError: (_operation: "capture" | "flush", error: unknown) => {
          reportingErrors.push(error);
        },
      },
      { flushTimeoutMs: 25 },
    ).then(
      (value: never) => ({ value }),
      (error: unknown) => ({ error }),
    );

    await time.tickAsync(25);
    const outcome = await result;
    assertEquals("value" in outcome, false);
    if ("error" in outcome) assertStrictEquals(outcome.error, startupError);

    rejectFlush(flushError);
    await time.tickAsync(0);
    assertEquals(reportingErrors, [flushError]);
  });

  it("captures Sentry bootstrap failures before production startup", async () => {
    const commandModule = await import("./command.ts") as {
      runProductionStartupWithErrorReporting?: RunProductionStartupWithErrorReporting;
    };
    const runProductionStartupWithErrorReporting =
      commandModule.runProductionStartupWithErrorReporting;
    assertExists(runProductionStartupWithErrorReporting);

    const bootstrapError = new Error("Sentry bootstrap failed");
    const captures: Array<{ error: unknown; boundary: string }> = [];
    let bundlerContractsChecked = false;
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
        () => {
          bundlerContractsChecked = true;
          return Promise.resolve();
        },
        () => Promise.reject(bootstrapError),
      )
    );

    assertStrictEquals(thrown, bootstrapError);
    assertEquals(bundlerContractsChecked, false);
    assertEquals(startupCalled, false);
    assertEquals(captures, [{
      error: bootstrapError,
      boundary: "process.startup",
    }]);
  });

  it("keeps Sentry bootstrap inside the real production server boundary", async () => {
    const commandModule = await import("./command.ts") as {
      runProductionServer?: (
        options: ServeOptions,
        dependencies: {
          ensureBundlerContracts: () => Promise<void>;
          initializeErrorReporting: () => Promise<unknown>;
          loadSentryModule?: () => Promise<unknown>;
          reporter: Parameters<RunWithStartupErrorReporting>[1];
        },
      ) => Promise<void>;
    };
    const runProductionServer = commandModule.runProductionServer;
    assertExists(runProductionServer);

    const bootstrapError = new Error("Sentry bootstrap failed");
    const captures: Array<{ error: unknown; boundary: string }> = [];
    const flushTimeouts: Array<number | undefined> = [];
    let bundlerCalled = false;

    const thrown = await assertRejects(() =>
      runProductionServer(
        {
          mode: "production",
          port: 3000,
          bindAddress: "127.0.0.1",
          splitMode: false,
          useBinary: false,
          binaryPath: "./bin/veryfront",
          debug: false,
        },
        {
          initializeErrorReporting: () => Promise.reject(bootstrapError),
          ensureBundlerContracts: () => {
            bundlerCalled = true;
            return Promise.resolve();
          },
          reporter: {
            captureApplicationError: (error, context) => {
              captures.push({ error, boundary: context.boundary });
              return "event-id";
            },
            flushApplicationErrors: (timeoutMs) => {
              flushTimeouts.push(timeoutMs);
              return Promise.resolve(true);
            },
          },
        },
      )
    );

    assertStrictEquals(thrown, bootstrapError);
    assertEquals(bundlerCalled, false);
    assertEquals(captures, [{
      error: bootstrapError,
      boundary: "process.startup",
    }]);
    assertEquals(flushTimeouts.length, 1);
    assertEquals((flushTimeouts[0] ?? Infinity) <= 2_000, true);
    assertEquals((flushTimeouts[0] ?? 0) > 0, true);
  });

  it("keeps Sentry module loading inside the real production server boundary", async () => {
    const commandModule = await import("./command.ts") as {
      runProductionServer?: (
        options: ServeOptions,
        dependencies: {
          ensureBundlerContracts: () => Promise<void>;
          loadSentryModule: () => Promise<never>;
          reporter: Parameters<RunWithStartupErrorReporting>[1];
        },
      ) => Promise<void>;
    };
    const runProductionServer = commandModule.runProductionServer;
    assertExists(runProductionServer);

    const loadError = new Error("Sentry module failed to load");
    const captures: Array<{ error: unknown; boundary: string }> = [];
    const flushTimeouts: Array<number | undefined> = [];
    let bundlerCalled = false;

    const thrown = await assertRejects(() =>
      runProductionServer(
        {
          mode: "production",
          port: 3000,
          bindAddress: "127.0.0.1",
          splitMode: false,
          useBinary: false,
          binaryPath: "./bin/veryfront",
          debug: false,
        },
        {
          loadSentryModule: () => Promise.reject(loadError),
          ensureBundlerContracts: () => {
            bundlerCalled = true;
            return Promise.reject(new Error("bundler should not run"));
          },
          reporter: {
            captureApplicationError: (error, context) => {
              captures.push({ error, boundary: context.boundary });
              return "event-id";
            },
            flushApplicationErrors: (timeoutMs) => {
              flushTimeouts.push(timeoutMs);
              return Promise.resolve(true);
            },
          },
        },
      )
    );

    assertStrictEquals(thrown, loadError);
    assertEquals(bundlerCalled, false);
    assertEquals(captures, [{
      error: loadError,
      boundary: "process.startup",
    }]);
    assertEquals(flushTimeouts.length, 1);
    assertEquals((flushTimeouts[0] ?? Infinity) <= 2_000, true);
    assertEquals((flushTimeouts[0] ?? 0) > 0, true);
  });

  it("preserves default reporter acquisition failures without remote capture", async () => {
    const commandModule = await import("./command.ts") as {
      runProductionServer?: (
        options: ServeOptions,
        dependencies: {
          ensureBundlerContracts: () => Promise<void>;
          loadSentryModule: () => Promise<never>;
        },
      ) => Promise<void>;
    };
    const runProductionServer = commandModule.runProductionServer;
    assertExists(runProductionServer);

    const loadError = new Error("Sentry module failed to load");
    let bundlerCalled = false;
    const result = runProductionServer(
      {
        mode: "production",
        port: 3000,
        bindAddress: "127.0.0.1",
        splitMode: false,
        useBinary: false,
        binaryPath: "./bin/veryfront",
        debug: false,
      },
      {
        loadSentryModule: () => Promise.reject(loadError),
        ensureBundlerContracts: () => {
          bundlerCalled = true;
          return Promise.resolve();
        },
      },
    ).then(
      (value: void) => ({ value }),
      (error: unknown) => ({ error }),
    );

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<{ timedOut: true }>((resolve) => {
      timeoutId = setTimeout(() => resolve({ timedOut: true }), 250);
    });
    const outcome = await Promise.race([result, timeout]);
    if (timeoutId !== undefined) clearTimeout(timeoutId);

    assertEquals("timedOut" in outcome, false);
    assertEquals("value" in outcome, false);
    if ("error" in outcome) assertStrictEquals(outcome.error, loadError);
    assertEquals(bundlerCalled, false);
  });

  for (const mode of ["production", "combined"] as const) {
    it(`routes ${mode} mode through the production server boundary`, async () => {
      const calls: ServeOptions[] = [];
      const options: ServeOptions = {
        mode,
        port: 3000,
        bindAddress: "127.0.0.1",
        splitMode: false,
        useBinary: false,
        binaryPath: "./bin/veryfront",
        debug: false,
      };

      await serveCommand(options, {
        runProductionServer: (received) => {
          calls.push(received);
          return Promise.resolve();
        },
      });

      assertEquals(calls, [options]);
    });
  }

  describe("serveReadyUrl", () => {
    it("renders the wildcard bind address as a browsable localhost URL", () => {
      assertEquals(serveReadyUrl("0.0.0.0", 3000), "http://localhost:3000");
    });

    it("renders the IPv6 wildcard bind address as a browsable localhost URL", () => {
      assertEquals(serveReadyUrl("::", 3000), "http://localhost:3000");
    });

    it("keeps an explicit bind address", () => {
      assertEquals(serveReadyUrl("127.0.0.1", 8080), "http://127.0.0.1:8080");
    });

    it("brackets explicit IPv6 bind addresses", () => {
      assertEquals(serveReadyUrl("::1", 8080), "http://[::1]:8080");
    });

    it("keeps an already bracketed IPv6 bind address bracketed exactly once", () => {
      assertEquals(serveReadyUrl("[::1]", 8080), "http://[::1]:8080");
    });
  });

  describe("printServeReady", () => {
    it("prints the URL the deploy docs tell developers to open", () => {
      const output = captureStdout(() => printServeReady({ port: 3000, bindAddress: "0.0.0.0" }));
      assertStringIncludes(output, "http://localhost:3000");
    });

    it("stays silent when an ephemeral port was requested", () => {
      const output = captureStdout(() => printServeReady({ port: 0, bindAddress: "0.0.0.0" }));
      assertEquals(output.trim(), "");
    });

    it("stays silent in JSON mode", () => {
      setJsonMode(true);
      try {
        const output = captureStdout(() => printServeReady({ port: 3000, bindAddress: "0.0.0.0" }));
        assertEquals(output.trim(), "");
      } finally {
        setJsonMode(false);
      }
    });
  });
});
