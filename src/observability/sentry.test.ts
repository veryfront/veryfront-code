import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  type ApplicationErrorContext,
  type ApplicationErrorReporter,
  captureApplicationError,
  flushApplicationErrors,
} from "./application-errors.ts";
import {
  initializeSentry,
  initializeSentryFromEnv,
  isSentryEnabled,
  resetSentryForTests,
  resolveSentryConfigFromEnv,
} from "./sentry.ts";

function createSentryExtension() {
  const state = {
    captured: [] as Array<{ error: unknown; context: ApplicationErrorContext }>,
    config: undefined as Record<string, string> | undefined,
    flushTimeouts: [] as Array<number | undefined>,
  };
  const extension = {
    createSentryApplicationErrorReporter(config: Record<string, string>): ApplicationErrorReporter {
      state.config = config;
      return {
        capture(error, context) {
          state.captured.push({ error, context });
          return "event-id";
        },
        flush(timeoutMs?: number) {
          state.flushTimeouts.push(timeoutMs);
          return Promise.resolve(true);
        },
      };
    },
  };
  return {
    load: () => Promise.resolve(extension),
    state,
  };
}

describe("observability/sentry", () => {
  it("Sentry stays disabled without a DSN", async () => {
    resetSentryForTests();
    const { load, state } = createSentryExtension();

    assertEquals(await initializeSentry({}, load), false);
    assertEquals(state.config, undefined);
  });

  it("Sentry enablement requires an explicit true value", () => {
    assertEquals(isSentryEnabled("true"), true);
    assertEquals(isSentryEnabled(" 1 "), true);
    assertEquals(isSentryEnabled("false"), false);
    assertEquals(isSentryEnabled("0"), false);
    assertEquals(isSentryEnabled("enabled"), false);
    assertEquals(isSentryEnabled(undefined), false);
  });

  it("Sentry startup warns once without exposing secrets when explicitly enabled without a DSN", async () => {
    resetSentryForTests();
    const previousEnabled = Deno.env.get("SENTRY_ENABLED");
    const previousProvider = Deno.env.get("VERYFRONT_ERROR_REPORTER");
    const previousDsn = Deno.env.get("SENTRY_DSN");
    const previousAuthToken = Deno.env.get("SENTRY_AUTH_TOKEN");
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    let loadCount = 0;
    const load = () => {
      loadCount += 1;
      return createSentryExtension().load();
    };
    try {
      Deno.env.set("SENTRY_ENABLED", "true");
      Deno.env.set("VERYFRONT_ERROR_REPORTER", "sentry");
      Deno.env.set("SENTRY_DSN", "   ");
      Deno.env.set("SENTRY_AUTH_TOKEN", "super-secret-token");
      console.warn = (...args: unknown[]) => warnings.push(args);

      assertEquals(resolveSentryConfigFromEnv(), undefined);
      assertEquals(resolveSentryConfigFromEnv(), undefined);
      assertEquals(warnings, []);
      assertEquals(
        await Promise.all([
          initializeSentryFromEnv(undefined, load),
          initializeSentryFromEnv(undefined, load),
          initializeSentryFromEnv(undefined, load),
        ]),
        [false, false, false],
      );
      assertEquals(await initializeSentryFromEnv(undefined, load), false);
      assertEquals(loadCount, 0);
      assertEquals(warnings, [[
        "Sentry is enabled, but SENTRY_DSN is empty. Sentry reporting is disabled.",
      ]]);
    } finally {
      console.warn = originalWarn;
      restoreEnv("SENTRY_ENABLED", previousEnabled);
      restoreEnv("VERYFRONT_ERROR_REPORTER", previousProvider);
      restoreEnv("SENTRY_DSN", previousDsn);
      restoreEnv("SENTRY_AUTH_TOKEN", previousAuthToken);
    }
  });

  it("Sentry startup does not warn or load the SDK when disabled or unset without a DSN", async () => {
    resetSentryForTests();
    const previousEnabled = Deno.env.get("SENTRY_ENABLED");
    const previousProvider = Deno.env.get("VERYFRONT_ERROR_REPORTER");
    const previousDsn = Deno.env.get("SENTRY_DSN");
    const originalWarn = console.warn;
    const warnings: unknown[][] = [];
    let loadCount = 0;
    const load = () => {
      loadCount += 1;
      return createSentryExtension().load();
    };
    try {
      Deno.env.set("VERYFRONT_ERROR_REPORTER", "sentry");
      Deno.env.set("SENTRY_DSN", "   ");
      console.warn = (...args: unknown[]) => warnings.push(args);

      Deno.env.set("SENTRY_ENABLED", "false");
      assertEquals(await initializeSentryFromEnv(undefined, load), false);
      Deno.env.delete("SENTRY_ENABLED");
      assertEquals(await initializeSentryFromEnv(undefined, load), false);

      assertEquals(warnings, []);
      assertEquals(loadCount, 0);
    } finally {
      console.warn = originalWarn;
      restoreEnv("SENTRY_ENABLED", previousEnabled);
      restoreEnv("VERYFRONT_ERROR_REPORTER", previousProvider);
      restoreEnv("SENTRY_DSN", previousDsn);
    }
  });

  it("Sentry environment configuration rejects explicit false even with a valid DSN", () => {
    const previousEnabled = Deno.env.get("SENTRY_ENABLED");
    const previousProvider = Deno.env.get("VERYFRONT_ERROR_REPORTER");
    const previousDsn = Deno.env.get("SENTRY_DSN");
    try {
      Deno.env.set("SENTRY_ENABLED", "false");
      Deno.env.set("VERYFRONT_ERROR_REPORTER", "sentry");
      Deno.env.set("SENTRY_DSN", "https://public@example.ingest.sentry.io/1");

      assertEquals(resolveSentryConfigFromEnv(), undefined);
    } finally {
      restoreEnv("SENTRY_ENABLED", previousEnabled);
      restoreEnv("VERYFRONT_ERROR_REPORTER", previousProvider);
      restoreEnv("SENTRY_DSN", previousDsn);
    }
  });

  it("Sentry environment configuration requires explicit provider opt-in", () => {
    const previousEnabled = Deno.env.get("SENTRY_ENABLED");
    const previousProvider = Deno.env.get("VERYFRONT_ERROR_REPORTER");
    const previousDsn = Deno.env.get("SENTRY_DSN");
    try {
      Deno.env.set("SENTRY_ENABLED", "true");
      Deno.env.delete("VERYFRONT_ERROR_REPORTER");
      Deno.env.set("SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
      assertEquals(resolveSentryConfigFromEnv(), undefined);
    } finally {
      restoreEnv("SENTRY_ENABLED", previousEnabled);
      restoreEnv("VERYFRONT_ERROR_REPORTER", previousProvider);
      restoreEnv("SENTRY_DSN", previousDsn);
    }
  });

  it("Sentry environment configuration uses the entrypoint service fallback", () => {
    const previousEnabled = Deno.env.get("SENTRY_ENABLED");
    const previousProvider = Deno.env.get("VERYFRONT_ERROR_REPORTER");
    const previousDsn = Deno.env.get("SENTRY_DSN");
    const previousServiceName = Deno.env.get("SENTRY_SERVICE_NAME");
    const previousOtelServiceName = Deno.env.get("OTEL_SERVICE_NAME");
    const previousEnvironment = Deno.env.get("SENTRY_ENVIRONMENT");
    const previousRelease = Deno.env.get("SENTRY_RELEASE");
    const previousOtelEnvironment = Deno.env.get("OTEL_DEPLOYMENT_ENVIRONMENT");
    const previousOtelServiceVersion = Deno.env.get("OTEL_SERVICE_VERSION");
    try {
      Deno.env.set("SENTRY_ENABLED", "true");
      Deno.env.set("VERYFRONT_ERROR_REPORTER", "sentry");
      Deno.env.set("SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
      Deno.env.set("SENTRY_SERVICE_NAME", "   ");
      Deno.env.delete("OTEL_SERVICE_NAME");
      Deno.env.delete("SENTRY_ENVIRONMENT");
      Deno.env.delete("SENTRY_RELEASE");
      Deno.env.delete("OTEL_DEPLOYMENT_ENVIRONMENT");
      Deno.env.delete("OTEL_SERVICE_VERSION");

      assertEquals(resolveSentryConfigFromEnv("veryfront-proxy"), {
        dsn: "https://public@example.ingest.sentry.io/1",
        environment: undefined,
        release: undefined,
        serviceName: "veryfront-proxy",
      });
    } finally {
      restoreEnv("SENTRY_ENABLED", previousEnabled);
      restoreEnv("VERYFRONT_ERROR_REPORTER", previousProvider);
      restoreEnv("SENTRY_DSN", previousDsn);
      restoreEnv("SENTRY_SERVICE_NAME", previousServiceName);
      restoreEnv("OTEL_SERVICE_NAME", previousOtelServiceName);
      restoreEnv("SENTRY_ENVIRONMENT", previousEnvironment);
      restoreEnv("SENTRY_RELEASE", previousRelease);
      restoreEnv("OTEL_DEPLOYMENT_ENVIRONMENT", previousOtelEnvironment);
      restoreEnv("OTEL_SERVICE_VERSION", previousOtelServiceVersion);
    }
  });

  it("Sentry environment configuration resolves environment and release through the OTEL fallbacks", () => {
    const previousEnabled = Deno.env.get("SENTRY_ENABLED");
    const previousProvider = Deno.env.get("VERYFRONT_ERROR_REPORTER");
    const previousDsn = Deno.env.get("SENTRY_DSN");
    const previousEnvironment = Deno.env.get("SENTRY_ENVIRONMENT");
    const previousRelease = Deno.env.get("SENTRY_RELEASE");
    const previousOtelEnvironment = Deno.env.get("OTEL_DEPLOYMENT_ENVIRONMENT");
    const previousOtelServiceVersion = Deno.env.get("OTEL_SERVICE_VERSION");
    try {
      Deno.env.set("SENTRY_ENABLED", "true");
      Deno.env.set("VERYFRONT_ERROR_REPORTER", "sentry");
      Deno.env.set("SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
      Deno.env.set("SENTRY_ENVIRONMENT", "production");
      Deno.env.set("SENTRY_RELEASE", "v1.2.3");
      Deno.env.set("OTEL_DEPLOYMENT_ENVIRONMENT", "staging");
      Deno.env.set("OTEL_SERVICE_VERSION", "v9");

      assertEquals(
        resolveSentryConfigFromEnv()?.environment,
        "production",
        "SENTRY_ENVIRONMENT wins over the OTEL deployment environment",
      );
      assertEquals(
        resolveSentryConfigFromEnv()?.release,
        "v1.2.3",
        "SENTRY_RELEASE wins over the OTEL service version",
      );

      Deno.env.delete("SENTRY_ENVIRONMENT");
      Deno.env.delete("SENTRY_RELEASE");

      assertEquals(
        resolveSentryConfigFromEnv()?.environment,
        "staging",
        "OTEL_DEPLOYMENT_ENVIRONMENT is the environment fallback",
      );
      assertEquals(
        resolveSentryConfigFromEnv()?.release,
        "v9",
        "OTEL_SERVICE_VERSION is the release fallback",
      );
    } finally {
      restoreEnv("SENTRY_ENABLED", previousEnabled);
      restoreEnv("VERYFRONT_ERROR_REPORTER", previousProvider);
      restoreEnv("SENTRY_DSN", previousDsn);
      restoreEnv("SENTRY_ENVIRONMENT", previousEnvironment);
      restoreEnv("SENTRY_RELEASE", previousRelease);
      restoreEnv("OTEL_DEPLOYMENT_ENVIRONMENT", previousOtelEnvironment);
      restoreEnv("OTEL_SERVICE_VERSION", previousOtelServiceVersion);
    }
  });

  it("Sentry accepts a public HTTPS custom-host DSN", () => {
    const previousEnabled = Deno.env.get("SENTRY_ENABLED");
    const previousProvider = Deno.env.get("VERYFRONT_ERROR_REPORTER");
    const previousDsn = Deno.env.get("SENTRY_DSN");
    try {
      Deno.env.set("SENTRY_ENABLED", "true");
      Deno.env.set("VERYFRONT_ERROR_REPORTER", "sentry");
      Deno.env.set("SENTRY_DSN", "https://public@errors.example.test/42");

      assertEquals(resolveSentryConfigFromEnv()?.dsn, "https://public@errors.example.test/42");
    } finally {
      restoreEnv("SENTRY_ENABLED", previousEnabled);
      restoreEnv("VERYFRONT_ERROR_REPORTER", previousProvider);
      restoreEnv("SENTRY_DSN", previousDsn);
    }
  });

  it("Sentry loads the extension with normalized runtime configuration", async () => {
    resetSentryForTests();
    const { load, state } = createSentryExtension();

    assertEquals(
      await initializeSentry(
        {
          dsn: "https://public@example.ingest.sentry.io/1",
          environment: " production ",
          release: " release-1 ",
          serviceName: " veryfront-server ",
        },
        load,
      ),
      true,
    );

    assertEquals(state.config, {
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "production",
      release: "release-1",
      serviceName: "veryfront-server",
    });
  });

  it("Sentry initialization is idempotent across concurrent callers", async () => {
    resetSentryForTests();
    const { load, state } = createSentryExtension();
    let resolveLoad: (() => void) | undefined;
    let loadCount = 0;
    const delayedLoad = async () => {
      loadCount += 1;
      await new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });
      return await load();
    };
    const config = { dsn: "https://public@errors.example.test/42" };

    const first = initializeSentry(config, delayedLoad);
    const second = initializeSentry(config, delayedLoad);
    resolveLoad?.();

    assertEquals(await Promise.all([first, second]), [true, true]);
    assertEquals(loadCount, 1);
    assertEquals(state.config?.dsn, "https://public@errors.example.test/42");
  });

  it("does not report success for a concurrent or installed different configuration", async () => {
    resetSentryForTests();
    const { load, state } = createSentryExtension();
    let resolveLoad: (() => void) | undefined;
    let firstLoadCount = 0;
    let conflictingLoadCount = 0;
    const firstConfig = {
      dsn: "https://public@errors.example.test/1",
      environment: " production ",
      serviceName: " veryfront-server ",
    };
    const conflictingConfig = {
      dsn: "https://public@errors.example.test/2",
      environment: "production",
      serviceName: "veryfront-proxy",
    };
    const first = initializeSentry(firstConfig, async () => {
      firstLoadCount += 1;
      await new Promise<void>((resolve) => {
        resolveLoad = resolve;
      });
      return await load();
    });
    const conflicting = initializeSentry(conflictingConfig, async () => {
      conflictingLoadCount += 1;
      return await load();
    });

    assertEquals(await conflicting, false);
    resolveLoad?.();
    assertEquals(await first, true);
    assertEquals(firstLoadCount, 1);
    assertEquals(conflictingLoadCount, 0);
    assertEquals(state.config, {
      dsn: "https://public@errors.example.test/1",
      environment: "production",
      release: "",
      serviceName: "veryfront-server",
    });
    assertEquals(await initializeSentry({ ...firstConfig, environment: "production" }), true);
    assertEquals(await initializeSentry(conflictingConfig), false);
  });

  it("a reset initialization cannot clear the replacement initialization", async () => {
    resetSentryForTests();
    const { load } = createSentryExtension();
    let resolveFirst: (() => void) | undefined;
    let resolveSecond: (() => void) | undefined;
    let secondLoadCount = 0;
    const firstLoad = async () => {
      await new Promise<void>((resolve) => {
        resolveFirst = resolve;
      });
      return await load();
    };
    const secondLoad = async () => {
      secondLoadCount += 1;
      await new Promise<void>((resolve) => {
        resolveSecond = resolve;
      });
      return await load();
    };
    const config = { dsn: "https://public@errors.example.test/42" };

    const superseded = initializeSentry(config, firstLoad);
    resetSentryForTests();
    const replacement = initializeSentry(config, secondLoad);
    resolveFirst?.();

    assertEquals(await superseded, false);
    const concurrent = initializeSentry(config, secondLoad);
    assertEquals(secondLoadCount, 1);
    resolveSecond?.();
    assertEquals(await Promise.all([replacement, concurrent]), [true, true]);
  });

  it("Sentry captures service and Grafana trace correlation", async () => {
    resetSentryForTests();
    const { load, state } = createSentryExtension();
    await initializeSentry(
      {
        dsn: "https://public@example.ingest.sentry.io/1",
        serviceName: "veryfront-proxy",
      },
      load,
    );

    const error = new Error("proxy failed");
    const context = {
      boundary: "proxy.request",
      method: "GET",
      requestId: "request-1",
      spanId: "span-1",
      traceId: "trace-1",
    };
    assertEquals(
      captureApplicationError(error, context),
      "event-id",
    );
    assertEquals(state.captured, [{ error, context }]);

    assertEquals(await flushApplicationErrors(1_500), true);
    assertEquals(state.flushTimeouts, [1_500]);
  });

  function restoreEnv(name: string, value: string | undefined): void {
    if (value === undefined) {
      Deno.env.delete(name);
    } else {
      Deno.env.set(name, value);
    }
  }
});
