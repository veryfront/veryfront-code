import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { register, unregister } from "#veryfront/extensions/contracts.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { trace } from "veryfront/observability";
import { resolveProjectTraceConfig } from "#veryfront/server/project-env/telemetry-config.ts";
import {
  flushProjectHttpTracing,
  runProjectHttpTracing,
  shutdownProjectHttpTracing,
} from "#veryfront/observability/tracing/project-http-tracing.ts";
import { OtlpTracingExporter } from "../../../extensions/ext-observability-opentelemetry/src/index.ts";

const identity = { projectId: "project", environmentId: "preview" };
const request = new Request("https://application.example/api/hello");
const declarations = [{ name: "ext-observability-opentelemetry" }];
async function settings(token: string) {
  return await resolveProjectTraceConfig(identity, declarations, {
    OTEL_TRACES_ENABLED: "true",
    OTEL_EXPORTER_OTLP_ENDPOINT: "https://collector.example",
    OTEL_EXPORTER_OTLP_HEADERS: `Authorization=Bearer ${token}`,
  });
}

describe("project HTTP exporter lifecycle", () => {
  it("preserves queued application spans when a control-plane request defers config", async () => {
    const owner = new OtlpTracingExporter();
    register("TracingExporter", owner);
    const bodies: string[] = [];
    try {
      await withMockFetch(async (input, init) => {
        bodies.push(await new Request(input, init).text());
        return Response.json({});
      }, async () => {
        await runProjectHttpTracing(await settings("active"), identity, request, async () => {
          trace.getTracer("app").startSpan("retained.custom").end();
          return new Response("ok");
        });
        await runProjectHttpTracing(
          { status: "deferred" },
          identity,
          new Request("https://application.example/api/control-plane/runs/run-1/stream", {
            method: "POST",
          }),
          () => Promise.resolve(new Response("control plane")),
        );
        await flushProjectHttpTracing();
        assertEquals(bodies.some((body) => body.includes("retained.custom")), true);
      });
    } finally {
      await shutdownProjectHttpTracing();
      await owner.shutdown();
      unregister("TracingExporter");
    }
  });

  it("discards queued records when refreshed settings disable export", async () => {
    const owner = new OtlpTracingExporter();
    register("TracingExporter", owner);
    let requests = 0;
    try {
      await withMockFetch(() => {
        requests++;
        return Promise.resolve(Response.json({}));
      }, async () => {
        await runProjectHttpTracing(await settings("old"), identity, request, async () => {
          trace.getTracer("app").startSpan("queued.custom").end();
          return new Response("ok");
        });
        await runProjectHttpTracing(
          { status: "disabled" },
          identity,
          request,
          () => Promise.resolve(new Response("still ok")),
        );
        await flushProjectHttpTracing();
        assertEquals(requests, 0);
      });
    } finally {
      await shutdownProjectHttpTracing();
      await owner.shutdown();
      unregister("TracingExporter");
    }
  });

  it("keeps a failed collector from changing application responses and bounds retry", async () => {
    const owner = new OtlpTracingExporter();
    register("TracingExporter", owner);
    let requests = 0;
    try {
      await withMockFetch(() => {
        requests++;
        return Promise.resolve(new Response("untrusted collector body", { status: 503 }));
      }, async () => {
        const response = await runProjectHttpTracing(
          await settings("failed"),
          identity,
          request,
          () => Promise.resolve(new Response("application response")),
        );
        assertEquals(await response.text(), "application response");
        await flushProjectHttpTracing();
        assertEquals(requests, 2);
      });
    } finally {
      await shutdownProjectHttpTracing();
      await owner.shutdown();
      unregister("TracingExporter");
    }
  });

  it("retains the original destination for an active request during credential rotation", async () => {
    const owner = new OtlpTracingExporter();
    register("TracingExporter", owner);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const captures: { authorization: string | null; body: string }[] = [];
    try {
      await withMockFetch(async (input, init) => {
        const req = new Request(input, init);
        captures.push({ authorization: req.headers.get("authorization"), body: await req.text() });
        return Response.json({});
      }, async () => {
        const first = runProjectHttpTracing(await settings("old"), identity, request, async () => {
          entered.resolve();
          await release.promise;
          trace.getTracer("app").startSpan("old.custom").end();
          return new Response("old");
        });
        await entered.promise;
        await runProjectHttpTracing(await settings("new"), identity, request, async () => {
          trace.getTracer("app").startSpan("new.custom").end();
          return new Response("new");
        });
        release.resolve();
        await first;
        await flushProjectHttpTracing();
        await shutdownProjectHttpTracing();
        assertEquals(
          captures.some((c) => c.authorization === "Bearer old" && c.body.includes("old.custom")),
          true,
        );
        assertEquals(
          captures.some((c) => c.authorization === "Bearer new" && c.body.includes("new.custom")),
          true,
        );
        assertEquals(
          captures.some((c) => c.authorization === "Bearer old" && c.body.includes("new.custom")),
          false,
        );
        assertEquals(
          captures.some((c) => c.authorization === "Bearer new" && c.body.includes("old.custom")),
          false,
        );
      });
    } finally {
      release.resolve();
      await shutdownProjectHttpTracing();
      await owner.shutdown();
      unregister("TracingExporter");
    }
  });
});
