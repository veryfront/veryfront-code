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
  assertRejects,
  assertStrictEquals,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import {
  deleteEnv,
  getEnv,
  makeTempDir,
  remove,
  setEnv,
  writeTextFile,
} from "#veryfront/testing/deno-compat.ts";
import {
  _resetShimForTests,
  getGlobalMetricsAPI,
  getGlobalTelemetryAPISnapshot,
  getGlobalTracerProvider,
} from "#veryfront/observability/tracing/api-shim.ts";
import { register, reset } from "#veryfront/extensions/contracts.ts";
import {
  __resetLoggerConfigForTests,
  __resetLogRecordEmitterForTests,
  logger,
} from "#veryfront/utils/logger/index.ts";
import { __resetEnvLoaderForTests, loadEnv } from "#veryfront/utils/env-loader.ts";
import type { TracingExporter } from "veryfront/extensions/observability";
import type { NodeWebSocketServer } from "#veryfront/extensions/websocket";
import { NodeWebSocketServerProviderName } from "#veryfront/extensions/websocket";
import {
  type FileLogHandle,
  orchestrateOrDisposeFS,
  resolveNodeWebSocketServerProviderForBootstrap,
  teardownFileLog,
  validateProductionEnvironmentForTests,
  wireTracingShim,
} from "./bootstrap.ts";
import { ExtensionLoader } from "veryfront/extensions";

const validationEnvKeys = [
  "NODE_ENV",
  "DENO_ENV",
  "PROXY_MODE",
  "VERYFRONT_CLI_LOCAL_PROXY_MODE",
  "VERYFRONT_API_INTERNAL_USER",
  "VERYFRONT_API_INTERNAL_PASS",
  "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY",
  "VERYFRONT_TRUST_FORWARDED_HEADERS",
] as const;
const originalValidationEnv = new Map(
  validationEnvKeys.map((key) => [key, getEnv(key)]),
);

function restoreValidationEnv(): void {
  for (const key of validationEnvKeys) {
    const value = originalValidationEnv.get(key);
    if (value === undefined) {
      deleteEnv(key);
    } else {
      setEnv(key, value);
    }
  }
}

function setHostedInternalCredentials(): void {
  setEnv("VERYFRONT_API_INTERNAL_USER", "test-internal-user");
  setEnv("VERYFRONT_API_INTERNAL_PASS", "test-internal-pass");
}

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function captureWarns(run: () => void): string[] {
  const originalWarn = console.warn;
  const originalLogLevel = getEnv("LOG_LEVEL");
  const messages: string[] = [];
  console.warn = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };

  try {
    setEnv("LOG_LEVEL", "DEBUG");
    __resetLoggerConfigForTests();
    run();
  } finally {
    console.warn = originalWarn;
    if (originalLogLevel === undefined) {
      deleteEnv("LOG_LEVEL");
    } else {
      setEnv("LOG_LEVEL", originalLogLevel);
    }
    __resetLoggerConfigForTests();
  }

  return messages;
}

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
    const disposeError = new Error("fsDispose-boom");

    const rejected = await assertRejects(
      () =>
        orchestrateOrDisposeFS(
          () => Promise.reject(originalError),
          () => {
            throw disposeError;
          },
        ),
      Error,
      "orchestrate-boom",
    );

    assertStrictEquals(
      rejected,
      originalError,
      "a dispose failure must not mask the orchestration root cause",
    );
  });
});

