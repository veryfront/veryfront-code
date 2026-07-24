import "#veryfront/schemas/_test-setup.ts";
/**
 * Bootstrap unit tests — narrow coverage of the orchestrate/dispose seam.
 *
 * The full `bootstrap()` function requires substantial plumbing (config
 * loading, env, FS adapter wiring) and is covered by the integration test
 * plan (see PR 5). These tests target the extracted `orchestrateOrDisposeFS`
 * helper directly so we can verify the fsDispose guarantee on orchestration
 * failure without fabricating the whole bootstrap environment.
 */

import {
  assertEquals,
  assertNotStrictEquals,
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { _resetEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import {
  _resetShimForTests,
  getGlobalTelemetryAPISnapshot,
  type GlobalTelemetryAPISnapshot,
} from "#veryfront/observability/tracing/api-shim.ts";
import { createMockAdapter } from "#veryfront/platform/adapters/mock.ts";
import { deleteEnv, getEnv } from "#veryfront/platform/compat/process.ts";
import { register, reset } from "#veryfront/extensions/contracts.ts";
import { runWithProjectEnv } from "#veryfront/server/project-env/storage.ts";
import { withEnv } from "#veryfront/testing/deno-compat.ts";
import { __resetEnvLoaderForTests, hasEnvLoaded } from "#veryfront/utils/env-loader.ts";
import { __resetLogRecordEmitterForTests, logger } from "#veryfront/utils/logger/index.ts";
import type { TracingExporter } from "veryfront/extensions/observability";
import {
  bootstrap,
  createRetryableDisposer,
  createStartupFailureCleanup,
  ensureEnvLoaded,
  orchestrateOrDisposeFS,
  replaceLifecycleResource,
  validateProductionEnvironment,
  wireTracingShim,
} from "./bootstrap.ts";
import { ExtensionLoader } from "veryfront/extensions";

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("validateProductionEnvironment()", () => {
  it("rejects a hosted proxy whose host NODE_ENV is not production", async () => {
    await withEnv(
      {
        PROXY_MODE: "1",
        NODE_ENV: "development",
        CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: "host-public-key",
      },
      async () => {
        assertThrows(
          () => validateProductionEnvironment(),
          Error,
          "NODE_ENV must be set to 'production'",
        );
      },
    );
  });

  it("rejects a hosted proxy without a signing key regardless of NODE_ENV", async () => {
    for (const nodeEnv of ["development", "production"]) {
      await withEnv(
        {
          PROXY_MODE: "1",
          NODE_ENV: nodeEnv,
          CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: "",
        },
        async () => {
          assertThrows(
            () => validateProductionEnvironment(),
            Error,
            "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY must be set",
          );
        },
      );
    }
  });

  it("does not let a tenant environment overlay replace hosted runtime settings", async () => {
    await withEnv(
      {
        PROXY_MODE: "1",
        NODE_ENV: "development",
        CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: "host-public-key",
      },
      async () => {
        runWithProjectEnv(
          {
            PROXY_MODE: "0",
            NODE_ENV: "production",
            CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: "tenant-public-key",
          },
          () => {
            assertThrows(
              () => validateProductionEnvironment(),
              Error,
              "NODE_ENV must be set to 'production'",
            );
          },
        );
      },
    );
  });

  it("does not let a caller-provided local proxy claim bypass hosted validation", async () => {
    await withEnv(
      {
        PROXY_MODE: "1",
        NODE_ENV: "development",
        CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY: "",
      },
      async () => {
        assertThrows(
          () =>
            (
              validateProductionEnvironment as unknown as (
                startupClaim: unknown,
              ) => void
            )({ kind: "local-cli-proxy" }),
          Error,
          "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY must be set",
        );
      },
    );
  });
});

describe("ensureEnvLoaded()", () => {
  it("rejects malformed files without marking the environment loaded and permits retry", async () => {
    const projectDir = await Deno.makeTempDir({ prefix: "bootstrap-env-" });
    const key = `VERYFRONT_BOOTSTRAP_ENV_${Date.now()}`;

    try {
      __resetEnvLoaderForTests();
      _resetEnvironmentConfig();
      await Deno.writeTextFile(`${projectDir}/.env`, `${key}="unterminated`);

      await assertRejects(
        () => ensureEnvLoaded(projectDir, createMockAdapter()),
        Error,
        "Unterminated quoted environment value",
      );
      assertEquals(hasEnvLoaded(), false);
      assertEquals(getEnv(key), undefined);

      await Deno.writeTextFile(`${projectDir}/.env`, `${key}=recovered`);
      await ensureEnvLoaded(projectDir, createMockAdapter());

      assertEquals(hasEnvLoaded(), true);
      assertEquals(getEnv(key), "recovered");
    } finally {
      deleteEnv(key);
      _resetEnvironmentConfig();
      __resetEnvLoaderForTests();
      await Deno.remove(projectDir, { recursive: true });
    }
  });
});

describe("bootstrap() ownership", () => {
  it("releases process ownership when adapter metadata throws before initialization", async () => {
    const adapter = new Proxy(createMockAdapter(), {
      get(target, property, receiver) {
        if (property === "id") {
          throw new Error("adapter id getter failed");
        }
        return Reflect.get(target, property, receiver);
      },
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      await assertRejects(
        () => bootstrap("/metadata-failure", adapter),
        Error,
        "adapter id getter failed",
      );
    }
  });
});

describe("createRetryableDisposer()", () => {
  it("shares an in-flight attempt and permits a retry only after failure", async () => {
    let calls = 0;
    const dispose = createRetryableDisposer(() => {
      calls++;
      if (calls === 1) throw new Error("transient cleanup failure");
    });

    const first = dispose();
    const concurrent = dispose();
    assertStrictEquals(first, concurrent);
    await assertRejects(() => first, Error, "transient cleanup failure");

    const retry = dispose();
    assertNotStrictEquals(retry, first);
    await retry;
    assertStrictEquals(dispose(), retry);
    assertEquals(calls, 2);
  });
});

describe("createStartupFailureCleanup()", () => {
  it("attempts independent resources and retains ownership until failures are retried", async () => {
    let fileLogDisposeCalls = 0;
    let fsDisposeCalls = 0;
    let ownershipReleaseCalls = 0;
    const dispose = createStartupFailureCleanup(
      [
        () => {
          fileLogDisposeCalls++;
          if (fileLogDisposeCalls === 1) {
            throw new Error("transient file-log cleanup failure");
          }
        },
        () => {
          fsDisposeCalls++;
        },
      ],
      () => {
        ownershipReleaseCalls++;
      },
    );

    await assertRejects(dispose, Error, "transient file-log cleanup failure");
    assertEquals(fsDisposeCalls, 1);
    assertEquals(ownershipReleaseCalls, 0);

    await dispose();
    await dispose();
    assertEquals(fileLogDisposeCalls, 2);
    assertEquals(fsDisposeCalls, 1);
    assertEquals(ownershipReleaseCalls, 1);
  });
});

describe("orchestrateOrDisposeFS()", () => {
  it("returns the loader when orchestration succeeds", async () => {
    const loader = new ExtensionLoader(noopLogger);
    let fsDisposed = false;

    const result = await orchestrateOrDisposeFS(
      () => Promise.resolve(loader),
      () => {
        fsDisposed = true;
      },
    );

    assertEquals(result, loader);
    assertEquals(fsDisposed, false);
  });

  it("calls fsDispose and rethrows when orchestration fails", async () => {
    let fsDisposed = false;
    const boom = new Error("orchestrate-boom");

    await assertRejects(
      () =>
        orchestrateOrDisposeFS(
          () => Promise.reject(boom),
          () => {
            fsDisposed = true;
          },
        ),
      Error,
      "orchestrate-boom",
    );

    assertEquals(fsDisposed, true);
  });

  it("does not throw when fsDispose is undefined on failure", async () => {
    await assertRejects(
      () =>
        orchestrateOrDisposeFS(
          () => Promise.reject(new Error("no-dispose")),
          undefined,
        ),
      Error,
      "no-dispose",
    );
  });

  it("preserves the original error when fsDispose itself throws", async () => {
    const originalError = new Error("orchestrate-boom");

    await assertRejects(
      () =>
        orchestrateOrDisposeFS(
          () => Promise.reject(originalError),
          () => {
            throw new Error("fsDispose-boom");
          },
        ),
      Error,
      "orchestrate-boom",
    );
  });
});

describe("replaceLifecycleResource()", () => {
  it("commits disable-to-null only after disposing the old resource", async () => {
    const old = { id: "old" };
    const disposed: string[] = [];

    const result = await replaceLifecycleResource(
      old,
      () => null,
      (resource) => {
        disposed.push(resource.id);
      },
    );

    assertEquals(result, null);
    assertEquals(disposed, ["old"]);
  });

  it("leaves the old resource owned when replacement creation fails", async () => {
    const old = { id: "old" };
    const disposed: string[] = [];

    await assertRejects(
      () =>
        replaceLifecycleResource(
          old,
          () => {
            throw new Error("create replacement failed");
          },
          (resource) => {
            disposed.push(resource.id);
          },
        ),
      Error,
      "create replacement failed",
    );

    assertEquals(disposed, []);
  });

  it("rolls back a prepared replacement when retiring the old resource fails", async () => {
    const old = { id: "old" };
    const replacement = { id: "replacement" };
    const disposed: string[] = [];

    await assertRejects(
      () =>
        replaceLifecycleResource(
          old,
          () => replacement,
          (resource) => {
            disposed.push(resource.id);
            if (resource === old) throw new Error("old cleanup failed");
          },
        ),
      Error,
      "old cleanup failed",
    );

    assertEquals(disposed, ["old", "replacement"]);
  });
});

describe("wireTracingShim()", () => {
  function createExporter(label: string, emitted: string[]) {
    const tracerProvider = {
      getTracer: () => ({ label }),
    } as unknown as GlobalTelemetryAPISnapshot["tracerProvider"];
    const metricsApi = {
      getMeter: () => ({ label }),
    } as unknown as NonNullable<GlobalTelemetryAPISnapshot["metricsApi"]>;
    const activeSpanAccessor = {
      getActiveSpan: () => ({ label }),
      getSpan: () => ({ label }),
      setSpan: (context: unknown) => context,
    } as unknown as NonNullable<GlobalTelemetryAPISnapshot["activeSpanAccessor"]>;
    const contextAccessor = {
      active: () => ({ label }),
      with: <T>(_context: unknown, fn: () => T): T => fn(),
    } as unknown as NonNullable<GlobalTelemetryAPISnapshot["contextAccessor"]>;
    const exporter: TracingExporter = {
      start: () => Promise.resolve(),
      export: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
      getProvider: () => tracerProvider,
      getMetricsAPI: () => metricsApi,
      getTraceAPI: () =>
        activeSpanAccessor as unknown as NonNullable<
          ReturnType<NonNullable<TracingExporter["getTraceAPI"]>>
        >,
      getContextAPI: () => contextAccessor,
      getLogRecordEmitter: () => (record) => emitted.push(`${label}:${record.message}`),
    };
    return {
      activeSpanAccessor,
      contextAccessor,
      exporter,
      metricsApi,
      tracerProvider,
    };
  }

  function resetTelemetryTestState(): void {
    reset();
    _resetShimForTests();
    __resetLogRecordEmitterForTests();
  }

  it("replaces exporter A with a fresh no-op generation", () => {
    resetTelemetryTestState();

    const emitted: string[] = [];
    const a = createExporter("A", emitted);
    register("TracingExporter", a.exporter);
    const aInstallation = wireTracingShim();

    reset();
    const noExporterInstallation = wireTracingShim();
    const snapshot = getGlobalTelemetryAPISnapshot();
    logger.info("after no-exporter install");

    assertNotStrictEquals(snapshot.tracerProvider, a.tracerProvider);
    assertEquals(snapshot.metricsApi, null);
    assertEquals(snapshot.contextAccessor, null);
    assertEquals(snapshot.activeSpanAccessor, null);
    assertEquals(emitted, []);
    assertEquals(aInstallation.dispose(), false);
    assertEquals(noExporterInstallation.dispose(), true);
    resetTelemetryTestState();
  });

  it("keeps exporter B installed when stale exporter A is disposed", () => {
    resetTelemetryTestState();

    const emitted: string[] = [];
    const a = createExporter("A", emitted);
    const b = createExporter("B", emitted);
    register("TracingExporter", a.exporter);
    const aInstallation = wireTracingShim();

    register("TracingExporter", b.exporter);
    const bInstallation = wireTracingShim();
    assertEquals(aInstallation.dispose(), false);

    const snapshot = getGlobalTelemetryAPISnapshot();
    assertStrictEquals(snapshot.tracerProvider, b.tracerProvider);
    assertStrictEquals(snapshot.metricsApi, b.metricsApi);
    assertStrictEquals(snapshot.contextAccessor, b.contextAccessor);
    assertStrictEquals(snapshot.activeSpanAccessor, b.activeSpanAccessor);

    logger.info("owned by B");
    assertEquals(emitted, ["B:owned by B"]);
    assertEquals(bInstallation.dispose(), true);
    assertNotStrictEquals(getGlobalTelemetryAPISnapshot().tracerProvider, b.tracerProvider);
    logger.info("after B disposal");
    assertEquals(emitted, ["B:owned by B"]);
    resetTelemetryTestState();
  });

  it("leaves exporter A intact when an exporter B getter throws", () => {
    resetTelemetryTestState();

    const emitted: string[] = [];
    const a = createExporter("A", emitted);
    const b = createExporter("B", emitted);
    const brokenB: TracingExporter = {
      ...b.exporter,
      getContextAPI: () => {
        throw new Error("context-getter-boom");
      },
    };
    register("TracingExporter", a.exporter);
    const aInstallation = wireTracingShim();
    const before = getGlobalTelemetryAPISnapshot();

    register("TracingExporter", brokenB);
    assertThrows(wireTracingShim, Error, "context-getter-boom");

    const after = getGlobalTelemetryAPISnapshot();
    assertStrictEquals(after.generation, before.generation);
    assertStrictEquals(after.tracerProvider, a.tracerProvider);
    assertStrictEquals(after.metricsApi, a.metricsApi);
    assertStrictEquals(after.contextAccessor, a.contextAccessor);
    assertStrictEquals(after.activeSpanAccessor, a.activeSpanAccessor);

    logger.info("still owned by A");
    assertEquals(emitted, ["A:still owned by A"]);

    assertEquals(aInstallation.dispose(), true);
    resetTelemetryTestState();
  });
});
