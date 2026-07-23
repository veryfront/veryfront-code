import "#veryfront/schemas/_test-setup.ts";

import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { validateVeryfrontConfig } from "#veryfront/config";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { ServeOptions, Server } from "#veryfront/platform/adapters/base.ts";
import type { BootstrapResult } from "./bootstrap.ts";
import { createProductionReadiness, startProductionServer } from "./production-server.ts";
import { isServerInitialized, setServerInitialized } from "./handlers/monitoring/health.handler.ts";
import {
  getSSRServerPort,
  isSSRClientOnlyFetching,
} from "#veryfront/rendering/ssr-globals/context.ts";

function createBootstrapResult(
  dispose: () => void | Promise<void>,
): BootstrapResult {
  const adapter = createMockAdapter();
  const config = validateVeryfrontConfig({
    fs: { veryfront: { proxyMode: true } },
  }) as BootstrapResult["config"];
  return {
    adapter,
    config,
    usingFSAdapter: false,
    extensionLoader: {} as BootstrapResult["extensionLoader"],
    dispose,
  };
}

describe("startProductionServer() lifecycle", () => {
  it("owns an externally supplied bootstrap and stops it exactly once", async () => {
    let serverStopCalls = 0;
    let bootstrapDisposeCalls = 0;
    let releaseDispose!: () => void;
    let markDisposeStarted!: () => void;
    const disposeGate = new Promise<void>((resolve) => {
      releaseDispose = resolve;
    });
    const disposeStarted = new Promise<void>((resolve) => {
      markDisposeStarted = resolve;
    });
    const bootstrap = createBootstrapResult(async () => {
      bootstrapDisposeCalls++;
      markDisposeStarted();
      await disposeGate;
    });

    bootstrap.adapter.serve = (
      _handler: (request: Request) => Promise<Response> | Response,
      options: ServeOptions,
    ): Promise<Server> => {
      options.onListen?.({ hostname: "127.0.0.1", port: 4_321 });
      return Promise.resolve({
        addr: { hostname: "127.0.0.1", port: 4_321 },
        stop: () => {
          serverStopCalls++;
          return Promise.resolve();
        },
      });
    };

    const handle = await startProductionServer({
      projectDir: "/project",
      port: 4_321,
      adapter: bootstrap.adapter,
      bootstrapResult: bootstrap,
    });
    await handle.ready;

    const firstStop = handle.stop();
    const secondStop = handle.stop();
    assertStrictEquals(firstStop, secondStop);

    await disposeStarted;
    assertEquals(serverStopCalls, 1);
    assertEquals(bootstrapDisposeCalls, 1);

    releaseDispose();
    await Promise.all([firstStop, secondStop, handle.stop()]);
    await handle.stop();

    assertEquals(serverStopCalls, 1);
    assertEquals(bootstrapDisposeCalls, 1);
  });

  it("disposes an externally supplied bootstrap when server startup fails", async () => {
    let bootstrapDisposeCalls = 0;
    const bootstrap = createBootstrapResult(() => {
      bootstrapDisposeCalls++;
    });
    bootstrap.adapter.serve = () => Promise.reject(new Error("listen-boom"));

    await assertRejects(
      () =>
        startProductionServer({
          projectDir: "/project",
          port: 4_321,
          adapter: bootstrap.adapter,
          bootstrapResult: bootstrap,
        }),
      Error,
      "listen-boom",
    );

    assertEquals(bootstrapDisposeCalls, 1);
  });

  it("clears readiness when listen fires before serve rejects", async () => {
    setServerInitialized(false);
    const bootstrap = createBootstrapResult(() => {});
    bootstrap.adapter.serve = (_handler, options) => {
      options.onListen?.({ hostname: "127.0.0.1", port: 4_321 });
      return Promise.reject(new Error("serve-after-listen-boom"));
    };

    await assertRejects(
      () =>
        startProductionServer({
          projectDir: "/project",
          port: 4_321,
          adapter: bootstrap.adapter,
          bootstrapResult: bootstrap,
        }),
      Error,
      "serve-after-listen-boom",
    );

    assertEquals(isServerInitialized(), false);
  });

  it("rejects a second live process-global server and permits it after stop", async () => {
    const firstBootstrap = createBootstrapResult(() => {});
    const secondBootstrap = createBootstrapResult(() => {});
    for (const bootstrap of [firstBootstrap, secondBootstrap]) {
      bootstrap.adapter.serve = (_handler, options) => {
        options.onListen?.({ hostname: "127.0.0.1", port: 4_321 });
        return Promise.resolve({
          addr: { hostname: "127.0.0.1", port: 4_321 },
          stop: () => Promise.resolve(),
        });
      };
    }

    const first = await startProductionServer({
      projectDir: "/first",
      port: 4_321,
      adapter: firstBootstrap.adapter,
      bootstrapResult: firstBootstrap,
    });
    await first.ready;

    await assertRejects(
      () =>
        startProductionServer({
          projectDir: "/second",
          port: 4_322,
          adapter: secondBootstrap.adapter,
          bootstrapResult: secondBootstrap,
        }),
      Error,
      "already active",
    );

    await first.stop();

    const second = await startProductionServer({
      projectDir: "/second",
      port: 4_322,
      adapter: secondBootstrap.adapter,
      bootstrapResult: secondBootstrap,
    });
    await second.ready;
    await second.stop();
  });

  it("retains server ownership when stop fails and retries before replacement", async () => {
    let stopCalls = 0;
    let bootstrapDisposeCalls = 0;
    const bootstrap = createBootstrapResult(() => {
      bootstrapDisposeCalls++;
    });
    bootstrap.adapter.serve = (_handler, options) => {
      options.onListen?.({ hostname: "127.0.0.1", port: 4_321 });
      return Promise.resolve({
        addr: { hostname: "127.0.0.1", port: 4_321 },
        stop: () => {
          stopCalls++;
          return stopCalls === 1
            ? Promise.reject(new Error("transient server stop failure"))
            : Promise.resolve();
        },
      });
    };

    const handle = await startProductionServer({
      projectDir: "/project",
      port: 4_321,
      adapter: bootstrap.adapter,
      bootstrapResult: bootstrap,
    });
    await handle.ready;

    await assertRejects(handle.stop, Error, "transient server stop failure");
    assertEquals(bootstrapDisposeCalls, 0);
    assertEquals(getSSRServerPort(), 4_321);
    assertEquals(isSSRClientOnlyFetching(), true);

    const contender = createBootstrapResult(() => {});
    await assertRejects(
      () =>
        startProductionServer({
          projectDir: "/contender",
          port: 4_322,
          adapter: contender.adapter,
          bootstrapResult: contender,
        }),
      Error,
      "already active",
    );

    await handle.stop();
    assertEquals(stopCalls, 2);
    assertEquals(bootstrapDisposeCalls, 1);
    assertEquals(getSSRServerPort(), null);
    assertEquals(isSSRClientOnlyFetching(), false);
  });
});

describe("createProductionReadiness()", () => {
  it("marks readiness false immediately and keeps it false when the handler rejects", async () => {
    setServerInitialized(true);
    const handlerReady = Promise.withResolvers<void>();
    const readiness = createProductionReadiness(handlerReady.promise);

    assertEquals(isServerInitialized(), false);
    readiness.onListen();
    const ready = readiness.ready();
    handlerReady.reject(new Error("handler-ready-boom"));

    await assertRejects(() => ready, Error, "handler-ready-boom");
    assertEquals(isServerInitialized(), false);
  });

  it("cannot resurrect readiness after a cancelled delayed handler", async () => {
    setServerInitialized(false);
    const handlerReady = Promise.withResolvers<void>();
    const readiness = createProductionReadiness(handlerReady.promise);

    readiness.onListen();
    const startupFailure = new Error("startup cancelled");
    readiness.cancel(startupFailure);
    handlerReady.resolve();

    await assertRejects(() => readiness.ready(), Error, "startup cancelled");
    await Promise.resolve();
    assertEquals(isServerInitialized(), false);
  });
});
