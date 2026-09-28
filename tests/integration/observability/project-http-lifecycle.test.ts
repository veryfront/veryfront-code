import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
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

async function readySettings(token: string) {
  const config = await settings(token);
  await runProjectHttpTracing(
    config,
    identity,
    request,
    async () => new Response(null, { status: 204 }),
  );
  await flushProjectHttpTracing();
  return config;
}

describe("project HTTP exporter lifecycle", () => {
  it("serves the application while exporter initialization is pending", async () => {
    const owner = new OtlpTracingExporter();
    const create = owner.createProjectProvider.bind(owner);
    const ready = Promise.withResolvers<void>();
    const application = Promise.withResolvers<void>();
    owner.createProjectProvider = async (options) => {
      await ready.promise;
      return create(options);
    };
    register("TracingExporter", owner);
    let timer: ReturnType<typeof setTimeout> | undefined;
    let response: Promise<Response> | undefined;
    try {
      response = runProjectHttpTracing(await settings("pending"), identity, request, async () => {
        application.resolve();
        return new Response("application response");
      });
      await Promise.race([
        application.promise,
        new Promise<void>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error("application waited for telemetry")), 100);
        }),
      ]);
      assertEquals(await (await response).text(), "application response");
    } finally {
      clearTimeout(timer);
      ready.resolve();
      await response;
      await shutdownProjectHttpTracing();
      await owner.shutdown();
      unregister("TracingExporter");
    }
  });

  for (const outcome of ["close", "error", "cancel", "abort"] as const) {
    it(`retains project tracing until a response stream settles by ${outcome}`, async () => {
      const owner = new OtlpTracingExporter();
      register("TracingExporter", owner);
      const bodies: string[] = [];
      const abort = new AbortController();
      let pulls = 0;
      try {
        await withMockFetch(async (input, init) => {
          bodies.push(await new Request(input, init).text());
          return Response.json({});
        }, async () => {
          const response = await runProjectHttpTracing(
            await readySettings("stream"),
            identity,
            new Request(request.url, { signal: abort.signal }),
            async () =>
              new Response(
                new ReadableStream<Uint8Array>({
                  pull(controller) {
                    pulls++;
                    trace.getTracer("app").startSpan("stream.pull").end();
                    if (outcome === "error") throw new Error("source failed");
                    controller.enqueue(new TextEncoder().encode("data: hello\n\n"));
                    if (outcome === "close") controller.close();
                  },
                  cancel() {
                    trace.getTracer("app").startSpan("stream.cancel").end();
                  },
                }, { highWaterMark: 0 }),
                { headers: { "content-type": "text/event-stream" } },
              ),
          );
          await flushProjectHttpTracing();
          assertEquals(pulls, 0);
          assertEquals(bodies.some((body) => body.includes("http.server.request")), false);
          if (outcome === "close") assertEquals(await response.text(), "data: hello\n\n");
          else if (outcome === "error") {
            await assertRejects(() => response.text(), Error, "source failed");
          } else if (outcome === "cancel") await response.body!.cancel("disconnected");
          else {
            abort.abort("disconnected");
            await response.text();
          }
          await flushProjectHttpTracing();
          const spans = bodies.flatMap((body) =>
            JSON.parse(body).resourceSpans.flatMap(
              (
                resource: {
                  scopeSpans: {
                    spans: { name: string; spanId: string; parentSpanId?: string }[];
                  }[];
                },
              ) => resource.scopeSpans.flatMap((scope) => scope.spans),
            )
          );
          const roots = spans.filter((span) => span.name === "http.server.request");
          assertEquals(roots.length, 1);
          const children = spans.filter((span) => span.name.startsWith("stream."));
          assertEquals(children.length, 1);
          assertEquals(children[0].parentSpanId, roots[0].spanId);
        });
      } finally {
        await shutdownProjectHttpTracing();
        await owner.shutdown();
        unregister("TracingExporter");
      }
    });
  }

  for (const mode of ["abort", "cancel"] as const) {
    it(`finishes tracing when ${mode} leaves source cancellation pending`, async () => {
      const owner = new OtlpTracingExporter();
      register("TracingExporter", owner);
      const abort = new AbortController();
      const cancellation = Promise.withResolvers<void>();
      const bodies: string[] = [];
      try {
        await withMockFetch(async (input, init) => {
          bodies.push(await new Request(input, init).text());
          return Response.json({});
        }, async () => {
          const response = await runProjectHttpTracing(
            await readySettings("stalled"),
            identity,
            new Request(request.url, { signal: abort.signal }),
            async () =>
              new Response(
                new ReadableStream({
                  cancel: () => cancellation.promise,
                }),
              ),
          );
          let pending: Promise<void> | undefined;
          if (mode === "abort") abort.abort();
          else pending = response.body!.cancel();
          await new Promise((resolve) => setTimeout(resolve, 1100));
          await flushProjectHttpTracing();
          assertEquals(bodies.some((body) => body.includes("http.server.request")), true);
          cancellation.resolve();
          await pending;
        });
      } finally {
        cancellation.resolve();
        await shutdownProjectHttpTracing();
        await owner.shutdown();
        unregister("TracingExporter");
      }
    });
  }

  it("preserves queued application spans when a control-plane request defers config", async () => {
    const owner = new OtlpTracingExporter();
    register("TracingExporter", owner);
    const bodies: string[] = [];
    try {
      await withMockFetch(async (input, init) => {
        bodies.push(await new Request(input, init).text());
        return Response.json({});
      }, async () => {
        await runProjectHttpTracing(await readySettings("active"), identity, request, async () => {
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
        await runProjectHttpTracing(await readySettings("old"), identity, request, async () => {
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
          await readySettings("failed"),
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
        const first = runProjectHttpTracing(
          await readySettings("old"),
          identity,
          request,
          async () => {
            entered.resolve();
            await release.promise;
            trace.getTracer("app").startSpan("old.custom").end();
            return new Response("old");
          },
        );
        await entered.promise;
        await runProjectHttpTracing(await readySettings("new"), identity, request, async () => {
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
