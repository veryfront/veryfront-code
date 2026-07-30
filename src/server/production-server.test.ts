import "#veryfront/schemas/_test-setup.ts";

import {
  assertEquals,
  assertInstanceOf,
  assertRejects,
  assertStrictEquals,
} from "#veryfront/testing/assert.ts";
import { afterAll, describe, it } from "#veryfront/testing/bdd.ts";
import { validateVeryfrontConfig } from "#veryfront/config";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import type { RuntimeAdapter, ServeOptions, Server } from "#veryfront/platform/adapters/base.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import type { BootstrapResult } from "./bootstrap.ts";
import { startLocalCliProxyProductionServer } from "#veryfront/server-cli-startup";
import {
  createProductionReadiness,
  createRetryableProductionShutdownHandler,
  flushProductionShutdownDiagnostics,
  resolveProductionBootstrap,
  runProductionShutdownWithDiagnostics,
  startProductionServer,
  type StartProductionServerOptions,
} from "./production-server.ts";
import { isServerInitialized, setServerInitialized } from "./handlers/monitoring/health.handler.ts";
import {
  getSSRServerPort,
  isSSRClientOnlyFetching,
} from "#veryfront/rendering/ssr-globals/context.ts";
import { stop as stopEsbuild } from "veryfront/extensions/bundler";
import { MAX_STUDIO_CAPTURE_BUNDLE_BYTES } from "#veryfront/extensions/studio/index.ts";
import type {
  NodeWebSocketServer,
  NodeWebSocketServerProvider,
} from "#veryfront/extensions/websocket";

afterAll(() => stopEsbuild());

function createBootstrapResult(
  dispose: () => void | Promise<void>,
): BootstrapResult {
  const adapter = createMockAdapter();
  const config = validateVeryfrontConfig({
    fs: { type: "veryfront-api", veryfront: { proxyMode: true } },
  }) as BootstrapResult["config"];
  return {
    adapter,
    config,
    usingFSAdapter: false,
    extensionLoader: {} as BootstrapResult["extensionLoader"],
    dispose,
  };
}

type PublicOptionsExposeStartupContext = "startupContext" extends keyof StartProductionServerOptions
  ? true
  : false;

const PUBLIC_OPTIONS_EXPOSE_STARTUP_CONTEXT: PublicOptionsExposeStartupContext = false;

describe("resolveProductionBootstrap()", () => {
  it("keeps startup authorization out of the public options and bootstrap call", async () => {
    const adapter = createMockAdapter();
    const bootstrap = createBootstrapResult(() => {});
    let receivedProjectDir: string | undefined;
    let receivedAdapter: RuntimeAdapter | undefined;
    let receivedArgumentCount = 0;

    const result = await resolveProductionBootstrap(
      {
        projectDir: "/local-proxy",
      },
      adapter,
      (...args) => {
        receivedArgumentCount = args.length;
        const [projectDir, candidateAdapter] = args;
        receivedProjectDir = projectDir;
        receivedAdapter = candidateAdapter;
        return Promise.resolve(bootstrap);
      },
    );

    assertEquals(PUBLIC_OPTIONS_EXPOSE_STARTUP_CONTEXT, false);
    assertStrictEquals(result, bootstrap);
    assertEquals(receivedProjectDir, "/local-proxy");
    assertStrictEquals(receivedAdapter, adapter);
    assertEquals(receivedArgumentCount, 2);
  });
});

