import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { register } from "#veryfront/extensions/contracts.ts";
import { wireTracingShim } from "#veryfront/server/bootstrap.ts";
import { instrumentHttpHandler, trace } from "veryfront/observability";
import extOpenTelemetry from "../../../extensions/ext-observability-opentelemetry/src/index.ts";

// A fresh process prevents one case's global SDK from affecting the next case.
const enabled = Deno.args[0] === "enabled";
for (const key of Object.keys(Deno.env.toObject())) {
  if (key.startsWith("OTEL_") || key.startsWith("DD_") || key === "VERYFRONT_OTEL") {
    Deno.env.delete(key);
  }
}

type Attribute = { key: string; value: { stringValue?: string } };
type ExportedSpan = { name: string; traceId: string; spanId: string; parentSpanId?: string };
type TracePayload = {
  resourceSpans: {
    resource: { attributes: Attribute[] };
    scopeSpans: { spans: ExportedSpan[] }[];
  }[];
};
const received: { path: string; authorization: string | null; payload: TracePayload }[] = [];
const collector = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (req) => {
  received.push({
    path: new URL(req.url).pathname,
    authorization: req.headers.get("authorization"),
    payload: await req.json(),
  });
  return Response.json({});
});

Deno.env.set("OTEL_TRACES_ENABLED", String(enabled));
Deno.env.set("OTEL_LOGS_ENABLED", "false");
Deno.env.set("OTEL_METRICS_ENABLED", "false");
Deno.env.set("OTEL_SERVICE_NAME", "local-app-test");
Deno.env.set("OTEL_EXPORTER_OTLP_ENDPOINT", `http://127.0.0.1:${collector.addr.port}/otlp`);
Deno.env.set("OTEL_EXPORTER_OTLP_HEADERS", "Authorization=Bearer test-collector-token");

const extension = extOpenTelemetry();
let app: Deno.HttpServer<Deno.NetAddr> | undefined;
try {
  await extension.setup!({
    config: {},
    provide: register,
    get: () => undefined,
    require: () => {
      throw new Error("Unexpected contract dependency");
    },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
  });
  // Use the production bootstrap bridge, not a recording tracer or fake exporter.
  wireTracingShim();
  const tracer = trace.getTracer("local-app");
  app = Deno.serve(
    { hostname: "127.0.0.1", port: 0, onListen() {} },
    instrumentHttpHandler(() => {
      const span = tracer.startSpan("app.greeting");
      span.end();
      return new Response("hello");
    }),
  );
  const response = await fetch(`http://127.0.0.1:${app.addr.port}/hello`);
  assertEquals(response.status, 200);
  assertEquals(await response.text(), "hello");

  // The SDK batches on a timer. Shutdown must drain the batch without a sleep.
  await extension.teardown!();
  if (!enabled) {
    assertEquals(received.length, 0);
  } else {
    assertEquals(received.length > 0, true);
    const spans = received.flatMap(({ path, authorization, payload }) => {
      assertEquals(path, "/otlp/v1/traces");
      assertEquals(authorization, "Bearer test-collector-token");
      return payload.resourceSpans.flatMap(({ resource, scopeSpans }) => {
        assertEquals(
          resource.attributes.find(({ key }) => key === "service.name")?.value.stringValue,
          "local-app-test",
        );
        return scopeSpans.flatMap(({ spans }) => spans);
      });
    });
    const request = spans.find(({ name }) => name === "http.server.request");
    const custom = spans.find(({ name }) => name === "app.greeting");
    assertExists(request);
    assertExists(custom);
    assertEquals(custom.traceId, request.traceId);
    assertEquals(custom.parentSpanId, request.spanId);
  }
} finally {
  await extension.teardown!();
  await app?.shutdown();
  await collector.shutdown();
}
