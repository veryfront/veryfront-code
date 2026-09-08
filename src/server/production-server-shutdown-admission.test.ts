import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { BootstrapResult } from "./bootstrap.ts";
import { startProductionServerWithDependencies } from "./production-server.ts";
import { __resetServerShuttingDownForTests, markServerShuttingDown } from "./shutdown-state.ts";

function createBootstrap(adapter: RuntimeAdapter): BootstrapResult {
  return {
    adapter,
    config: { fs: { veryfront: { proxyMode: true } } },
    usingFSAdapter: false,
    fsAdapterType: "MockRuntimeAdapter",
    extensionLoader: {} as BootstrapResult["extensionLoader"],
  };
}

describe("production server shutdown admission", () => {
  it("rejects requests before invoking the public interceptor during drain", async () => {
    const adapter = createMockAdapter();
    let servedHandler: ((request: Request) => Response | Promise<Response>) | undefined;
    adapter.serve = (handler, options) => {
      servedHandler = handler;
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
    };
    let interceptorCalls = 0;
    const server = await startProductionServerWithDependencies({
      projectDir: "/shutdown-admission",
      port: 0,
      adapter,
      bootstrapResult: createBootstrap(adapter),
      unhandledRejectionGuard: false,
      requestInterceptor: (request) => {
        interceptorCalls++;
        return request;
      },
    }, { bootstrap: () => Promise.reject(new Error("unexpected bootstrap")) });

    try {
      if (!servedHandler) throw new Error("production listener did not receive a handler");
      markServerShuttingDown();
      const response = await servedHandler(new Request("http://localhost/api/orders"));

      assertEquals(response.status, 503);
      assertEquals(interceptorCalls, 0);
      await response.body?.cancel();
    } finally {
      __resetServerShuttingDownForTests();
      await server.stop();
    }
  });
});
