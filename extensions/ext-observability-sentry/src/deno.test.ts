import { assertEquals, assertRejects, assertStrictEquals, assertThrows } from "@std/assert";
import {
  createDenoSentryApplicationErrorReporter,
  createDenoSentryApplicationErrorReporterInitializer,
} from "./deno.ts";

function createDenoSentrySdk(behavior: {
  captureThrows?: boolean;
  flushThrows?: boolean;
  initThrows?: boolean;
  closeError?: Error;
} = {}) {
  const state = {
    captured: [] as unknown[],
    flushTimeouts: [] as Array<number | undefined>,
    closeTimeouts: [] as Array<number | undefined>,
    initOptions: undefined as Parameters<typeof import("@sentry/deno").init>[0] | undefined,
    tags: [] as Array<[string, string]>,
  };
  const scope = {
    setContext() {},
    setFingerprint() {},
    setTag(key: string, value: string) {
      state.tags.push([key, value]);
    },
  };
  const sdk = {
    captureException(error: unknown) {
      if (behavior.captureThrows) throw new Error("capture failed");
      state.captured.push(error);
      return "event-id";
    },
    flush(timeoutMs?: number) {
      if (behavior.flushThrows) throw new Error("flush failed");
      state.flushTimeouts.push(timeoutMs);
      return Promise.resolve(true);
    },
    close(timeoutMs?: number) {
      state.closeTimeouts.push(timeoutMs);
      if (behavior.closeError) return Promise.reject(behavior.closeError);
      return Promise.resolve(true);
    },
    init(options: Parameters<typeof import("@sentry/deno").init>[0]) {
      if (behavior.initThrows) throw new Error("init failed");
      state.initOptions = options;
    },
    withScope(callback: (currentScope: typeof scope) => void) {
      callback(scope);
    },
  };
  return { sdk, state };
}

Deno.test("Deno adapter uses V1 error-only privacy-preserving configuration", async () => {
  const { sdk, state } = createDenoSentrySdk();
  createDenoSentryApplicationErrorReporter(
    {
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "production",
      release: "release-1",
      serviceName: "veryfront-server",
    },
    sdk,
  );

  assertEquals(state.initOptions?.skipOpenTelemetrySetup, true);
  assertEquals(state.initOptions?.dataCollection?.httpBodies, []);
  assertEquals(state.initOptions?.dataCollection?.httpHeaders, {
    request: false,
    response: false,
  });

  const beforeSend = state.initOptions?.beforeSend;
  if (!beforeSend) throw new Error("beforeSend was not configured");
  const event = await beforeSend(
    {
      breadcrumbs: [{ message: "synthetic breadcrumb" }],
      request: { data: "synthetic request" },
      type: undefined,
      user: { id: "test-user" },
    },
    {},
  );
  if (!event) throw new Error("beforeSend unexpectedly dropped the event");

  assertEquals(event.breadcrumbs, undefined);
  assertEquals(event.request, undefined);
  assertEquals(event.user, undefined);
  assertEquals(event.fingerprint, ["veryfront-server", "{{ default }}"]);
  assertEquals(event.tags, { "service.name": "veryfront-server" });
});

Deno.test("Deno adapter captures with policy tags and bounded flush", async () => {
  const { sdk, state } = createDenoSentrySdk();
  const reporter = createDenoSentryApplicationErrorReporter(
    {
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "",
      release: "",
      serviceName: "veryfront-proxy",
    },
    sdk,
  );

  const error = new Error("proxy failed");
  assertEquals(
    reporter.capture(error, { boundary: "proxy.request" }),
    "event-id",
  );
  assertEquals(state.captured, [error]);
  assertEquals(
    state.tags.some(([key, value]) => key === "veryfront.boundary" && value === "proxy.request"),
    true,
  );

  assertEquals(await reporter.flush(1_500), true);
  assertEquals(state.flushTimeouts, [1_500]);
});