describe("startProductionServer() lifecycle", () => {
  it("retires the runtime handler after its listener stops", async () => {
    const bootstrap = createBootstrapResult(() => {});
    const runtimeHandlerDisposeStarted = Promise.withResolvers<void>();
    const finishRuntimeHandlerDispose = Promise.withResolvers<void>();
    let runtimeHandlerDisposeCalls = 0;
    bootstrap.adapter.serve = (handler, options) => {
      const ownedHandler = handler as typeof handler & { dispose?: () => Promise<void> };
      const originalDispose = ownedHandler.dispose;
      ownedHandler.dispose = async () => {
        runtimeHandlerDisposeCalls++;
        await originalDispose?.();
        runtimeHandlerDisposeStarted.resolve();
        await finishRuntimeHandlerDispose.promise;
      };
      options.onListen?.({ hostname: "127.0.0.1", port: 4_321 });
      return Promise.resolve({
        addr: { hostname: "127.0.0.1", port: 4_321 },
        stop: () => Promise.resolve(),
      });
    };

    const handle = await startLocalCliProxyProductionServer({
      projectDir: "/project",
      port: 4_321,
      bootstrapResult: bootstrap,
    });
    await handle.ready;
    let stopped = false;
    const stopping = handle.stop().then(() => {
      stopped = true;
    });
    await runtimeHandlerDisposeStarted.promise;
    await Promise.resolve();
    assertEquals(stopped, false);

    finishRuntimeHandlerDispose.resolve();
    await stopping;

    assertEquals(runtimeHandlerDisposeCalls, 1);
    assertEquals(stopped, true);
  });

  it("retains the originally transferred bootstrap disposer across caller mutation", async () => {
    let originalDisposeCalls = 0;
    let replacementDisposeCalls = 0;
    const bootstrap = createBootstrapResult(() => {
      originalDisposeCalls++;
    });
    bootstrap.adapter.serve = (_handler, options) => {
      options.onListen?.({ hostname: "127.0.0.1", port: 4_321 });
      return Promise.resolve({
        addr: { hostname: "127.0.0.1", port: 4_321 },
        stop: () => Promise.resolve(),
      });
    };

    const starting = startLocalCliProxyProductionServer({
      projectDir: "/project",
      port: 4_321,
      bootstrapResult: bootstrap,
    });
    bootstrap.dispose = () => {
      replacementDisposeCalls++;
    };

    const handle = await starting;
    await handle.ready;
    await handle.stop();

    assertEquals([originalDisposeCalls, replacementDisposeCalls], [1, 0]);
  });

  it("pins a supplied Studio capture bundle before asynchronous startup", async () => {
    const originalBundle = "console.log('original Studio capture bundle');";
    const invalidReplacementBundle = "\ud800";
    const suppliedProvider = { browserBundle: originalBundle };
    const baseBootstrap = createBootstrapResult(() => {});
    const bootstrap: BootstrapResult = {
      adapter: baseBootstrap.adapter,
      get config() {
        // This getter runs after snapshotSuppliedBootstrap has accepted the
        // nested provider. Mutating the source here deterministically exposes
        // any implementation that retained the provider by reference.
        suppliedProvider.browserBundle = invalidReplacementBundle;
        return baseBootstrap.config;
      },
      usingFSAdapter: baseBootstrap.usingFSAdapter,
      extensionLoader: baseBootstrap.extensionLoader,
      dispose: baseBootstrap.dispose,
      studioCaptureProvider: suppliedProvider,
    };
    bootstrap.adapter.serve = (_handler, options) => {
      options.onListen?.({ hostname: "127.0.0.1", port: 4_321 });
      return Promise.resolve({
        addr: { hostname: "127.0.0.1", port: 4_321 },
        stop: () => Promise.resolve(),
      });
    };

    const starting = startLocalCliProxyProductionServer({
      projectDir: "/project",
      port: 4_321,
      bootstrapResult: bootstrap,
    });
    const handle = await starting;
    try {
      await handle.ready;
      assertEquals(suppliedProvider.browserBundle, invalidReplacementBundle);
    } finally {
      await handle.stop();
    }
  });

  it("pins a supplied Node WebSocket provider before asynchronous startup", async () => {
    const originalServer = {} as NodeWebSocketServer;
    const suppliedProvider = {
      createServer: () => originalServer,
    };
    const baseBootstrap = createBootstrapResult(() => {});
    const bootstrap: BootstrapResult = {
      adapter: baseBootstrap.adapter,
      get config() {
        // Provider capture must finish before startup reads any remaining
        // caller-owned bootstrap fields.
        suppliedProvider.createServer = () => {
          throw new Error("mutated provider must not run");
        };
        return baseBootstrap.config;
      },
      usingFSAdapter: baseBootstrap.usingFSAdapter,
      extensionLoader: baseBootstrap.extensionLoader,
      dispose: baseBootstrap.dispose,
      nodeWebSocketServerProvider: suppliedProvider,
    };
    let receivedProvider: Readonly<NodeWebSocketServerProvider> | undefined;
    bootstrap.adapter.serve = (_handler, options) => {
      receivedProvider = options.nodeWebSocketServerProvider;
      options.onListen?.({ hostname: "127.0.0.1", port: 4_321 });
      return Promise.resolve({
        addr: { hostname: "127.0.0.1", port: 4_321 },
        stop: () => Promise.resolve(),
      });
    };

    const handle = await startLocalCliProxyProductionServer({
      projectDir: "/project",
      port: 4_321,
      bootstrapResult: bootstrap,
    });
    try {
      await handle.ready;
      assertEquals(receivedProvider === suppliedProvider, false);
      assertEquals(Object.isFrozen(receivedProvider), true);
      assertStrictEquals(
        receivedProvider?.createServer({
          noServer: true,
          handleProtocols: () => false,
        }),
        originalServer,
      );
    } finally {
      await handle.stop();
    }
  });

  it("rejects hostile supplied Studio providers before startup side effects", async () => {
    let getterCalls = 0;
    const accessorProvider = Object.defineProperty({}, "browserBundle", {
      enumerable: true,
      get() {
        getterCalls++;
        return "must not be read";
      },
    });
    const revocable = Proxy.revocable({ browserBundle: "revoked" }, {});
    revocable.revoke();

    for (
      const [provider, expectedMessage] of [
        [accessorProvider, "string data property"],
        [revocable.proxy, "could not be inspected"],
      ] as const
    ) {
      let envReads = 0;
      let serveCalls = 0;
      let disposeCalls = 0;
      const bootstrap = {
        ...createBootstrapResult(() => {
          disposeCalls++;
        }),
        studioCaptureProvider: provider as BootstrapResult["studioCaptureProvider"],
      } satisfies BootstrapResult;
      const originalEnv = bootstrap.adapter.env;
      bootstrap.adapter.env = {
        get(key) {
          envReads++;
          return originalEnv.get(key);
        },
        set: originalEnv.set.bind(originalEnv),
        toObject: originalEnv.toObject.bind(originalEnv),
      };
      bootstrap.adapter.serve = () => {
        serveCalls++;
        return Promise.reject(new Error("listener must not start"));
      };

      await assertRejects(
        () =>
          startLocalCliProxyProductionServer({
            projectDir: "/project",
            port: 4_321,
            bootstrapResult: bootstrap,
          }),
        TypeError,
        expectedMessage,
      );
      assertEquals([envReads, serveCalls, disposeCalls], [0, 0, 0]);
    }
    assertEquals(getterCalls, 0);
  });

  it("rejects noncanonical and oversized supplied Studio bundles before ownership", async () => {
    const invalidBundles = [
      ["\ufeffconsole.log('BOM')", TypeError, "must not start with a BOM"],
      ["console.log('\0')", TypeError, "must not contain NUL"],
      ["\ud800", TypeError, "canonical Unicode"],
      [
        "é".repeat(MAX_STUDIO_CAPTURE_BUNDLE_BYTES / 2) + "a",
        RangeError,
        `${MAX_STUDIO_CAPTURE_BUNDLE_BYTES}-byte limit`,
      ],
    ] as const;

    for (const [browserBundle, errorType, expectedMessage] of invalidBundles) {
      let serveCalls = 0;
      let disposeCalls = 0;
      const bootstrap = {
        ...createBootstrapResult(() => {
          disposeCalls++;
        }),
        studioCaptureProvider: { browserBundle },
      } satisfies BootstrapResult;
      bootstrap.adapter.serve = () => {
        serveCalls++;
        return Promise.reject(new Error("listener must not start"));
      };

      const error = await assertRejects(
        () =>
          startLocalCliProxyProductionServer({
            projectDir: "/project",
            port: 4_321,
            bootstrapResult: bootstrap,
          }),
        Error,
        expectedMessage,
      );
      assertInstanceOf(error, errorType);
      assertEquals([serveCalls, disposeCalls], [0, 0]);
    }

    const validBootstrap = createBootstrapResult(() => {});
    validBootstrap.adapter.serve = (_handler, options) => {
      options.onListen?.({ hostname: "127.0.0.1", port: 4_321 });
      return Promise.resolve({
        addr: { hostname: "127.0.0.1", port: 4_321 },
        stop: () => Promise.resolve(),
      });
    };
    const handle = await startLocalCliProxyProductionServer({
      projectDir: "/replacement",
      port: 4_321,
      bootstrapResult: validBootstrap,
    });
    await handle.ready;
    await handle.stop();
  });

  it("rejects a partial primitive generation before opening the listener", async () => {
    let serveCalls = 0;
    let bootstrapDisposeCalls = 0;
    const bootstrap = createBootstrapResult(() => {
      bootstrapDisposeCalls++;
    });
    bootstrap.adapter.serve = () => {
      serveCalls++;
      return Promise.reject(new Error("listener must not start"));
    };
    await bootstrap.adapter.fs.mkdir("/project/prompts", { recursive: true });
    await bootstrap.adapter.fs.writeFile(
      "/project/prompts/broken.ts",
      "export default { description: 'not a prompt' };",
    );

    await assertRejects(
      () =>
        startLocalCliProxyProductionServer({
          projectDir: "/project",
          port: 4_321,
          bootstrapResult: bootstrap,
          discoveryConfig: {
            baseDir: "/project",
            fsAdapter: bootstrap.adapter.fs,
          },
        }),
      Error,
      "Discovery generation rejected with 1 error",
    );

    assertEquals(serveCalls, 0);
    assertEquals(bootstrapDisposeCalls, 1);
  });

  it("validates a supplied bootstrap before touching resources or acquiring ownership", async () => {
    let serveCalls = 0;
    let bootstrapDisposeCalls = 0;
    const rejectedBootstrap = createBootstrapResult(() => {
      bootstrapDisposeCalls++;
    });
    rejectedBootstrap.adapter.serve = () => {
      serveCalls++;
      return Promise.reject(
        new Error("serve must not run before hosted validation"),
      );
    };

    await withEnv(
      {
        PROXY_MODE: "1",
        NODE_ENV: "development",
        CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: "",
      },
      async () => {
        await assertRejects(
          () =>
            startProductionServer({
              projectDir: "/hosted-proxy",
              port: 4_321,
              adapter: rejectedBootstrap.adapter,
              bootstrapResult: rejectedBootstrap,
            }),
          Error,
          "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY must be set",
        );
      },
    );

    assertEquals(serveCalls, 0);
    assertEquals(bootstrapDisposeCalls, 0);

    const acceptedBootstrap = createBootstrapResult(() => {
      bootstrapDisposeCalls++;
    });
    acceptedBootstrap.adapter.serve = (_handler, options) => {
      serveCalls++;
      options.onListen?.({ hostname: "127.0.0.1", port: 4_321 });
      return Promise.resolve({
        addr: { hostname: "127.0.0.1", port: 4_321 },
        stop: () => Promise.resolve(),
      });
    };

    await withEnv(
      {
        PROXY_MODE: "0",
        NODE_ENV: "development",
        CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: "",
      },
      async () => {
        const handle = await startProductionServer({
          projectDir: "/standalone",
          port: 4_321,
          adapter: acceptedBootstrap.adapter,
          bootstrapResult: acceptedBootstrap,
        });
        await handle.ready;
        await handle.stop();
      },
    );

    assertEquals(serveCalls, 1);
    assertEquals(bootstrapDisposeCalls, 1);
  });

  it("allows a supplied bootstrap only through the private local CLI port", async () => {
    let serveCalls = 0;
    let bootstrapDisposeCalls = 0;
    const bootstrap = createBootstrapResult(() => {
      bootstrapDisposeCalls++;
    });
    bootstrap.adapter.serve = (_handler, options) => {
      serveCalls++;
      options.onListen?.({ hostname: "127.0.0.1", port: 4_321 });
      return Promise.resolve({
        addr: { hostname: "127.0.0.1", port: 4_321 },
        stop: () => Promise.resolve(),
      });
    };

    await withEnv(
      {
        PROXY_MODE: "1",
        NODE_ENV: "development",
        CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: "",
      },
      async () => {
        const handle = await startLocalCliProxyProductionServer({
          projectDir: "/local-proxy",
          port: 4_321,
          adapter: bootstrap.adapter,
          bootstrapResult: bootstrap,
        });
        await handle.ready;
        await handle.stop();
      },
    );

    assertEquals(serveCalls, 1);
    assertEquals(bootstrapDisposeCalls, 1);
  });

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

  it("snapshots caller options before ownership and releases after later startup failure", async () => {
    let portReads = 0;
    let bootstrapDisposeCalls = 0;
    const rejectedBootstrap = createBootstrapResult(() => {
      bootstrapDisposeCalls++;
    });
    rejectedBootstrap.adapter.serve = () => Promise.reject(new Error("listen-boom"));

    await assertRejects(
      () =>
        startProductionServer({
          projectDir: "/getter-project",
          get port() {
            portReads++;
            if (portReads > 1) {
              throw new Error("port getter read more than once");
            }
            return 4_321;
          },
          bootstrapResult: rejectedBootstrap,
        }),
      Error,
      "listen-boom",
    );

    assertEquals(portReads, 1);
    assertEquals(bootstrapDisposeCalls, 1);

    const acceptedBootstrap = createBootstrapResult(() => {});
    acceptedBootstrap.adapter.serve = (_handler, options) => {
      options.onListen?.({ hostname: "127.0.0.1", port: 4_322 });
      return Promise.resolve({
        addr: { hostname: "127.0.0.1", port: 4_322 },
        stop: () => Promise.resolve(),
      });
    };
    const replacement = await startProductionServer({
      projectDir: "/replacement",
      port: 4_322,
      bootstrapResult: acceptedBootstrap,
    });
    await replacement.ready;
    await replacement.stop();
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

describe("createRetryableProductionShutdownHandler()", () => {
  it("shares an attempt, resets after failure, and latches success", async () => {
    const firstFailure = new Error("cleanup incomplete");
    const signals: Array<"SIGINT" | "SIGTERM"> = [];
    const shutdown = createRetryableProductionShutdownHandler((signal) => {
      signals.push(signal);
      return signals.length === 1 ? Promise.reject(firstFailure) : Promise.resolve();
    });

    const first = shutdown("SIGTERM");
    assertStrictEquals(shutdown("SIGINT"), first);
    await assertRejects(() => first, Error, "cleanup incomplete");

    const retry = shutdown("SIGINT");
    await retry;
    assertStrictEquals(shutdown("SIGTERM"), retry);
    assertEquals(signals, ["SIGTERM", "SIGINT"]);
  });
});

describe("runProductionShutdownWithDiagnostics()", () => {
  it("captures cleanup failure before flushing diagnostics", async () => {
    const cleanupFailure = new Error("cleanup incomplete");
    const events: string[] = [];
    let received: unknown;

    try {
      await runProductionShutdownWithDiagnostics({
        performShutdown: () => {
          events.push("cleanup");
          return Promise.reject(cleanupFailure);
        },
        captureApplicationError: (_error, context) => {
          events.push(`capture:${context.boundary}`);
        },
        flushApplicationErrors: () => {
          events.push("flush");
          return Promise.resolve(true);
        },
        logger: { warn: () => {} },
      });
    } catch (error) {
      received = error;
    }

    assertStrictEquals(received, cleanupFailure);
    assertEquals(events, ["cleanup", "capture:process.shutdown", "flush"]);
  });

  it("combines cleanup and flush failures in phase order", async () => {
    for (const incompleteFlush of [false, true]) {
      const cleanupFailure = new Error("cleanup incomplete");
      const flushFailure = new Error("flush failed");
      const capturedBoundaries: string[] = [];
      let received: unknown;

      try {
        await runProductionShutdownWithDiagnostics({
          performShutdown: () => Promise.reject(cleanupFailure),
          captureApplicationError: (_error, context) => {
            capturedBoundaries.push(context.boundary);
          },
          flushApplicationErrors: () =>
            incompleteFlush ? Promise.resolve(false) : Promise.reject(flushFailure),
          logger: { warn: () => {} },
        });
      } catch (error) {
        received = error;
      }

      assertInstanceOf(received, AggregateError);
      assertEquals(received.errors.length, 2);
      assertStrictEquals(received.errors[0], cleanupFailure);
      if (incompleteFlush) {
        assertEquals(
          received.errors[1] instanceof Error ? received.errors[1].message : undefined,
          "Application error diagnostics did not flush completely",
        );
      } else {
        assertStrictEquals(received.errors[1], flushFailure);
      }
      assertEquals(capturedBoundaries, [
        "process.shutdown",
        "process.shutdown.flush",
      ]);
    }
  });
});

describe("flushProductionShutdownDiagnostics()", () => {
  it("warns and rejects when application-error flushing is incomplete", async () => {
    const warnings: unknown[][] = [];

    await assertRejects(
      () =>
        flushProductionShutdownDiagnostics(
          () => Promise.resolve(false),
          { warn: (...args) => warnings.push(args) },
        ),
      Error,
      "Application error diagnostics did not flush completely",
    );

    assertEquals(warnings.length, 1);
  });
});
