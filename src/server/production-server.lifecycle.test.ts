import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { VeryfrontConfig } from "#veryfront/config";
import type { BootstrapResult } from "./bootstrap.ts";
import {
  handleProductionGlobalError,
  initializeProductionInfrastructure,
  parseProductionServerPort,
  startProductionServer,
} from "./production-server.ts";
import { getMemoryMonitoringState, stopMemoryMonitoring } from "#veryfront/utils/memory/index.ts";
import {
  getSSRServerPort,
  isSSRClientOnlyFetching,
} from "#veryfront/rendering/ssr-globals/context.ts";

function createBootstrapResult(
  adapter: RuntimeAdapter,
  dispose: () => void | Promise<void>,
): BootstrapResult {
  return {
    adapter,
    config: {
      fs: {
        type: "veryfront",
        veryfront: {
          apiBaseUrl: "https://api.example.com",
          proxyMode: true,
        },
      },
    } as VeryfrontConfig,
    usingFSAdapter: true,
    fsAdapterType: "test",
    extensionLoader: {} as BootstrapResult["extensionLoader"],
    dispose,
  };
}

function createLifecycleAdapter(
  stop: () => void | Promise<void>,
): RuntimeAdapter {
  const adapter = createMockAdapter();
  return {
    ...adapter,
    serve: (_handler, options) => {
      const addr = {
        hostname: options.hostname ?? "127.0.0.1",
        port: options.port ?? 0,
      };
      options.onListen?.(addr);
      return Promise.resolve({
        addr,
        stop: async () => await stop(),
      });
    },
  };
}

