import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { BootstrapResult } from "./bootstrap.ts";
import { runDirectProductionServer } from "./production-server.ts";

describe("direct production server owner", () => {
  it("handles a signal while startup initialization is still pending", async () => {
    const events: string[] = [];
    let signalHandler: ((signal: "SIGINT" | "SIGTERM") => void | Promise<void>) | undefined;

    await runDirectProductionServer({
      initializeErrorReporting: () => {
        events.push("initialize");
        return new Promise<void>(() => {});
      },
      registerSignals: (handler) => {
        events.push("signals");
        signalHandler = handler;
        queueMicrotask(() => handler("SIGTERM"));
        return () => events.push("dispose-signals");
      },
      gracefullyShutdown: (options) => {
        events.push(`shutdown:${options.signal}`);
        options.abort();
        return Promise.resolve(true);
      },
      flush: () => {
        events.push("flush");
        return Promise.resolve();
      },
      captureError: () => events.push("error"),
      exit: (code) => events.push(`exit:${code}`),
    });

    await signalHandler?.("SIGINT");
    assertEquals(events, [
      "signals",
      "initialize",
      "shutdown:SIGTERM",
      "flush",
      "exit:0",
      "dispose-signals",
    ]);
  });

  it("owns initialized bootstrap and server resources through signal shutdown", async () => {
    const events: string[] = [];
    let signalHandler: ((signal: "SIGINT" | "SIGTERM") => void | Promise<void>) | undefined;
    const adapter = createMockAdapter();
    adapter.env.set?.("PORT", "4321");
    adapter.env.set?.("BIND_ADDRESS", "127.0.0.1");
    adapter.env.set?.("SHUTDOWN_DRAIN_TIMEOUT_MS", "1234");

    await runDirectProductionServer({
      initializeErrorReporting: () => {
        events.push("reporting");
        return Promise.resolve();
      },
      initializeRuntime: () => {
        events.push("runtime");
        return Promise.resolve();
      },
      getAdapter: () => {
        events.push("adapter");
        return Promise.resolve(adapter);
      },
      bootstrap: (_projectDir, selectedAdapter) => {
        events.push("bootstrap");
        const result: BootstrapResult = {
          adapter: selectedAdapter,
          config: {},
          usingFSAdapter: false,
          extensionLoader: {} as BootstrapResult["extensionLoader"],
          dispose: () => {
            events.push("dispose-bootstrap");
          },
        };
        return Promise.resolve(result);
      },
      startServer: (options) => {
        events.push(`start:${options.port}:${options.bindAddress}`);
        const ready = new Promise<void>((resolve) => {
          setTimeout(() => {
            resolve();
            signalHandler?.("SIGTERM");
          }, 0);
        });
        return Promise.resolve({
          ready,
          stop: () => {
            events.push("stop");
            return Promise.resolve();
          },
        });
      },
      registerSignals: (handler) => {
        events.push("signals");
        signalHandler = handler;
        return () => events.push("dispose-signals");
      },
      gracefullyShutdown: async (options) => {
        events.push(`shutdown:${options.signal}:${options.drainTimeoutMs}`);
        await options.dispose?.();
        await options.stop();
        options.abort();
        return true;
      },
      flush: () => {
        events.push("flush");
        return Promise.resolve();
      },
      captureError: () => events.push("error"),
      exit: (code) => events.push(`exit:${code}`),
    });

    assertEquals(events, [
      "signals",
      "reporting",
      "runtime",
      "adapter",
      "bootstrap",
      "start:4321:127.0.0.1",
      "shutdown:SIGTERM:1234",
      "dispose-bootstrap",
      "stop",
      "flush",
      "exit:0",
      "dispose-signals",
    ]);
  });

  it("awaits bootstrap acquired during flush before exiting", async () => {
    const events: string[] = [];
    const adapter = createMockAdapter();
    let requestSignal: (() => void) | undefined;
    let resolveBootstrap: ((value: BootstrapResult) => void) | undefined;
    let resolveDispose: (() => void) | undefined;
    let markBootstrapStarted: (() => void) | undefined;
    let markDisposeStarted: (() => void) | undefined;
    const bootstrapStarted = new Promise<void>((resolve) => {
      markBootstrapStarted = resolve;
    });
    const disposeStarted = new Promise<void>((resolve) => {
      markDisposeStarted = resolve;
    });

    const run = runDirectProductionServer({
      initializeErrorReporting: () => Promise.resolve(),
      initializeRuntime: () => Promise.resolve(),
      getAdapter: () => Promise.resolve(adapter),
      bootstrap: () => {
        events.push("bootstrap-start");
        markBootstrapStarted?.();
        return new Promise<BootstrapResult>((resolve) => {
          resolveBootstrap = resolve;
        });
      },
      registerSignals: (handler) => {
        requestSignal = () => handler("SIGTERM");
      },
      gracefullyShutdown: (options) => {
        events.push("shutdown");
        options.abort();
        return Promise.resolve(true);
      },
      flush: async () => {
        events.push("flush-start");
        resolveBootstrap?.({
          adapter,
          config: {},
          usingFSAdapter: false,
          extensionLoader: {} as BootstrapResult["extensionLoader"],
          dispose: () => {
            events.push("dispose-start");
            markDisposeStarted?.();
            return new Promise<void>((resolve) => {
              resolveDispose = () => {
                events.push("dispose-done");
                resolve();
              };
            });
          },
        });
        await disposeStarted;
        events.push("flush-done");
        queueMicrotask(() => resolveDispose?.());
      },
      captureError: () => events.push("error"),
      exit: (code) => events.push(`exit:${code}`),
    });

    await bootstrapStarted;
    requestSignal?.();
    await run;

    assertEquals(events, [
      "bootstrap-start",
      "shutdown",
      "flush-start",
      "dispose-start",
      "flush-done",
      "dispose-done",
      "exit:0",
    ]);
  });

  it("does not re-await initial bootstrap disposal after cleanup times out", async () => {
    const events: string[] = [];
    const adapter = createMockAdapter();
    let requestSignal: (() => void) | undefined;
    let releaseDispose: (() => void) | undefined;

    const run = runDirectProductionServer({
      initializeErrorReporting: () => Promise.resolve(),
      initializeRuntime: () => Promise.resolve(),
      getAdapter: () => Promise.resolve(adapter),
      bootstrap: () =>
        Promise.resolve({
          adapter,
          config: {},
          usingFSAdapter: false,
          extensionLoader: {} as BootstrapResult["extensionLoader"],
          dispose: () => {
            events.push("dispose-start");
            return new Promise<void>((resolve) => {
              releaseDispose = resolve;
            });
          },
        }),
      startServer: () =>
        Promise.resolve({
          ready: new Promise<void>((resolve) => {
            setTimeout(() => {
              resolve();
              requestSignal?.();
            }, 0);
          }),
          stop: () => Promise.resolve(),
        }),
      registerSignals: (handler) => {
        requestSignal = () => handler("SIGTERM");
      },
      gracefullyShutdown: async (options) => {
        events.push("shutdown-start");
        void options.dispose?.();
        await Promise.resolve();
        events.push("cleanup-timeout");
        void options.stop();
        return false;
      },
      flush: () => {
        events.push("flush");
        return Promise.resolve();
      },
      captureError: () => events.push("error"),
      exit: (code) => events.push(`exit:${code}`),
    });

    await run;

    assertEquals(events, [
      "shutdown-start",
      "dispose-start",
      "cleanup-timeout",
      "flush",
      "exit:0",
    ]);
    releaseDispose?.();
  });

  it("rechecks late bootstrap ownership at the final exit fence", async () => {
    const events: string[] = [];
    const adapter = createMockAdapter();
    let requestSignal: (() => void) | undefined;
    let resolveBootstrap: ((value: BootstrapResult) => void) | undefined;
    let markBootstrapStarted: (() => void) | undefined;
    const bootstrapStarted = new Promise<void>((resolve) => {
      markBootstrapStarted = resolve;
    });

    const run = runDirectProductionServer({
      initializeErrorReporting: () => Promise.resolve(),
      initializeRuntime: () => Promise.resolve(),
      getAdapter: () => Promise.resolve(adapter),
      bootstrap: () => {
        events.push("bootstrap-start");
        markBootstrapStarted?.();
        return new Promise<BootstrapResult>((resolve) => {
          resolveBootstrap = resolve;
        });
      },
      registerSignals: (handler) => {
        requestSignal = () => handler("SIGTERM");
      },
      gracefullyShutdown: (options) => {
        events.push("shutdown");
        options.abort();
        return Promise.resolve(true);
      },
      flush: () => {
        events.push("flush-start");
        return new Promise<void>((resolveFlush) => {
          queueMicrotask(() => {
            events.push("flush-resolve");
            resolveFlush();
            resolveBootstrap?.({
              adapter,
              config: {},
              usingFSAdapter: false,
              extensionLoader: {} as BootstrapResult["extensionLoader"],
              dispose: () => {
                events.push("dispose-start");
                return new Promise<void>((resolve) => {
                  setTimeout(() => {
                    events.push("dispose-done");
                    resolve();
                  }, 0);
                });
              },
            });
          });
        });
      },
      captureError: () => events.push("error"),
      exit: (code) => events.push(`exit:${code}`),
    });

    await bootstrapStarted;
    requestSignal?.();
    await run;
    assertEquals(events, [
      "bootstrap-start",
      "shutdown",
      "flush-start",
      "flush-resolve",
      "dispose-start",
      "dispose-done",
      "exit:0",
    ]);
  });

  it("disposes an acquired bootstrap when server startup rejects", async () => {
    const events: string[] = [];
    const adapter = createMockAdapter();
    const startupError = new Error("server startup failed");
    let caught: unknown;

    try {
      await runDirectProductionServer({
        initializeErrorReporting: () => Promise.resolve(),
        initializeRuntime: () => Promise.resolve(),
        getAdapter: () => Promise.resolve(adapter),
        bootstrap: () =>
          Promise.resolve({
            adapter,
            config: {},
            usingFSAdapter: false,
            extensionLoader: {} as BootstrapResult["extensionLoader"],
            dispose: () => {
              events.push("dispose-bootstrap");
            },
          }),
        startServer: () => Promise.reject(startupError),
        registerSignals: () => () => events.push("signals-disposed"),
        gracefullyShutdown: () => Promise.resolve(true),
        flush: () => Promise.resolve(),
        captureError: () => events.push("error"),
        exit: () => events.push("exit"),
      });
    } catch (error) {
      caught = error;
    }

    assertEquals(caught, startupError);
    assertEquals(events, ["dispose-bootstrap", "signals-disposed"]);
  });

  it("disposes direct bootstrap after server readiness rejects", async () => {
    const events: string[] = [];
    const adapter = createMockAdapter();
    const readinessError = new Error("readiness failed");
    let caught: unknown;

    try {
      await runDirectProductionServer({
        initializeErrorReporting: () => Promise.resolve(),
        initializeRuntime: () => Promise.resolve(),
        getAdapter: () => Promise.resolve(adapter),
        bootstrap: () =>
          Promise.resolve({
            adapter,
            config: {},
            usingFSAdapter: false,
            extensionLoader: {} as BootstrapResult["extensionLoader"],
            dispose: () => {
              events.push("dispose-bootstrap");
            },
          }),
        startServer: () =>
          Promise.resolve({
            ready: Promise.reject(readinessError),
            stop: () => {
              events.push("stop-server");
              return Promise.resolve();
            },
          }),
        registerSignals: () => () => events.push("signals-disposed"),
        gracefullyShutdown: () => Promise.resolve(true),
        flush: () => Promise.resolve(),
        captureError: () => events.push("error"),
        exit: () => events.push("exit"),
      });
    } catch (error) {
      caught = error;
    }

    assertEquals(caught, readinessError);
    assertEquals(events, ["stop-server", "dispose-bootstrap", "signals-disposed"]);
  });

  it("preserves an undefined server stop rejection over bootstrap disposal failure", async () => {
    const events: string[] = [];
    const captured: unknown[] = [];
    const adapter = createMockAdapter();
    let signalHandler: ((signal: "SIGINT" | "SIGTERM") => void | Promise<void>) | undefined;

    await runDirectProductionServer({
      initializeErrorReporting: () => Promise.resolve(),
      initializeRuntime: () => Promise.resolve(),
      getAdapter: () => Promise.resolve(adapter),
      bootstrap: () =>
        Promise.resolve({
          adapter,
          config: {},
          usingFSAdapter: false,
          extensionLoader: {} as BootstrapResult["extensionLoader"],
          dispose: () => Promise.reject(new Error("dispose failed")),
        }),
      startServer: () => {
        return Promise.resolve({
          ready: new Promise<void>((resolve) => {
            setTimeout(() => {
              resolve();
              signalHandler?.("SIGTERM");
            }, 0);
          }),
          stop: () => Promise.reject(undefined),
        });
      },
      registerSignals: (handler) => {
        signalHandler = handler;
      },
      gracefullyShutdown: async (options) => {
        await options.stop();
        return true;
      },
      flush: () => Promise.resolve(),
      captureError: (error) => captured.push(error),
      exit: (code) => events.push(`exit:${code}`),
    });

    assertEquals(captured, [undefined]);
    assertEquals(events, ["exit:0"]);
  });
});
