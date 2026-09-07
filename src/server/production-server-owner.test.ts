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
});
