import { context } from "npm:@opentelemetry/api@1.9.1";
import { suppressTracing } from "npm:@opentelemetry/core@2.10.0";
import { AsyncLocalStorageContextManager } from "npm:@opentelemetry/context-async-hooks@2.10.0";
import { BasicTracerProvider, BatchSpanProcessor } from "npm:@opentelemetry/sdk-trace-base@2.10.0";
import { resourceFromAttributes } from "npm:@opentelemetry/resources@2.10.0";
import {
  createOtlpNetworkExportDelegate,
  ExporterMetrics,
  OTLPExporterBase,
} from "npm:@opentelemetry/otlp-exporter-base@0.221.0";
import {
  JsonTraceSerializer,
  TraceExporterMetricsHelper,
} from "npm:@opentelemetry/otlp-transformer@0.221.0";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { createProjectOtlpTransport } from "#veryfront/observability/tracing/project-otlp-transport.ts";

for (const key of Object.keys(Deno.env.toObject())) {
  if (key.startsWith("OTEL_")) Deno.env.delete(key);
}
Deno.env.set("VERYFRONT_HOST_ALLOW_INTERNAL_EGRESS", "false");

type Payload = {
  resourceSpans: {
    resource: { attributes: { key: string; value: { stringValue?: string } }[] };
    scopeSpans: { spans: { name: string }[] }[];
  }[];
};
const received: { url: string; auth: string | null; payload: Payload }[] = [];
const collector = Deno.serve({ hostname: "127.0.0.1", port: 0, onListen() {} }, async (req) => {
  received.push({
    url: req.url,
    auth: req.headers.get("authorization"),
    payload: await req.json(),
  });
  return Response.json({}, { headers: { connection: "close" } });
});
const origin = `http://127.0.0.1:${collector.addr.port}`;
// Authorize only this test collector. The production guarded/pinned transport remains installed.
Deno.env.set("VERYFRONT_HOST_ALLOWED_INTERNAL_PROVIDER_ORIGINS", origin);
const manager = new AsyncLocalStorageContextManager().enable();
context.setGlobalContextManager(manager);
const transport = createProjectOtlpTransport({
  endpoint: `${origin}/v1/traces`,
  headers: { authorization: "Bearer synthetic-project-token" },
  withSuppressedTracing: (operation) => context.with(suppressTracing(context.active()), operation),
});
const exporter = new OTLPExporterBase(createOtlpNetworkExportDelegate(
  { timeoutMillis: 1000, concurrencyLimit: 1, compression: "none" },
  JsonTraceSerializer,
  new ExporterMetrics({
    componentType: "otlp_http_span_exporter",
    metricsHelper: TraceExporterMetricsHelper,
    url: `${origin}/v1/traces`,
    meterProvider: undefined,
    responseAttributesFromError: () => ({}),
  }),
  transport,
));
const provider = new BasicTracerProvider({
  resource: resourceFromAttributes({ "service.name": "project-transport-test" }),
  spanProcessors: [new BatchSpanProcessor(exporter)],
});
try {
  provider.getTracer("application").startSpan("application.request").end();
  await provider.forceFlush();
  assertEquals(received.length, 1);
  const request = received[0]!;
  assertEquals(request.url, `${origin}/v1/traces`);
  assertEquals(request.auth, "Bearer synthetic-project-token");
  const resource = request.payload.resourceSpans[0]!;
  assertEquals(
    resource.resource.attributes.find(({ key }) => key === "service.name")?.value.stringValue,
    "project-transport-test",
  );
  assertEquals(resource.scopeSpans[0]!.spans[0]!.name, "application.request");
} finally {
  transport.shutdown();
  await provider.shutdown();
  context.disable();
  manager.disable();
  await collector.shutdown();
}
