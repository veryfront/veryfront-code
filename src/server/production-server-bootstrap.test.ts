import { FakeTime } from "#std/testing/time";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import {
  getMemoryMonitoringState,
  startMemoryMonitoring,
  stopMemoryMonitoring,
} from "#veryfront/utils/memory/profiler.ts";
import type { BootstrapResult } from "./bootstrap.ts";
import { startProductionServerWithDependencies } from "./production-server.ts";

function createAdapter(): RuntimeAdapter {
  const mockAdapter = createMockAdapter();
  return {
    ...mockAdapter,
    serve: (_handler, options) => {
      options.onListen?.({
        hostname: options.hostname ?? "127.0.0.1",
        port: options.port ?? 0,
      });
      return Promise.resolve({
        stop: () => Promise.resolve(),
        addr: {
          hostname: options.hostname ?? "127.0.0.1",
          port: options.port ?? 0,
        },
      });
    },
  };
}

function createBootstrap(adapter: RuntimeAdapter, dispose: () => void): BootstrapResult {
  return {
    adapter,
    config: { fs: { veryfront: { proxyMode: true } } },
    usingFSAdapter: false,
    fsAdapterType: "MockRuntimeAdapter",
    extensionLoader: {} as BootstrapResult["extensionLoader"],
    dispose,
  };
}

