import { assertEquals, assertStringIncludes } from "@std/assert";
import { createSentryApplicationErrorReporter } from "./index.ts";

function createSentrySdk() {
  const state = {
    captured: [] as unknown[],
    contexts: [] as Array<[string, Record<string, unknown>]>,
    fingerprints: [] as string[][],
    flushTimeouts: [] as Array<number | undefined>,
    initOptions: undefined as Parameters<typeof import("@sentry/deno").init>[0] | undefined,
    tags: [] as Array<[string, string]>,
  };
  const scope = {
    setContext(name: string, context: Record<string, unknown>) {
      state.contexts.push([name, context]);
    },
    setFingerprint(fingerprint: string[]) {
      state.fingerprints.push(fingerprint);
    },
    setTag(key: string, value: string) {
      state.tags.push([key, value]);
    },
  };
  const sdk = {
    captureException(error: unknown) {
      state.captured.push(error);
      return "event-id";
    },
    flush(timeoutMs?: number) {
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

Deno.test("Sentry reporter uses error-only, privacy-preserving configuration", async () => {
  const { sdk, state } = createSentrySdk();
  createSentryApplicationErrorReporter(
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
      breadcrumbs: [{ message: "secret breadcrumb" }],
      exception: {
        values: [{
          value:
            "request failed with Bearer synthetic-token-value and https://public@example.ingest.sentry.io/1",
          stacktrace: {
            frames: [{
              filename: "https://service.test/path?token=synthetic-token-value",
              abs_path: "/Users/test-user/private-project/src/server/render.ts",
            }],
          },
        }],
      },
      request: { data: "secret request" },
      type: undefined,
      user: { id: "user-1" },
    },
    {},
  );
  if (!event) throw new Error("beforeSend unexpectedly dropped the event");

  assertEquals(event.breadcrumbs, undefined);
  assertEquals(event.request, undefined);
  assertEquals(event.user, undefined);
  assertEquals(event.fingerprint, ["veryfront-server", "{{ default }}"]);
  assertEquals(event.tags, { "service.name": "veryfront-server" });
  assertStringIncludes(event.exception?.values?.[0]?.value ?? "", "[REDACTED]");
  assertEquals(
    event.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename,
    "https://service.test/path?token=[REDACTED]",
  );
  assertEquals(
    event.exception?.values?.[0]?.stacktrace?.frames?.[0]?.abs_path,
    "src/server/render.ts",
  );
});

Deno.test("Sentry reporter removes filesystem prefixes from stack frames", async () => {
  const { sdk, state } = createSentrySdk();
  createSentryApplicationErrorReporter(
    {
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "production",
      release: "release-1",
      serviceName: "veryfront-server",
    },
    sdk,
  );

  const beforeSend = state.initOptions?.beforeSend;
  if (!beforeSend) throw new Error("beforeSend was not configured");
  const event = await beforeSend(
    {
      exception: {
        values: [{
          stacktrace: {
            frames: [
              { filename: "file:///home/test-user/project/extensions/example/index.ts" },
              { abs_path: "C:\\Users\\test-user\\private\\bootstrap.ts" },
            ],
          },
        }],
      },
      type: undefined,
    },
    {},
  );
  if (!event) throw new Error("beforeSend unexpectedly dropped the event");

  assertEquals(
    event.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename,
    "extensions/example/index.ts",
  );
  assertEquals(
    event.exception?.values?.[0]?.stacktrace?.frames?.[1]?.abs_path,
    "[REDACTED]/bootstrap.ts",
  );
});

Deno.test("Sentry reporter captures service and Grafana trace correlation", async () => {
  const { sdk, state } = createSentrySdk();
  const reporter = createSentryApplicationErrorReporter(
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
    reporter.capture(error, {
      boundary: "proxy.request",
      method: "GET",
      requestId: "request-1",
      spanId: "span-1",
      traceId: "trace-1",
    }),
    "event-id",
  );
  assertEquals(state.captured, [error]);
  assertEquals(state.fingerprints, [["veryfront-proxy", "{{ default }}"]]);
  assertEquals(
    state.tags.some(([key, value]) => key === "grafana.trace_id" && value === "trace-1"),
    true,
  );
  assertEquals(state.contexts, [[
    "grafana_trace",
    { trace_id: "trace-1", span_id: "span-1" },
  ]]);

  assertEquals(await reporter.flush(1_500), true);
  assertEquals(state.flushTimeouts, [1_500]);
});
