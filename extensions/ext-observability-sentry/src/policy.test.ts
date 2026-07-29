import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  captureWithSentryPolicy,
  flushWithSentryPolicy,
  prepareSentryEvent,
  sanitizeApplicationErrorAttributes,
} from "./policy.ts";

function createSentrySdk(options: {
  captureThrows?: boolean;
  flushThrows?: boolean;
  withScopeThrows?: boolean;
} = {}) {
  const state = {
    captured: [] as unknown[],
    contexts: [] as Array<[string, Record<string, unknown>]>,
    fingerprints: [] as string[][],
    flushTimeouts: [] as Array<number | undefined>,
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
      if (options.captureThrows) throw new Error("capture failed");
      state.captured.push(error);
      return "event-id";
    },
    flush(timeoutMs?: number) {
      if (options.flushThrows) throw new Error("flush failed");
      state.flushTimeouts.push(timeoutMs);
      return Promise.resolve(true);
    },
    withScope(callback: (currentScope: typeof scope) => void) {
      if (options.withScopeThrows) throw new Error("scope failed");
      callback(scope);
    },
  };
  return { sdk, state };
}

Deno.test("policy redacts sensitive event fields and preserves service fingerprint", () => {
  const event = prepareSentryEvent(
    {
      breadcrumbs: [{ message: "synthetic breadcrumb" }],
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
      request: { data: "synthetic request" },
      user: { id: "test-user" },
    },
    "veryfront-server",
  );

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

Deno.test("policy removes filesystem prefixes from stack frames", () => {
  const event = prepareSentryEvent(
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
    },
    "veryfront-server",
  );

  assertEquals(
    event.exception?.values?.[0]?.stacktrace?.frames?.[0]?.filename,
    "extensions/example/index.ts",
  );
  assertEquals(
    event.exception?.values?.[0]?.stacktrace?.frames?.[1]?.abs_path,
    "[REDACTED]/bootstrap.ts",
  );
});

Deno.test("policy captures service and Grafana trace correlation", () => {
  const { sdk, state } = createSentrySdk();
  const error = new Error("proxy failed");

  assertEquals(
    captureWithSentryPolicy(sdk, "veryfront-proxy", error, {
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
});

Deno.test("policy redacts application error attribute keys and credential-shaped values", () => {
  assertEquals(
    sanitizeApplicationErrorAttributes({
      "auth.token": "synthetic-token-value",
      apiKey: "synthetic-api-key",
      normal: "Bearer synthetic-token-value and https://service.test/1?token=synthetic-token-value",
      serviceUrl: "https://user:pass@example.test/path?access_token=synthetic-token-value",
      count: 3,
      enabled: true,
    }),
    {
      "auth.token": "[REDACTED]",
      apiKey: "[REDACTED]",
      normal: "[REDACTED] and https://service.test/1?token=[REDACTED]",
      serviceUrl: "https://[REDACTED]@example.test/path?access_token=[REDACTED]",
      count: 3,
      enabled: true,
    },
  );
});

Deno.test("policy applies sanitized application error attributes to Sentry scope", () => {
  const { sdk, state } = createSentrySdk();
  const error = new Error("agent failed");

  captureWithSentryPolicy(sdk, "veryfront-agent", error, {
    boundary: "agent.framework-log",
    attributes: {
      task: "build",
      authToken: "synthetic-token-value",
      message: "Bearer synthetic-token-value",
    },
  });

  assertEquals(state.captured, [error]);
  assertEquals(state.contexts, [[
    "veryfront_application_error",
    {
      task: "build",
      authToken: "[REDACTED]",
      message: "[REDACTED]",
    },
  ]]);
});

Deno.test("policy isolates capture and scope failures from the original error path", () => {
  assertEquals(
    captureWithSentryPolicy(createSentrySdk({ captureThrows: true }).sdk, "svc", new Error(), {
      boundary: "process.startup",
    }),
    undefined,
  );
  assertEquals(
    captureWithSentryPolicy(createSentrySdk({ withScopeThrows: true }).sdk, "svc", new Error(), {
      boundary: "process.startup",
    }),
    undefined,
  );
});

Deno.test("policy keeps flush bounded and isolates SDK flush failures", async () => {
  const { sdk, state } = createSentrySdk();
  assertEquals(await flushWithSentryPolicy(sdk, 1_500), true);
  assertEquals(state.flushTimeouts, [1_500]);

  assertEquals(
    await flushWithSentryPolicy(createSentrySdk({ flushThrows: true }).sdk, 1_500),
    false,
  );
});