describe("wireTracingShim()", () => {
  it("registers and clears the TracingExporter log emitter", () => {
    reset();
    _resetShimForTests();
    __resetLogRecordEmitterForTests();

    const emitted: unknown[] = [];
    const provider = { getTracer: () => ({}) };
    const metricsApi = { getMeter: () => ({}) };
    const traceApi = {
      getActiveSpan: () => null,
      getSpan: () => null,
      setSpan: (ctx: unknown) => ctx,
    };
    const contextApi = {
      active: () => ({}),
      with: <T>(_ctx: unknown, fn: () => T) => fn(),
    };
    const exporter: TracingExporter = {
      start: () => Promise.resolve(),
      export: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
      getProvider: () => provider,
      getMetricsAPI: () => metricsApi,
      getTraceAPI: () => traceApi,
      getContextAPI: () => contextApi,
      getLogRecordEmitter: () => (record) => emitted.push(record),
    };

    register("TracingExporter", exporter);
    wireTracingShim();
    logger.info("otel bridge smoke", { project_id: "project-1" });

    assertStrictEquals(
      getGlobalTracerProvider() as unknown,
      provider,
      "bootstrap installs the exporter's tracer provider",
    );
    assertStrictEquals(
      getGlobalMetricsAPI() as unknown,
      metricsApi,
      "bootstrap installs the exporter's metrics API",
    );
    const snapshot = getGlobalTelemetryAPISnapshot();
    assertStrictEquals(
      snapshot.activeSpanAccessor as unknown,
      traceApi,
      "bootstrap installs the exporter's active-span accessor",
    );
    assertStrictEquals(
      snapshot.contextAccessor as unknown,
      contextApi,
      "bootstrap installs the exporter's context accessor",
    );

    assertEquals(emitted.length, 1);
    assertEquals((emitted[0] as { message: string }).message, "otel bridge smoke");

    reset();
    wireTracingShim();
    logger.info("after bridge clear");

    assertEquals(emitted.length, 1);
    _resetShimForTests();
    __resetLogRecordEmitterForTests();
  });
});

describe("Node WebSocket bootstrap contract", () => {
  it("captures the explicitly registered provider generation", () => {
    reset();
    const originalServer = {} as NodeWebSocketServer;
    const source = {
      createServer: () => originalServer,
    };
    register(NodeWebSocketServerProviderName, source);

    try {
      const captured = resolveNodeWebSocketServerProviderForBootstrap();
      source.createServer = () => {
        throw new Error("mutated provider must not run");
      };

      assertStrictEquals(
        captured?.createServer({ noServer: true, handleProtocols: () => false }),
        originalServer,
      );
      assertEquals(Object.isFrozen(captured), true);
    } finally {
      reset();
    }
  });
});