Deno.test("Deno adapter isolates SDK capture and flush failures", async () => {
  const captureReporter = createDenoSentryApplicationErrorReporter(
    {
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "",
      release: "",
      serviceName: "veryfront-server",
    },
    createDenoSentrySdk({ captureThrows: true }).sdk,
  );
  assertEquals(
    captureReporter.capture(new Error("startup failed"), {
      boundary: "process.startup",
    }),
    undefined,
  );

  const flushReporter = createDenoSentryApplicationErrorReporter(
    {
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "",
      release: "",
      serviceName: "veryfront-server",
    },
    createDenoSentrySdk({ flushThrows: true }).sdk,
  );
  assertEquals(await flushReporter.flush(1_500), false);
});

Deno.test("Deno initializer owns environment resolution and SDK cleanup", async () => {
  const { sdk, state } = createDenoSentrySdk();
  const env: Record<string, string | undefined> = {
    SENTRY_DSN: " https://public@example.ingest.sentry.io/1 ",
    SENTRY_ENVIRONMENT: " staging ",
    SENTRY_RELEASE: " release-1 ",
  };
  const initializer = createDenoSentryApplicationErrorReporterInitializer({
    readEnvironment: (name) => env[name],
    disposeTimeoutMs: 25,
  }, sdk);
  const session = await initializer.initialize({ serviceName: "veryfront-proxy" });
  if (!session) throw new Error("Sentry initializer unexpectedly disabled reporting");

  assertEquals(state.initOptions?.dsn, "https://public@example.ingest.sentry.io/1");
  assertEquals(state.initOptions?.environment, "staging");
  assertEquals(state.initOptions?.release, "release-1");
  await session.dispose();
  await session.dispose();
  assertEquals(state.closeTimeouts, [25]);
});

Deno.test("Deno initializer treats missing config as disabled and propagates SDK init errors", async () => {
  const disabledSdk = createDenoSentrySdk();
  const disabled = createDenoSentryApplicationErrorReporterInitializer({
    readEnvironment: () => undefined,
  }, disabledSdk.sdk);
  assertEquals(await disabled.initialize({ serviceName: "veryfront-server" }), undefined);
  assertEquals(disabledSdk.state.initOptions, undefined);

  const initializationError = new Error("selected SDK failed");
  const failingSdk = createDenoSentrySdk();
  failingSdk.sdk.init = () => {
    throw initializationError;
  };
  let thrown: unknown;
  try {
    await createDenoSentryApplicationErrorReporterInitializer({
      config: { dsn: "https://public@example.ingest.sentry.io/1" },
      readEnvironment: () => undefined,
    }, failingSdk.sdk).initialize({ serviceName: "veryfront-server" });
  } catch (error) {
    thrown = error;
  }
  assertEquals(thrown, initializationError);
});

Deno.test("Deno initializer rejects non-canonical config and hostile environment values", async () => {
  assertThrows(
    () =>
      createDenoSentryApplicationErrorReporterInitializer({
        config: { dsn: " https://public@example.ingest.sentry.io/1 " },
      }),
    TypeError,
    "canonical string",
  );

  const { sdk } = createDenoSentrySdk();
  const oversizedEnvironment = createDenoSentryApplicationErrorReporterInitializer({
    readEnvironment: (name) => name === "SENTRY_DSN" ? "x".repeat(4_097) : undefined,
  }, sdk);
  await assertRejects(
    async () => await oversizedEnvironment.initialize({ serviceName: "veryfront-server" }),
    TypeError,
    "at most 4096 characters",
  );
});

Deno.test("Deno initializer snapshots explicit config and preserves one cleanup failure", async () => {
  const config = { dsn: "https://public@example.ingest.sentry.io/1" };
  const cleanupError = new Error("close failed");
  const { sdk, state } = createDenoSentrySdk({ closeError: cleanupError });
  const initializer = createDenoSentryApplicationErrorReporterInitializer({
    config,
    readEnvironment: () => undefined,
  }, sdk);
  config.dsn = "https://other@example.ingest.sentry.io/2";

  const session = await initializer.initialize({ serviceName: "veryfront-server" });
  if (!session) throw new Error("Sentry initializer unexpectedly disabled reporting");
  assertEquals(state.initOptions?.dsn, "https://public@example.ingest.sentry.io/1");

  const firstDisposal = session.dispose() as Promise<void>;
  const secondDisposal = session.dispose() as Promise<void>;
  assertStrictEquals(secondDisposal, firstDisposal);
  const thrown = await assertRejects(() => firstDisposal);
  assertStrictEquals(thrown, cleanupError);
});
