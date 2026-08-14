import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
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

it("policy redacts sensitive event fields and preserves service fingerprint", () => {
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

it("policy removes filesystem prefixes from stack frames", () => {
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

it("policy captures service and Grafana trace correlation", () => {
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

it("policy preserves process_role as a native Sentry tag", () => {
  const { sdk, state } = createSentrySdk();

  captureWithSentryPolicy(sdk, "veryfront-api", new Error("request failed"), {
    boundary: "api.request",
    processRole: "api",
  });

  assertEquals(
    state.tags.some(([key, value]) => key === "process_role" && value === "api"),
    true,
  );
});

it("policy redacts application error attribute keys and credential-shaped values", () => {
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

it("policy groups pgbouncer connection PostgresErrors by stable db-error fingerprint", () => {
  const event = prepareSentryEvent(
    {
      exception: {
        values: [{
          type: "PostgresError",
          value: "pgbouncer cannot connect to server (server_login_retry)",
        }],
      },
      fingerprint: ["POST /api/graphql"],
    },
    "veryfront-api",
  );

  assertEquals(event.fingerprint, ["veryfront-db-error", "server_login_retry"]);
});

it("policy groups each pgbouncer connection code into its own db-error issue", () => {
  for (
    const code of ["server_login_retry", "query_wait_timeout", "CONNECTION_CLOSED"]
  ) {
    const event = prepareSentryEvent(
      {
        exception: {
          values: [{ type: "PostgresError", value: `write ${code} db.example.test:6432` }],
        },
      },
      "veryfront-api",
    );

    assertEquals(event.fingerprint, ["veryfront-db-error", code]);
  }
});

it("policy does not treat connection code names in ordinary messages as outage markers", () => {
  for (
    const value of [
      'column "query_wait_timeout" does not exist',
      "column (query_wait_timeout) does not exist",
    ]
  ) {
    const event = prepareSentryEvent(
      {
        exception: {
          values: [{ type: "PostgresError", value }],
        },
      },
      "veryfront-api",
    );

    assertEquals(event.fingerprint, ["veryfront-api", "{{ default }}"]);
  }
});

it("policy groups client-side postgres.js connection closures reported as plain Errors", () => {
  const event = prepareSentryEvent(
    {
      exception: {
        values: [{ type: "Error", value: "write CONNECTION_CLOSED db.example.test:6432" }],
      },
      fingerprint: ["POST /api/graphql"],
    },
    "veryfront-api",
  );

  assertEquals(event.fingerprint, ["veryfront-db-error", "CONNECTION_CLOSED"]);
});

it("policy leaves unrelated plain connection-closed errors on the default fingerprint", () => {
  const event = prepareSentryEvent(
    {
      exception: {
        values: [{
          type: "Error",
          value: "upstream request failed: CONNECTION_CLOSED",
        }],
      },
    },
    "veryfront-api",
  );

  assertEquals(event.fingerprint, ["veryfront-api", "{{ default }}"]);
});

it("policy keeps the default fingerprint for non-connection PostgresErrors and other errors", () => {
  const postgresEvent = prepareSentryEvent(
    {
      exception: {
        values: [{
          type: "PostgresError",
          value: "duplicate key value violates unique constraint",
        }],
      },
    },
    "veryfront-api",
  );
  assertEquals(postgresEvent.fingerprint, ["veryfront-api", "{{ default }}"]);

  const unrelatedEvent = prepareSentryEvent(
    {
      exception: {
        values: [{ type: "TypeError", value: "server_login_retry is not a function" }],
      },
    },
    "veryfront-api",
  );
  assertEquals(unrelatedEvent.fingerprint, ["veryfront-api", "{{ default }}"]);

  const pgbouncerCodeOnPlainError = prepareSentryEvent(
    {
      exception: {
        values: [{ type: "Error", value: "server_login_retry is not a client error" }],
      },
    },
    "veryfront-api",
  );
  assertEquals(pgbouncerCodeOnPlainError.fingerprint, ["veryfront-api", "{{ default }}"]);
});

it("policy collapses leading sql whitespace in Failed query titles", () => {
  const event = prepareSentryEvent(
    {
      exception: {
        values: [{
          type: "DrizzleQueryError",
          value: 'Failed query: \n  select "id", "email"\n  from "users"',
        }],
      },
    },
    "veryfront-studio",
  );

  assertEquals(
    event.exception?.values?.[0]?.value,
    'Failed query: select "id", "email" from "users"',
  );
});

it("policy excludes query parameters from Failed query titles", () => {
  const event = prepareSentryEvent(
    {
      exception: {
        values: [{
          type: "DrizzleQueryError",
          value: 'Failed query: \n  select "id" from "users"\nparams: customer@example.test',
        }],
      },
    },
    "veryfront-studio",
  );

  assertEquals(
    event.exception?.values?.[0]?.value,
    'Failed query: select "id" from "users"',
  );
});

it("policy redacts quoted SQL literals from Failed query titles", () => {
  const event = prepareSentryEvent(
    {
      exception: {
        values: [{
          type: "DrizzleQueryError",
          value:
            'Failed query: \n  select "id" from "orders" where "email" = \'customer@example.test\' and "note" = \'customer\'\'s private order\'',
        }],
      },
    },
    "veryfront-studio",
  );

  assertEquals(
    event.exception?.values?.[0]?.value,
    'Failed query: select "id" from "orders" where "email" = ? and "note" = ?',
  );
});

it("policy redacts dollar-quoted and numeric SQL literals without hiding query structure", () => {
  const event = prepareSentryEvent(
    {
      exception: {
        values: [{
          type: "DrizzleQueryError",
          value:
            'Failed query: \n  select "template2", "2024", $$customer@example.test$$, $order$ORDER-731$order$, $é$customer@example.test$é$, $𐐀$ORDER-742$𐐀$, 731, 18.75, 6.02e23 from "orders2" where "id" = $1',
        }],
      },
    },
    "veryfront-studio",
  );

  assertEquals(
    event.exception?.values?.[0]?.value,
    'Failed query: select "template2", "2024", ?, ?, ?, ?, ?, ?, ? from "orders2" where "id" = $1',
  );
});

it("policy redacts PostgreSQL radix integer literals", () => {
  const event = prepareSentryEvent(
    {
      exception: {
        values: [{
          type: "DrizzleQueryError",
          value:
            'Failed query: \n  select 0xDEADBEEF, 0o731, 0b101101 from "orders0x2" where "id" = $1',
        }],
      },
    },
    "veryfront-studio",
  );

  assertEquals(
    event.exception?.values?.[0]?.value,
    'Failed query: select ?, ?, ? from "orders0x2" where "id" = $1',
  );
});

it("policy redacts decimal integer separators without hiding SQL structure", () => {
  const event = prepareSentryEvent(
    {
      exception: {
        values: [{
          type: "DrizzleQueryError",
          value:
            'Failed query: \n  select 12_345_678, 0xDEAD_BEEF from orders_12_345 where "id" = $1',
        }],
      },
    },
    "veryfront-studio",
  );

  assertEquals(
    event.exception?.values?.[0]?.value,
    'Failed query: select ?, ? from orders_12_345 where "id" = $1',
  );
});

it("policy redacts fractional digit separators", () => {
  const event = prepareSentryEvent(
    {
      exception: {
        values: [{
          type: "DrizzleQueryError",
          value: 'Failed query: \n  select 12_345.67_89, .12_34 from "orders" where "id" = $1',
        }],
      },
    },
    "veryfront-studio",
  );

  assertEquals(
    event.exception?.values?.[0]?.value,
    'Failed query: select ?, ? from "orders" where "id" = $1',
  );
});

it("policy redacts exponent digit separators", () => {
  const event = prepareSentryEvent(
    {
      exception: {
        values: [{
          type: "DrizzleQueryError",
          value:
            'Failed query: \n  select 6.02e2_3, 1_2.3_4e+5_6, .5e-1_0 from "orders" where "id" = $1',
        }],
      },
    },
    "veryfront-studio",
  );

  assertEquals(
    event.exception?.values?.[0]?.value,
    'Failed query: select ?, ?, ? from "orders" where "id" = $1',
  );
});

it("policy redacts line comments from Failed query titles", () => {
  const event = prepareSentryEvent(
    {
      exception: {
        values: [{
          type: "DrizzleQueryError",
          value:
            'Failed query: \n  select "id" from "orders" -- customer@example.test\n  where "status" = \'ready\'',
        }],
      },
    },
    "veryfront-studio",
  );

  assertEquals(
    event.exception?.values?.[0]?.value,
    'Failed query: select "id" from "orders" ? where "status" = ?',
  );
});

it("policy redacts block comments without treating quoted comment markers as comments", () => {
  const event = prepareSentryEvent(
    {
      exception: {
        values: [{
          type: "DrizzleQueryError",
          value:
            'Failed query: \n  select "/* public_identifier */", $$-- template@example.test$$, \'/* private note */\', $1 /* order ORDER-731 */ from "orders"',
        }],
      },
    },
    "veryfront-studio",
  );

  assertEquals(
    event.exception?.values?.[0]?.value,
    'Failed query: select "/* public_identifier */", ?, ?, $1 ? from "orders"',
  );
});

it("policy caps collapsed Failed query values and leaves other values untouched", () => {
  const longSql = `\n  select ${"c, ".repeat(200)}from t`;
  const nonQueryError = "upstream select 'customer@example.test', 731 stays untouched";
  const event = prepareSentryEvent(
    {
      exception: {
        values: [
          { type: "DrizzleQueryError", value: `Failed query: ${longSql}` },
          { type: "Error", value: nonQueryError },
        ],
      },
    },
    "veryfront-studio",
  );

  const collapsed = event.exception?.values?.[0]?.value ?? "";
  assertEquals(collapsed.startsWith("Failed query: select c, c,"), true);
  assertEquals(collapsed.length <= "Failed query: ".length + 201, true);
  assertEquals(event.exception?.values?.[1]?.value, nonQueryError);
});

it("policy redacts long SQL literals before constructing the Sentry title", () => {
  const jwt = `${"a".repeat(16)}.${"b".repeat(16)}.${"c".repeat(180)}`;
  const queryHead = `\n  select '${"x".repeat(175)}${jwt}' from tokens`;
  const event = prepareSentryEvent(
    {
      exception: {
        values: [{ type: "DrizzleQueryError", value: `Failed query: ${queryHead}` }],
      },
    },
    "veryfront-studio",
  );

  const collapsed = event.exception?.values?.[0]?.value ?? "";
  assertEquals(collapsed, "Failed query: select ? from tokens");
  assertEquals(collapsed.includes("a".repeat(12)), false);
  assertEquals(collapsed.includes("c".repeat(20)), false);
});

it("policy redacts credentials from custom-host DSNs", () => {
  const event = prepareSentryEvent(
    {
      message: "failed to send to https://public:private@errors.example.test/42",
    },
    "veryfront-server",
  );

  assertEquals(
    event.message,
    "failed to send to https://[REDACTED]@errors.example.test/42",
  );
  assertEquals(event.message?.includes("public"), false);
  assertEquals(event.message?.includes("private"), false);
});

it("policy applies sanitized application error attributes to Sentry scope", () => {
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

it("policy isolates capture and scope failures from the original error path", () => {
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

it("policy keeps flush bounded and isolates SDK flush failures", async () => {
  const { sdk, state } = createSentrySdk();
  assertEquals(await flushWithSentryPolicy(sdk, 1_500), true);
  assertEquals(state.flushTimeouts, [1_500]);

  assertEquals(
    await flushWithSentryPolicy(createSentrySdk({ flushThrows: true }).sdk, 1_500),
    false,
  );
});