describe("validateProductionEnvironmentForTests()", () => {
  afterEach(() => {
    restoreValidationEnv();
    __resetEnvLoaderForTests();
    __resetLoggerConfigForTests();
  });

  it("accepts explicit local CLI proxy mode without NODE_ENV production or a signing key", () => {
    setEnv("PROXY_MODE", "1");
    setEnv("VERYFRONT_CLI_LOCAL_PROXY_MODE", "1");
    setEnv("NODE_ENV", "development");
    deleteEnv("DENO_ENV");
    deleteEnv("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");

    const warnings = captureWarns(() => validateProductionEnvironmentForTests());

    assertEquals(warnings.length, 0);
  });

  it("does not trust local CLI proxy mode loaded from a project env file", async () => {
    const tempDir = await makeTempDir();

    try {
      setEnv("PROXY_MODE", "1");
      deleteEnv("VERYFRONT_CLI_LOCAL_PROXY_MODE");
      setEnv("NODE_ENV", "development");
      deleteEnv("DENO_ENV");
      deleteEnv("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
      await writeTextFile(
        `${tempDir}/.env`,
        "VERYFRONT_CLI_LOCAL_PROXY_MODE=1\n",
      );
      __resetEnvLoaderForTests();
      await loadEnv({ cwd: tempDir });

      assertThrows(
        () => validateProductionEnvironmentForTests(),
        Error,
        "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY must be set",
      );
    } finally {
      await remove(tempDir, { recursive: true });
    }
  });

  it("rejects hosted proxy mode when NODE_ENV is missing", () => {
    setEnv("PROXY_MODE", "1");
    deleteEnv("VERYFRONT_CLI_LOCAL_PROXY_MODE");
    deleteEnv("NODE_ENV");
    deleteEnv("DENO_ENV");
    setEnv("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", "test-public-key");

    assertThrows(
      () => validateProductionEnvironmentForTests(),
      Error,
      "NODE_ENV must be set to 'production'",
    );
  });

  it("rejects hosted proxy mode when the signing key is missing even in development", () => {
    setEnv("PROXY_MODE", "1");
    deleteEnv("VERYFRONT_CLI_LOCAL_PROXY_MODE");
    setEnv("NODE_ENV", "development");
    deleteEnv("DENO_ENV");
    deleteEnv("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");

    assertThrows(
      () => validateProductionEnvironmentForTests(),
      Error,
      "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY must be set",
    );
  });

  it("rejects hosted proxy mode when internal environment credentials are missing", () => {
    setEnv("PROXY_MODE", "1");
    deleteEnv("VERYFRONT_CLI_LOCAL_PROXY_MODE");
    setEnv("NODE_ENV", "production");
    deleteEnv("DENO_ENV");
    setEnv("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", "test-public-key");
    setEnv("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    deleteEnv("VERYFRONT_API_INTERNAL_USER");
    deleteEnv("VERYFRONT_API_INTERNAL_PASS");

    assertThrows(
      () => validateProductionEnvironmentForTests(),
      Error,
      "VERYFRONT_API_INTERNAL_USER and VERYFRONT_API_INTERNAL_PASS must be set",
    );
  });

  it("warns with the actual NODE_ENV value for hosted proxy mode when a signing key exists", () => {
    setEnv("PROXY_MODE", "1");
    deleteEnv("VERYFRONT_CLI_LOCAL_PROXY_MODE");
    setEnv("NODE_ENV", "staging");
    deleteEnv("DENO_ENV");
    setEnv("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", "test-public-key");
    setEnv("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    setHostedInternalCredentials();

    const warnings = captureWarns(() => validateProductionEnvironmentForTests());

    assertEquals(
      warnings.some((message) => message.includes("NODE_ENV is set to 'staging'")),
      true,
    );
    assertEquals(warnings.some((message) => message.includes("%s")), false);
  });

  it("rejects hosted proxy mode without an explicit trusted topology", () => {
    setEnv("PROXY_MODE", "1");
    deleteEnv("VERYFRONT_CLI_LOCAL_PROXY_MODE");
    setEnv("NODE_ENV", "production");
    deleteEnv("DENO_ENV");
    setEnv("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", "test-public-key");
    deleteEnv("VERYFRONT_TRUST_FORWARDED_HEADERS");
    setHostedInternalCredentials();

    assertThrows(
      () => validateProductionEnvironmentForTests(),
      Error,
      "VERYFRONT_TRUST_FORWARDED_HEADERS must be exactly '1'",
    );
  });
});

describe("teardownFileLog()", () => {
  function createHandle(
    close: () => Promise<void>,
    unsubscribe: () => void = () => {},
  ): FileLogHandle {
    return { subscriber: { close }, unsubscribe } as unknown as FileLogHandle;
  }

  it("does not propagate a rejecting subscriber close", async () => {
    let unsubscribed = 0;
    const handle = createHandle(
      () => Promise.reject(new Error("retained file-log write failure")),
      () => {
        unsubscribed += 1;
      },
    );

    await teardownFileLog(handle);

    assertEquals(unsubscribed, 1);
  });

  it("still closes the subscriber when unsubscribe throws", async () => {
    let closed = 0;
    const handle = createHandle(
      () => {
        closed += 1;
        return Promise.resolve();
      },
      () => {
        throw new Error("unsubscribe failed");
      },
    );

    await teardownFileLog(handle);

    assertEquals(closed, 1);
  });

  it("ignores a missing handle", async () => {
    await teardownFileLog(null);
  });
});
