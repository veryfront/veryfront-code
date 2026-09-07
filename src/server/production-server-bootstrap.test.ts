import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
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
