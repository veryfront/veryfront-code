import { assertEquals } from "@std/assert";
import {
  type ApplicationErrorContext,
  type ApplicationErrorReporter,
  captureApplicationError,
  flushApplicationErrors,
} from "./application-errors.ts";
import { initializeSentry, resetSentryForTests, resolveSentryConfigFromEnv } from "./sentry.ts";

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

Deno.test("Sentry stays disabled without a DSN", async () => {
  resetSentryForTests();
  const { load, state } = createSentryExtension();

  assertEquals(await initializeSentry({}, load), false);
  assertEquals(state.config, undefined);
});

Deno.test("Sentry environment configuration requires explicit provider opt-in", () => {
  const previousProvider = Deno.env.get("VERYFRONT_ERROR_REPORTER");
  const previousDsn = Deno.env.get("SENTRY_DSN");
  try {
    Deno.env.delete("VERYFRONT_ERROR_REPORTER");
    Deno.env.set("SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
    assertEquals(resolveSentryConfigFromEnv(), undefined);
  } finally {
    restoreEnv("VERYFRONT_ERROR_REPORTER", previousProvider);
    restoreEnv("SENTRY_DSN", previousDsn);
  }
});

Deno.test("Sentry environment configuration uses the entrypoint service fallback", () => {
  const previousProvider = Deno.env.get("VERYFRONT_ERROR_REPORTER");
  const previousDsn = Deno.env.get("SENTRY_DSN");
  const previousServiceName = Deno.env.get("SENTRY_SERVICE_NAME");
  const previousOtelServiceName = Deno.env.get("OTEL_SERVICE_NAME");
  try {
    Deno.env.set("VERYFRONT_ERROR_REPORTER", "sentry");
    Deno.env.set("SENTRY_DSN", "https://public@example.ingest.sentry.io/1");
    Deno.env.set("SENTRY_SERVICE_NAME", "   ");
    Deno.env.delete("OTEL_SERVICE_NAME");

    assertEquals(resolveSentryConfigFromEnv("veryfront-proxy"), {
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: undefined,
      release: undefined,
      serviceName: "veryfront-proxy",
    });
  } finally {
    restoreEnv("VERYFRONT_ERROR_REPORTER", previousProvider);
    restoreEnv("SENTRY_DSN", previousDsn);
    restoreEnv("SENTRY_SERVICE_NAME", previousServiceName);
    restoreEnv("OTEL_SERVICE_NAME", previousOtelServiceName);
  }
});

Deno.test("Sentry loads the extension with normalized runtime configuration", async () => {
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

Deno.test("Sentry captures service and Grafana trace correlation", async () => {
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

Deno.test("concurrent Sentry initialization shares one extension setup", async () => {
  resetSentryForTests();
  const { state } = createSentryExtension();
  let loadCalls = 0;
  let createCalls = 0;
  let release!: (extension: {
    createSentryApplicationErrorReporter(
      config: Record<string, string>,
    ): ApplicationErrorReporter;
  }) => void;
  const extensionReady = new Promise<{
    createSentryApplicationErrorReporter(
      config: Record<string, string>,
    ): ApplicationErrorReporter;
  }>((resolve) => {
    release = resolve;
  });
  const load = () => {
    loadCalls++;
    return extensionReady;
  };
  const extension = {
    createSentryApplicationErrorReporter(
      config: Record<string, string>,
    ): ApplicationErrorReporter {
      createCalls++;
      state.config = config;
      return {
        capture: () => "event-id",
        flush: () => Promise.resolve(true),
      };
    },
  };

  const first = initializeSentry(
    { dsn: "https://public@example.ingest.sentry.io/1" },
    load,
  );
  const second = initializeSentry(
    { dsn: "https://other@example.ingest.sentry.io/2" },
    load,
  );
  release(extension);

  assertEquals(await Promise.all([first, second]), [true, true]);
  assertEquals(loadCalls, 1);
  assertEquals(createCalls, 1);
  assertEquals(state.config?.dsn, "https://public@example.ingest.sentry.io/1");
});

Deno.test("Sentry snapshots configuration before asynchronous extension loading", async () => {
  resetSentryForTests();
  const { state } = createSentryExtension();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const config = {
    dsn: "https://public@example.ingest.sentry.io/1",
    environment: "production",
    release: "release-1",
    serviceName: "veryfront-server",
  };
  const extension = {
    createSentryApplicationErrorReporter(
      normalized: Record<string, string>,
    ): ApplicationErrorReporter {
      state.config = normalized;
      return {
        capture: () => "event-id",
        flush: () => Promise.resolve(true),
      };
    },
  };

  const initializing = initializeSentry(config, async () => {
    await gate;
    return extension;
  });
  config.environment = "mutated";
  config.release = "mutated";
  config.serviceName = "mutated";
  release();

  assertEquals(await initializing, true);
  assertEquals(state.config, {
    dsn: "https://public@example.ingest.sentry.io/1",
    environment: "production",
    release: "release-1",
    serviceName: "veryfront-server",
  });
});

Deno.test("reset prevents an obsolete Sentry initialization from installing a reporter", async () => {
  resetSentryForTests();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const extension = {
    createSentryApplicationErrorReporter(): ApplicationErrorReporter {
      return {
        capture: () => "stale-event",
        flush: () => Promise.resolve(true),
      };
    },
  };

  const initializing = initializeSentry(
    { dsn: "https://public@example.ingest.sentry.io/1" },
    async () => {
      await gate;
      return extension;
    },
  );
  resetSentryForTests();
  release();

  assertEquals(await initializing, false);
  assertEquals(
    captureApplicationError(new Error("not installed"), { boundary: "test" }),
    undefined,
  );
});

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    Deno.env.delete(name);
  } else {
    Deno.env.set(name, value);
  }
}
