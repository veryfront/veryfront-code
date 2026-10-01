import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { trace } from "veryfront/observability";
import { createHostedHttpBroker } from "veryfront/server/http-broker";
import { createHostedExecutorSession } from "#veryfront/agent/hosted/executor-session.ts";
import { resolveProjectTraceConfig } from "#veryfront/server/project-env/telemetry-config.ts";
import {
  flushProjectHttpTracing,
  runProjectHttpTracing,
  shutdownProjectHttpTracing,
} from "#veryfront/observability/tracing/project-http-tracing.ts";
import { OtlpTracingExporter } from "../../../extensions/ext-observability-opentelemetry/src/index.ts";
import { createHostedHttpFixture } from "../../fixtures/hosted-http-broker.ts";

type Span = { name: string; spanId: string; parentSpanId?: string; traceId: string };
type Payload = {
  resourceSpans: {
    resource: { attributes: { key: string; value: { stringValue?: string } }[] };
    scopeSpans: { spans: Span[] }[];
  }[];
};

it("exports 100 interleaved executor requests per project without mixed destinations or ownership", async () => {
  // Project providers work without starting the platform exporter.
  const exporter = new OtlpTracingExporter();
  register("TracingExporter", exporter);
  const deliveries: { url: string; authorization: string | null; payload: Payload }[] = [];
  const settled: Promise<void>[] = [];
  const broker = createHostedHttpBroker({
    maxActive: 2,
    createSession(options) {
      const session = createHostedExecutorSession(options);
      settled.push(session.settled);
      return session;
    },
  });
  const projects = ["project-a", "project-b"];
  const tracer = trace.getTracer("cached.application.tracer");
  const attackerTrace = `00-${"a".repeat(32)}-${"b".repeat(16)}-01`;
  try {
    await withMockFetch(async (input, init) => {
      const request = new Request(input, init);
      deliveries.push({
        url: request.url,
        authorization: request.headers.get("authorization"),
        payload: JSON.parse(await request.text()),
      });
      return Response.json({});
    }, async () => {
      const settings = await Promise.all(projects.map(async (projectId) => {
        const identity = { projectId, environmentId: "environment-a" };
        const result = await resolveProjectTraceConfig(identity, [{
          name: "ext-observability-opentelemetry",
        }], {
          OTEL_TRACES_ENABLED: "true",
          OTEL_EXPORTER_OTLP_ENDPOINT: `https://${projectId}.example`,
          OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer test-${projectId}`,
        });
        assertEquals(result.status, "enabled");
        await runProjectHttpTracing(
          result,
          identity,
          new Request("https://application.example"),
          () => Promise.resolve(new Response(null, { status: 204 })),
        );
        return result;
      }));
      await flushProjectHttpTracing();
      deliveries.length = 0;
      for (const [projectIndex, projectId] of projects.entries()) {
        for (const invalid of ["allocation", "source", "configuration"]) {
          const fixture = createHostedHttpFixture(
            () => new Response("must not execute"),
            undefined,
            projectId,
          );
          if (invalid === "allocation") fixture.input.session.request.invocationId = "invalid";
          if (invalid === "source") {
            fixture.input.installation.source = { type: "release", releaseId: "foreign-release" };
          }
          if (invalid === "configuration") {
            fixture.input.configuration = {
              projectId,
              projectSlug: projectId,
              releaseId: "foreign-release",
              environmentId: "environment-a",
              environmentName: "production",
              configurationId: "config-a",
              variables: {},
            };
          }
          await assertRejects(
            () =>
              broker.fetch(new Request("https://application.example/rejected"), {
                ...fixture.input,
                projectTracing: settings[projectIndex]!,
              }),
            Error,
          );
          assertEquals(fixture.calls, []);
          await flushProjectHttpTracing();
          assertEquals(deliveries.length, 0, "Rejected authority must not enter project telemetry");
        }
      }
      for (let index = 0; index < 100; index++) {
        const responses = await Promise.all(projects.map((projectId, projectIndex) => {
          const fixture = createHostedHttpFixture(
            (request) => {
              assertEquals(request.headers.get("authorization"), "Bearer application");
              assertEquals(request.headers.get("x-token"), null);
              assertEquals(request.headers.get("x-veryfront-key"), null);
              tracer.startSpan(`${projectId}.handler`, { attributes: { "project.id": "foreign" } })
                .end();
              return new Response(
                new ReadableStream({
                  pull(controller) {
                    tracer.startSpan(`${projectId}.stream`).end();
                    controller.enqueue(new TextEncoder().encode(projectId));
                    controller.close();
                  },
                }, { highWaterMark: 0 }),
              );
            },
            undefined,
            projectId,
          );
          return broker.fetch(
            new Request(`https://application.example/${index}`, {
              headers: {
                authorization: "Bearer application",
                "x-token": "host-only",
                "x-veryfront-key": "host-only",
                traceparent: attackerTrace,
                baggage: "project.id=foreign",
              },
            }),
            { ...fixture.input, projectTracing: settings[projectIndex]! },
          );
        }));
        // Consume in the opposite order after both executor request scopes return.
        assertEquals(await responses[1]!.text(), "project-b");
        assertEquals(await responses[0]!.text(), "project-a");
        await Promise.all(settled.splice(0));
        assertEquals(broker.active, 0);
      }
      await flushProjectHttpTracing();
      const spansByProject = new Map(projects.map((project) => [project, [] as Span[]]));
      for (const delivery of deliveries) {
        for (const resource of delivery.payload.resourceSpans) {
          const attributes = Object.fromEntries(
            resource.resource.attributes.map(({ key, value }) => [key, value.stringValue]),
          );
          const projectId = attributes["project.id"]!;
          const spans = spansByProject.get(projectId);
          assertExists(spans);
          assertEquals(attributes["environment.id"], "environment-a");
          assertEquals(delivery.url, `https://${projectId}.example/v1/traces`);
          assertEquals(delivery.authorization, `Bearer test-${projectId}`);
          spans.push(...resource.scopeSpans.flatMap((scope) => scope.spans));
        }
      }
      for (const [projectId, spans] of spansByProject) {
        const parents = spans.filter((span) => span.name === "http.server.request");
        assertEquals(parents.length, 100);
        assertEquals(spans.filter((span) => span.name === `${projectId}.handler`).length, 100);
        assertEquals(spans.filter((span) => span.name === `${projectId}.stream`).length, 100);
        assertEquals(spans.length, 300);
        const byTrace = new Map(parents.map((span) => [span.traceId, span]));
        assertEquals(byTrace.size, 100);
        for (const span of spans) {
          assertEquals(span.traceId === "a".repeat(32), false);
          if (span.name !== "http.server.request") {
            const parent = byTrace.get(span.traceId);
            assertExists(parent);
            assertEquals(span.parentSpanId, parent.spanId);
          }
        }
      }
    });
  } finally {
    await broker.shutdown();
    await broker.settled;
    await shutdownProjectHttpTracing();
    await exporter.shutdown();
    unregister("TracingExporter");
  }
});