describe("startProductionServer lifecycle", () => {
  it("fails startup when configured cache initialization fails", async () => {
    let tracingCalls = 0;

    await assertRejects(
      () =>
        initializeProductionInfrastructure({
          initializeTracing: () => {
            tracingCalls++;
            return Promise.resolve();
          },
          initializeCaches: () => Promise.reject(new Error("cache initialization failed")),
        }),
      Error,
      "cache initialization failed",
    );

    assertEquals(tracingCalls, 1);
  });

  it("keeps tracing optional without weakening cache initialization", async () => {
    let cacheCalls = 0;

    await initializeProductionInfrastructure({
      initializeTracing: () => Promise.reject(new Error("tracing unavailable")),
      initializeCaches: () => {
        cacheCalls++;
        return Promise.resolve();
      },
    });

    assertEquals(cacheCalls, 1);
  });

  it("parses production ports strictly", () => {
    assertEquals(parseProductionServerPort(undefined), 3000);
    assertEquals(parseProductionServerPort("3100"), 3100);
    assertEquals(parseProductionServerPort("65535"), 65535);

    for (const value of ["", " 3100 ", "0", "65536", "3.1", "+3100", "invalid"]) {
      let error: unknown;
      try {
        parseProductionServerPort(value);
      } catch (caught) {
        error = caught;
      }
      assertEquals(error instanceof TypeError, true);
    }
  });

  it("treats every escaped process error as fatal and logs metadata only", () => {
    const records: Array<{ message: unknown; context: unknown }> = [];
    const error = new Error("private-payload-canary");
    error.stack = "private-stack-canary";

    const handled = handleProductionGlobalError(
      error,
      "unhandledRejection",
      {
        error: (message, context) => records.push({ message, context }),
      } as Parameters<typeof handleProductionGlobalError>[2],
    );

    assertEquals(handled, false);
    assertEquals(records, [{
      message: "Unhandled process error",
      context: {
        type: "unhandledRejection",
        errorName: "Error",
        fatal: true,
      },
    }]);
    assertEquals(JSON.stringify(records).includes("private-payload-canary"), false);
    assertEquals(JSON.stringify(records).includes("private-stack-canary"), false);
  });

  it("rejects invalid ports before acquiring process resources", async () => {
    let serveCalls = 0;
    const base = createLifecycleAdapter(() => {});
    const adapter: RuntimeAdapter = {
      ...base,
      serve: (handler, options) => {
        serveCalls++;
        return base.serve(handler, options);
      },
    };

    await assertRejects(
      () =>
        startProductionServer({
          projectDir: "project",
          port: Number.NaN,
          adapter,
          bootstrapResult: createBootstrapResult(adapter, () => {}),
        }),
      TypeError,
      "between 0 and 65535",
    );
    assertEquals(serveCalls, 0);
    assertEquals(getMemoryMonitoringState().active, false);
  });

  it("rejects conflicting adapter ownership before acquiring process resources", async () => {
    const bootstrapAdapter = createLifecycleAdapter(() => {});
    const optionAdapter = createLifecycleAdapter(() => {});

    await assertRejects(
      () =>
        startProductionServer({
          projectDir: "project",
          port: 3000,
          adapter: optionAdapter,
          bootstrapResult: createBootstrapResult(bootstrapAdapter, () => {}),
        }),
      TypeError,
      "must match",
    );
    assertEquals(getMemoryMonitoringState().active, false);
  });

  it("rejects an already-aborted start before acquiring process resources", async () => {
    const adapter = createLifecycleAdapter(() => {});
    const controller = new AbortController();
    controller.abort(new Error("private-abort-reason-canary"));

    const error = await assertRejects(
      () =>
        startProductionServer({
          projectDir: "project",
          port: 3000,
          adapter,
          bootstrapResult: createBootstrapResult(adapter, () => {}),
          signal: controller.signal,
        }),
      DOMException,
      "was aborted",
    );
    assertEquals(error.message.includes("private-abort-reason-canary"), false);
    assertEquals(getMemoryMonitoringState().active, false);
  });

  it("keeps shared memory monitoring active until the final server stops", async () => {
    stopMemoryMonitoring();
    const firstAdapter = createLifecycleAdapter(() => {});
    firstAdapter.env.set("ENABLE_MEMORY_MONITORING", "true");
    firstAdapter.env.set("MEMORY_MONITORING_INTERVAL_MS", "60000");
    const secondAdapter = createLifecycleAdapter(() => {});
    secondAdapter.env.set("ENABLE_MEMORY_MONITORING", "true");
    secondAdapter.env.set("MEMORY_MONITORING_INTERVAL_MS", "60000");

    const first = await startProductionServer({
      projectDir: "project-a",
      port: 0,
      adapter: firstAdapter,
      bootstrapResult: createBootstrapResult(firstAdapter, () => {}),
    });
    const second = await startProductionServer({
      projectDir: "project-b",
      port: 0,
      adapter: secondAdapter,
      bootstrapResult: createBootstrapResult(secondAdapter, () => {}),
    });

    try {
      await Promise.all([first.ready, second.ready]);
      await first.stop();
      assertEquals(getMemoryMonitoringState(), { active: true, intervalMs: 60000 });

      await second.stop();
      assertEquals(getMemoryMonitoringState(), { active: false, intervalMs: undefined });
    } finally {
      await Promise.allSettled([first.stop(), second.stop()]);
      stopMemoryMonitoring();
    }
  });

  it("borrows an injected bootstrap by default and stops the listener once", async () => {
    let serverStops = 0;
    let bootstrapDisposals = 0;
    const adapter = createLifecycleAdapter(() => {
      serverStops++;
    });
    const bootstrap = createBootstrapResult(adapter, () => {
      bootstrapDisposals++;
    });

    const server = await startProductionServer({
      projectDir: "/app",
      port: 0,
      adapter,
      bootstrapResult: bootstrap,
    });
    await server.ready;

    await Promise.all([server.stop(), server.stop()]);
    await server.stop();

    assertEquals(serverStops, 1);
    assertEquals(bootstrapDisposals, 0);
  });

  it("disposes an injected bootstrap once when ownership is transferred", async () => {
    let serverStops = 0;
    let bootstrapDisposals = 0;
    const adapter = createLifecycleAdapter(() => {
      serverStops++;
    });
    const bootstrap = createBootstrapResult(adapter, () => {
      bootstrapDisposals++;
    });

    const server = await startProductionServer({
      projectDir: "/app",
      port: 0,
      adapter,
      bootstrapResult: bootstrap,
      bootstrapOwnership: "transferred",
    });
    await server.ready;

    await Promise.all([server.stop(), server.stop()]);

    assertEquals(serverStops, 1);
    assertEquals(bootstrapDisposals, 1);
  });

  it("attempts owned bootstrap disposal when listener shutdown fails", async () => {
    let bootstrapDisposals = 0;
    const adapter = createLifecycleAdapter(() => {
      throw new Error("listener stop failed");
    });
    const bootstrap = createBootstrapResult(adapter, () => {
      bootstrapDisposals++;
    });

    const server = await startProductionServer({
      projectDir: "/app",
      port: 0,
      adapter,
      bootstrapResult: bootstrap,
      bootstrapOwnership: "transferred",
    });
    await server.ready;

    await assertRejects(() => server.stop(), AggregateError, "Production server cleanup failed");
    assertEquals(bootstrapDisposals, 1);
  });

  it("fails startup when configured production CSS prewarming fails", async () => {
    let serveCalls = 0;
    let bootstrapDisposals = 0;
    const base = createLifecycleAdapter(() => {});
    const adapter: RuntimeAdapter = {
      ...base,
      fs: {
        ...base.fs,
        exists: () => Promise.reject(new Error("filesystem unavailable")),
      },
      serve: (handler, options) => {
        serveCalls++;
        return base.serve(handler, options);
      },
    };
    const bootstrap = createBootstrapResult(adapter, () => {
      bootstrapDisposals++;
    });

    await assertRejects(
      () =>
        startProductionServer({
          projectDir: "/app",
          port: 0,
          adapter,
          bootstrapResult: bootstrap,
          bootstrapOwnership: "transferred",
          defaultEnvironment: "production",
          localProjects: { project: "/app" },
        }),
      Error,
      "Failed to inspect",
    );
    assertEquals(serveCalls, 0);
    assertEquals(bootstrapDisposals, 1);
  });

  it("keeps readiness isolated between concurrent server instances", async () => {
    let firstHandler: Parameters<RuntimeAdapter["serve"]>[0] | undefined;
    let secondHandler: Parameters<RuntimeAdapter["serve"]>[0] | undefined;

    const firstBase = createLifecycleAdapter(() => {});
    const firstAdapter: RuntimeAdapter = {
      ...firstBase,
      serve: (handler, options) => {
        firstHandler = handler;
        return firstBase.serve(handler, options);
      },
    };
    const secondBase = createLifecycleAdapter(() => {});
    const secondAdapter: RuntimeAdapter = {
      ...secondBase,
      serve: (handler, options) => {
        secondHandler = handler;
        return secondBase.serve(handler, options);
      },
    };

    const first = await startProductionServer({
      projectDir: "project-a",
      port: 0,
      adapter: firstAdapter,
      bootstrapResult: createBootstrapResult(firstAdapter, () => {}),
    });
    const second = await startProductionServer({
      projectDir: "project-b",
      port: 0,
      adapter: secondAdapter,
      bootstrapResult: createBootstrapResult(secondAdapter, () => {}),
    });

    await Promise.all([first.ready, second.ready]);
    await first.stop();

    if (!firstHandler || !secondHandler) throw new Error("Server handler was not captured");
    const firstReadiness = await firstHandler(new Request("http://localhost/readyz"));
    const secondReadiness = await secondHandler(new Request("http://localhost/readyz"));

    assertEquals(firstReadiness.status, 503);
    assertEquals(secondReadiness.status, 200);
    await second.stop();
  });

  it("keeps SSR settings isolated between concurrent server handlers", async () => {
    let firstHandler: Parameters<RuntimeAdapter["serve"]>[0] | undefined;
    let secondHandler: Parameters<RuntimeAdapter["serve"]>[0] | undefined;
    let releaseFirst: () => void = () => {};
    const firstCanFinish = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let firstStarted: () => void = () => {};
    const firstIsRunning = new Promise<void>((resolve) => {
      firstStarted = resolve;
    });
    const observations: Array<[number | null, boolean]> = [];

    const firstBase = createLifecycleAdapter(() => {});
    const firstAdapter: RuntimeAdapter = {
      ...firstBase,
      serve: (handler, options) => {
        firstHandler = handler;
        return firstBase.serve(handler, options);
      },
    };
    const secondBase = createLifecycleAdapter(() => {});
    const secondAdapter: RuntimeAdapter = {
      ...secondBase,
      serve: (handler, options) => {
        secondHandler = handler;
        return secondBase.serve(handler, options);
      },
    };

    const first = await startProductionServer({
      projectDir: "project-a",
      port: 3101,
      adapter: firstAdapter,
      bootstrapResult: createBootstrapResult(firstAdapter, () => {}),
      requestInterceptor: async (request) => {
        firstStarted();
        await firstCanFinish;
        observations.push([getSSRServerPort(), isSSRClientOnlyFetching()]);
        return request;
      },
    });
    const second = await startProductionServer({
      projectDir: "project-b",
      port: 3102,
      adapter: secondAdapter,
      bootstrapResult: createBootstrapResult(secondAdapter, () => {}),
      requestInterceptor: async (request) => {
        await Promise.resolve();
        observations.push([getSSRServerPort(), isSSRClientOnlyFetching()]);
        return request;
      },
    });

    try {
      await Promise.all([first.ready, second.ready]);
      if (!firstHandler || !secondHandler) throw new Error("Server handler was not captured");

      const firstResponse = firstHandler(new Request("http://localhost/readyz"));
      await firstIsRunning;
      const secondResponse = secondHandler(new Request("http://localhost/readyz"));
      await secondResponse;
      releaseFirst();
      await firstResponse;

      assertEquals(observations, [[3102, false], [3101, false]]);
    } finally {
      releaseFirst();
      await Promise.allSettled([first.stop(), second.stop()]);
    }
  });

  it("settles readiness when stopped before the listener becomes ready", async () => {
    const base = createLifecycleAdapter(() => {});
    const adapter: RuntimeAdapter = {
      ...base,
      serve: (_handler, options) =>
        Promise.resolve({
          addr: {
            hostname: options.hostname ?? "127.0.0.1",
            port: options.port ?? 0,
          },
          stop: () => Promise.resolve(),
        }),
    };

    const server = await startProductionServer({
      projectDir: "project",
      port: 0,
      adapter,
      bootstrapResult: createBootstrapResult(adapter, () => {}),
    });
    await server.stop();
    await assertRejects(
      () => server.ready,
      Error,
      "Production server stopped before becoming ready",
    );
  });
});
