import { assertEquals } from "@std/assert";
import { createDenoSentryApplicationErrorReporter } from "./deno.ts";

function createDenoSentrySdk(options: {
  captureThrows?: boolean;
  flushThrows?: boolean;
} = {}) {
  const state = {
    captured: [] as unknown[],
    flushTimeouts: [] as Array<number | undefined>,
    initOptions: undefined as Parameters<typeof import("@sentry/deno").init>[0] | undefined,
    levels: [] as string[],
    tags: [] as Array<[string, string]>,
  };
  const scope = {
    setContext() {},
    setFingerprint() {},
    setLevel(level: string) {
      state.levels.push(level);
    },
    setTag(key: string, value: string) {
      state.tags.push([key, value]);
    },
  };
  const sdk = {
    captureException(error: unknown) {
      if (options.captureThrows) throw new Error("capture failed");
      state.captured.push(error);
      return "event-id";
    },
    flush(timeoutMs?: number) {
      if (options.flushThrows) throw new Error("flush failed");
      state.flushTimeouts.push(timeoutMs);
      return Promise.resolve(true);
    },
    init(options: Parameters<typeof import("@sentry/deno").init>[0]) {
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

Deno.test("Deno adapter propagates warning and fatal levels to native Sentry scope", () => {
  const { sdk, state } = createDenoSentrySdk();
  const reporter = createDenoSentryApplicationErrorReporter(
    {
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "",
      release: "",
      serviceName: "veryfront-server",
    },
    sdk,
  );

  reporter.capture(new Error("slow request"), {
    boundary: "server.request",
    level: "warning",
  });
  reporter.capture(new Error("startup failed"), {
    boundary: "process.startup",
    level: "fatal",
  });

  assertEquals(state.levels, ["warning", "fatal"]);
});

Deno.test("Deno adapter propagates process role to native Sentry tag", () => {
  const { sdk, state } = createDenoSentrySdk();
  const reporter = createDenoSentryApplicationErrorReporter(
    {
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "",
      release: "",
      serviceName: "veryfront-server",
    },
    sdk,
  );

  reporter.capture(new Error("request failed"), {
    boundary: "server.request",
    processRole: "server",
  });

  assertEquals(
    state.tags.some(([key, value]) => key === "process_role" && value === "server"),
    true,
  );
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