describe("production server bootstrap ownership", () => {
  it("loads a recycle policy introduced by internally owned bootstrap", async () => {
    const adapter = createAdapter();
    const time = new FakeTime();
    let recycleCalls = 0;
    let server: Awaited<ReturnType<typeof startProductionServerWithDependencies>> | undefined;
    try {
      server = await startProductionServerWithDependencies({
        projectDir: "/app",
        port: 0,
        adapter,
        unhandledRejectionGuard: false,
        onMemoryRecycle: () => {
          recycleCalls++;
        },
      }, {
        bootstrap: () => {
          adapter.env.set?.("MEMORY_RECYCLE_ENABLED", "true");
          adapter.env.set?.("MEMORY_RECYCLE_RSS_THRESHOLD_MB", "0.01");
          adapter.env.set?.("MEMORY_RECYCLE_CONSECUTIVE_SAMPLES", "1");
          adapter.env.set?.("MEMORY_MONITORING_INTERVAL_MS", "10");
          return Promise.resolve(createBootstrap(adapter, () => {}));
        },
      });
      assertEquals(getMemoryMonitoringState(), { active: true, intervalMs: 10 });
      await time.tickAsync(30);
      assertEquals(recycleCalls, 1);
      await server.stop();
      assertEquals(getMemoryMonitoringState().active, false);
    } finally {
      await server?.stop();
      stopMemoryMonitoring();
      time.restore();
    }
  });

  it("completes a parent-enabled recycle policy from project bootstrap", async () => {
    const adapter = createAdapter();
    adapter.env.set?.("MEMORY_RECYCLE_ENABLED", "true");
    let bootstrapped = false;
    const server = await startProductionServerWithDependencies({
      projectDir: "/app",
      port: 0,
      adapter,
      unhandledRejectionGuard: false,
      onMemoryRecycle: () => {},
    }, {
      bootstrap: () => {
        bootstrapped = true;
        adapter.env.set?.("MEMORY_RECYCLE_RSS_THRESHOLD_MB", "1024");
        adapter.env.set?.("MEMORY_RECYCLE_CONSECUTIVE_SAMPLES", "2");
        return Promise.resolve(createBootstrap(adapter, () => {}));
      },
    });
    try {
      assertEquals(bootstrapped, true);
      assertEquals(getMemoryMonitoringState().active, true);
    } finally {
      await server.stop();
      stopMemoryMonitoring();
    }
  });

  it("rejects an invalid bootstrap recycle policy and disposes owned resources", async () => {
    const adapter = createAdapter();
    let disposeCalls = 0;
    let serveCalls = 0;
    adapter.serve = () => {
      serveCalls++;
      throw new Error("must not start listener");
    };
    try {
      await assertRejects(
        () =>
          startProductionServerWithDependencies({
            projectDir: "/app",
            port: 0,
            adapter,
            unhandledRejectionGuard: false,
            onMemoryRecycle: () => {},
          }, {
            bootstrap: () => {
              adapter.env.set?.("MEMORY_RECYCLE_ENABLED", "true");
              return Promise.resolve(createBootstrap(adapter, () => {
                disposeCalls++;
              }));
            },
          }),
        Error,
        "MEMORY_RECYCLE_RSS_THRESHOLD_MB",
      );
      assertEquals(serveCalls, 0);
      assertEquals(disposeCalls, 1);
      assertEquals(getMemoryMonitoringState().active, false);
    } finally {
      stopMemoryMonitoring();
    }
  });

  it("stops its parent monitor when bootstrap disables monitoring", async () => {
    const adapter = createAdapter();
    adapter.env.set?.("ENABLE_MEMORY_MONITORING", "true");
    const server = await startProductionServerWithDependencies({
      projectDir: "/app",
      port: 0,
      adapter,
      unhandledRejectionGuard: false,
    }, {
      bootstrap: () => {
        assertEquals(getMemoryMonitoringState().active, true);
        adapter.env.set?.("ENABLE_MEMORY_MONITORING", "false");
        return Promise.resolve(createBootstrap(adapter, () => {}));
      },
    });
    try {
      assertEquals(getMemoryMonitoringState().active, false);
    } finally {
      await server.stop();
      stopMemoryMonitoring();
    }
  });

  it("leaves an unrelated monitor owned by its caller when both policies are disabled", async () => {
    const adapter = createAdapter();
    startMemoryMonitoring(60_000);
    try {
      const server = await startProductionServerWithDependencies({
        projectDir: "/app",
        port: 0,
        adapter,
        unhandledRejectionGuard: false,
      }, { bootstrap: () => Promise.resolve(createBootstrap(adapter, () => {})) });
      await server.stop();
      assertEquals(getMemoryMonitoringState(), { active: true, intervalMs: 60_000 });
    } finally {
      stopMemoryMonitoring();
    }
  });

  it("preserves startup failure when internally owned disposal exceeds the cleanup budget", async () => {
    const adapter = createAdapter();
    adapter.env.set?.("SHUTDOWN_CLEANUP_TIMEOUT_MS", "0");
    const failure = new Error("listener startup failed");
    adapter.serve = () => Promise.reject(failure);
    const cleanupStarted = Promise.withResolvers<void>();
    const finishCleanup = Promise.withResolvers<void>();
    const run = startProductionServerWithDependencies({
      projectDir: "/app",
      port: 0,
      adapter,
      unhandledRejectionGuard: false,
    }, {
      bootstrap: () =>
        Promise.resolve(createBootstrap(adapter, () => {
          cleanupStarted.resolve();
          return finishCleanup.promise;
        })),
    }).then(() => undefined, (error: unknown) => error);
    await cleanupStarted.promise;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        run,
        new Promise<string>((resolve) => {
          timer = setTimeout(() => resolve("still waiting"), 50);
        }),
      ]);
      assertEquals(outcome, failure);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      finishCleanup.resolve();
      await run;
    }
  });

  it("disposes an internally owned bootstrap exactly once when stopped", async () => {
    const adapter = createAdapter();
    let disposeCalls = 0;
    const server = await startProductionServerWithDependencies(
      {
        projectDir: "/app",
        port: 0,
        bindAddress: "127.0.0.1",
        adapter,
        unhandledRejectionGuard: false,
      },
      {
        bootstrap: () =>
          Promise.resolve(createBootstrap(adapter, () => {
            disposeCalls++;
          })),
      },
    );

    await server.ready;
    await Promise.all([server.stop(), server.stop()]);
    assertEquals(disposeCalls, 1);
  });

  it("leaves a supplied bootstrap owned by its caller", async () => {
    const adapter = createAdapter();
    let disposeCalls = 0;
    const bootstrapResult = createBootstrap(adapter, () => {
      disposeCalls++;
    });
    const server = await startProductionServerWithDependencies(
      {
        projectDir: "/app",
        port: 0,
        bindAddress: "127.0.0.1",
        adapter,
        bootstrapResult,
        unhandledRejectionGuard: false,
      },
      { bootstrap: () => Promise.reject(new Error("unexpected bootstrap")) },
    );

    await server.ready;
    await server.stop();
    assertEquals(disposeCalls, 0);
    await bootstrapResult.dispose?.();
    assertEquals(disposeCalls, 1);
  });
});
