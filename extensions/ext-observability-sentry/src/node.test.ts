import { assertEquals, assertStringIncludes } from "@std/assert";
import { createNodeSentryApplicationErrorReporter } from "./node.ts";

function createNodeSentrySdk(options: {
  captureThrows?: boolean;
  flushThrows?: boolean;
} = {}) {
  const state = {
    captured: [] as unknown[],
    flushTimeouts: [] as Array<number | undefined>,
    initOptions: undefined as Parameters<typeof import("@sentry/node").init>[0] | undefined,
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
      if (options.captureThrows) throw new Error("capture failed");
      state.captured.push(error);
      return "event-id";
    },
    flush(timeoutMs?: number) {
      if (options.flushThrows) throw new Error("flush failed");
      state.flushTimeouts.push(timeoutMs);
      return Promise.resolve(true);
    },
    init(options: Parameters<typeof import("@sentry/node").init>[0]) {
      state.initOptions = options;
    },
    withScope(callback: (currentScope: typeof scope) => void) {
      callback(scope);
    },
  };
  return { sdk, state };
}

Deno.test("Node adapter uses error-only configuration without tracing or log capture", async () => {
  const { sdk, state } = createNodeSentrySdk();
  createNodeSentryApplicationErrorReporter(
    {
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "production",
      release: "release-1",
      serviceName: "veryfront-agent",
    },
    sdk,
  );

  assertEquals(state.initOptions?.defaultIntegrations, false);
  assertEquals(state.initOptions?.enableLogs, false);
  assertEquals(state.initOptions?.sendDefaultPii, false);
  assertEquals("tracesSampleRate" in (state.initOptions ?? {}), false);
  assertEquals("tracesSampler" in (state.initOptions ?? {}), false);
  assertEquals(state.initOptions?.dataCollection?.httpBodies, []);
  assertEquals(state.initOptions?.dataCollection?.httpHeaders, {
    request: false,
    response: false,
  });

  const beforeSend = state.initOptions?.beforeSend;
  if (!beforeSend) throw new Error("beforeSend was not configured");
  const event = await beforeSend(
    {
      message: "failed with Bearer synthetic-token-value",
      type: undefined,
    },
    {},
  );
  if (!event) throw new Error("beforeSend unexpectedly dropped the event");

  assertStringIncludes(event.message ?? "", "[REDACTED]");
  assertEquals(event.message?.includes("synthetic-token-value"), false);
  assertEquals(event.fingerprint, ["veryfront-agent", "{{ default }}"]);
  assertEquals(event.tags, { "service.name": "veryfront-agent" });
});

Deno.test("Node adapter captures with policy tags and bounded flush", async () => {
  const { sdk, state } = createNodeSentrySdk();
  const reporter = createNodeSentryApplicationErrorReporter(
    {
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "",
      release: "",
      serviceName: "veryfront-agent",
    },
    sdk,
  );

  const error = new Error("agent failed");
  assertEquals(
    reporter.capture(error, { boundary: "agent.process" }),
    "event-id",
  );
  assertEquals(state.captured, [error]);
  assertEquals(
    state.tags.some(([key, value]) => key === "veryfront.boundary" && value === "agent.process"),
    true,
  );

  assertEquals(await reporter.flush(1_500), true);
  assertEquals(state.flushTimeouts, [1_500]);
});

Deno.test("Node adapter isolates SDK capture and flush failures", async () => {
  const captureReporter = createNodeSentryApplicationErrorReporter(
    {
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "",
      release: "",
      serviceName: "veryfront-agent",
    },
    createNodeSentrySdk({ captureThrows: true }).sdk,
  );
  assertEquals(
    captureReporter.capture(new Error("agent failed"), {
      boundary: "agent.process",
    }),
    undefined,
  );

  const flushReporter = createNodeSentryApplicationErrorReporter(
    {
      dsn: "https://public@example.ingest.sentry.io/1",
      environment: "",
      release: "",
      serviceName: "veryfront-agent",
    },
    createNodeSentrySdk({ flushThrows: true }).sdk,
  );
  assertEquals(await flushReporter.flush(1_500), false);
});

Deno.test("Node adapter source does not import the Deno SDK", async () => {
  const source = await Deno.readTextFile(
    new URL("./node.ts", import.meta.url),
  );

  assertEquals(source.includes("@sentry/deno"), false);
});
