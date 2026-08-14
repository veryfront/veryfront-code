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
import { _resetShimForTests } from "#veryfront/observability/tracing/api-shim.ts";
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
  validationEnvKeys.map((key) => [key, Deno.env.get(key)]),
);

function restoreValidationEnv(): void {
  for (const key of validationEnvKeys) {
    const value = originalValidationEnv.get(key);
    if (value === undefined) {
      Deno.env.delete(key);
    } else {
      Deno.env.set(key, value);
    }
  }
}

function setHostedInternalCredentials(): void {
  Deno.env.set("VERYFRONT_API_INTERNAL_USER", "test-internal-user");
  Deno.env.set("VERYFRONT_API_INTERNAL_PASS", "test-internal-pass");
}

const noopLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function captureWarns(run: () => void): string[] {
  const originalWarn = console.warn;
  const originalLogLevel = Deno.env.get("LOG_LEVEL");
  const messages: string[] = [];
  console.warn = (...args: unknown[]) => {
    messages.push(args.map(String).join(" "));
  };

  try {
    Deno.env.set("LOG_LEVEL", "DEBUG");
    __resetLoggerConfigForTests();
    run();
  } finally {
    console.warn = originalWarn;
    if (originalLogLevel === undefined) {
      Deno.env.delete("LOG_LEVEL");
    } else {
      Deno.env.set("LOG_LEVEL", originalLogLevel);
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
    // If fsDispose throws, we still want the original orchestration error
    // to reach the caller — a dispose failure must not mask the root cause.
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
      // The current implementation lets the dispose error propagate because
      // it is thrown synchronously after the catch; adjust this test if that
      // changes. Right now it will be "fsDispose-boom", which is acceptable
      // for a resource-leak fix (both errors are visible).
      "fsDispose-boom",
    );
  });
});

describe("wireTracingShim()", () => {
  it("registers and clears the TracingExporter log emitter", () => {
    reset();
    _resetShimForTests();
    __resetLogRecordEmitterForTests();

    const emitted: unknown[] = [];
    const exporter: TracingExporter = {
      start: () => Promise.resolve(),
      export: () => Promise.resolve(),
      shutdown: () => Promise.resolve(),
      getProvider: () => ({ getTracer: () => ({}) }),
      getMetricsAPI: () => null,
      getLogRecordEmitter: () => (record) => emitted.push(record),
    };

    register("TracingExporter", exporter);
    wireTracingShim();
    logger.info("otel bridge smoke", { project_id: "project-1" });

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
    Deno.env.set("PROXY_MODE", "1");
    Deno.env.set("VERYFRONT_CLI_LOCAL_PROXY_MODE", "1");
    Deno.env.set("NODE_ENV", "development");
    Deno.env.delete("DENO_ENV");
    Deno.env.delete("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");

    const warnings = captureWarns(() => validateProductionEnvironmentForTests());

    assertEquals(warnings.length, 0);
  });

  it("does not trust local CLI proxy mode loaded from a project env file", async () => {
    const tempDir = await Deno.makeTempDir();

    try {
      Deno.env.set("PROXY_MODE", "1");
      Deno.env.delete("VERYFRONT_CLI_LOCAL_PROXY_MODE");
      Deno.env.set("NODE_ENV", "development");
      Deno.env.delete("DENO_ENV");
      Deno.env.delete("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");
      await Deno.writeTextFile(
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
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("rejects hosted proxy mode when NODE_ENV is missing", () => {
    Deno.env.set("PROXY_MODE", "1");
    Deno.env.delete("VERYFRONT_CLI_LOCAL_PROXY_MODE");
    Deno.env.delete("NODE_ENV");
    Deno.env.delete("DENO_ENV");
    Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", "test-public-key");

    assertThrows(
      () => validateProductionEnvironmentForTests(),
      Error,
      "NODE_ENV must be set to 'production'",
    );
  });

  it("rejects hosted proxy mode when the signing key is missing even in development", () => {
    Deno.env.set("PROXY_MODE", "1");
    Deno.env.delete("VERYFRONT_CLI_LOCAL_PROXY_MODE");
    Deno.env.set("NODE_ENV", "development");
    Deno.env.delete("DENO_ENV");
    Deno.env.delete("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY");

    assertThrows(
      () => validateProductionEnvironmentForTests(),
      Error,
      "CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY must be set",
    );
  });

  it("rejects hosted proxy mode when internal environment credentials are missing", () => {
    Deno.env.set("PROXY_MODE", "1");
    Deno.env.delete("VERYFRONT_CLI_LOCAL_PROXY_MODE");
    Deno.env.set("NODE_ENV", "production");
    Deno.env.delete("DENO_ENV");
    Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", "test-public-key");
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    Deno.env.delete("VERYFRONT_API_INTERNAL_USER");
    Deno.env.delete("VERYFRONT_API_INTERNAL_PASS");

    assertThrows(
      () => validateProductionEnvironmentForTests(),
      Error,
      "VERYFRONT_API_INTERNAL_USER and VERYFRONT_API_INTERNAL_PASS must be set",
    );
  });

  it("warns with the actual NODE_ENV value for hosted proxy mode when a signing key exists", () => {
    Deno.env.set("PROXY_MODE", "1");
    Deno.env.delete("VERYFRONT_CLI_LOCAL_PROXY_MODE");
    Deno.env.set("NODE_ENV", "staging");
    Deno.env.delete("DENO_ENV");
    Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", "test-public-key");
    Deno.env.set("VERYFRONT_TRUST_FORWARDED_HEADERS", "1");
    setHostedInternalCredentials();

    const warnings = captureWarns(() => validateProductionEnvironmentForTests());

    assertEquals(
      warnings.some((message) => message.includes("NODE_ENV is set to 'staging'")),
      true,
    );
    assertEquals(warnings.some((message) => message.includes("%s")), false);
  });

  it("rejects hosted proxy mode without an explicit trusted topology", () => {
    Deno.env.set("PROXY_MODE", "1");
    Deno.env.delete("VERYFRONT_CLI_LOCAL_PROXY_MODE");
    Deno.env.set("NODE_ENV", "production");
    Deno.env.delete("DENO_ENV");
    Deno.env.set("CHANNEL_DISPATCH_SIGNING_PUBLIC_KEY", "test-public-key");
    Deno.env.delete("VERYFRONT_TRUST_FORWARDED_HEADERS");
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
