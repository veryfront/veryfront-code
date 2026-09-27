import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { OtlpTracingExporter } from "../../../extensions/ext-observability-opentelemetry/src/index.ts";
import {
  _resetShimForTests,
  setGlobalTracerProvider,
  trace as platformTrace,
  type TracerProvider,
} from "#veryfront/observability/tracing/api-shim.ts";
import { getTraceContext, setActiveSpanAttributes, trace, withSpan } from "veryfront/observability";
import { createChildSpan, endSpan, startSpan, withActiveSpan } from "veryfront/observability";
import { runWithProjectTraceProvider } from "#veryfront/observability/tracing/project-trace-scope.ts";

type Payload = {
  resourceSpans: {
    resource: { attributes: { key: string; value: { stringValue?: string } }[] };
    scopeSpans: {
      spans: {
        name: string;
        spanId: string;
        parentSpanId?: string;
        traceId: string;
        attributes: { key: string; value: { stringValue?: string } }[];
      }[];
    }[];
  }[];
};

describe("project trace SDK provider", () => {
  it("retains project ownership for explicit parent helpers outside the request scope", async () => {
    const owner = new OtlpTracingExporter();
    const received: Payload[] = [];
    const session = await owner.createProjectProvider({
      resource: { "service.name": "detached" },
      createTransport: () => ({
        send: (data) => {
          received.push(JSON.parse(new TextDecoder().decode(data)));
          return Promise.resolve({ status: "success" });
        },
        shutdown() {},
      }),
    });
    try {
      for (const useRawTracer of [false, true]) {
        const parent = runWithProjectTraceProvider(
          session,
          () =>
            useRawTracer
              ? trace.getTracer("app").startSpan("retained.parent")
              : startSpan("retained.parent"),
        );
        assertExists(parent);
        const child = createChildSpan(parent, "detached.child");
        assertExists(child);
        endSpan(child);
        await withActiveSpan(parent, async () => {
          await Promise.resolve();
          assertEquals(getTraceContext().spanId, parent.spanContext().spanId);
          await withSpan("detached.active-child", async (span) => {
            assertExists(span);
          });
        });
        endSpan(parent);
      }
      await session.forceFlush();
      const spans = received.flatMap((p) =>
        p.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans))
      );
      assertEquals(spans.length, 6);
      for (const child of spans.filter((span) => span.name.startsWith("detached."))) {
        assertExists(
          spans.find((parent) =>
            parent.name === "retained.parent" && parent.spanId === child.parentSpanId
          ),
        );
      }
    } finally {
      await owner.shutdown();
    }
  });

  it("ends public helper spans outside their original scope and revokes queued export", async () => {
    const owner = new OtlpTracingExporter();
    const received: Payload[] = [];
    const session = await owner.createProjectProvider({
      resource: { "service.name": "late-span" },
      createTransport: () => ({
        send: (data) => {
          received.push(JSON.parse(new TextDecoder().decode(data)));
          return Promise.resolve({ status: "success" });
        },
        shutdown() {},
      }),
    });
    try {
      const late = runWithProjectTraceProvider(session, () => startSpan("late.custom"));
      assertExists(late);
      assertEquals(session.hasActiveSpans(), true);
      endSpan(late);
      assertEquals(session.hasActiveSpans(), false);
      await session.forceFlush();
      assertEquals(
        received.flatMap((p) =>
          p.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans))
        ).length,
        1,
      );
      runWithProjectTraceProvider(
        session,
        () => trace.getTracer("application").startSpan("revoked").end(),
      );
      await session.shutdown(true);
      await session.forceFlush();
      assertEquals(received.length, 1);
    } finally {
      await owner.shutdown();
    }
  });

  it("keeps private active spans and resources separate across concurrent projects", async () => {
    const owner = new OtlpTracingExporter();
    const platformRecords: Payload[] = [];
    const platform = await owner.createProjectProvider({
      resource: { "service.name": "platform" },
      createTransport: () => ({
        send: (data) => {
          platformRecords.push(JSON.parse(new TextDecoder().decode(data)));
          return Promise.resolve({ status: "success" });
        },
        shutdown() {},
      }),
    });
    setGlobalTracerProvider(platform.getProvider() as TracerProvider);
    const received = new Map<string, Payload[]>();
    const sessions = await Promise.all(["a", "b"].map(async (id) => {
      received.set(id, []);
      return owner.createProjectProvider({
        resource: { "service.name": id, "project.id": id },
        createTransport: () => ({
          send: (data) => {
            received.get(id)!.push(JSON.parse(new TextDecoder().decode(data)));
            return Promise.resolve({ status: "success" });
          },
          shutdown() {},
        }),
      });
    }));
    try {
      const cached = trace.getTracer("cached-application");
      await Promise.all(
        sessions.flatMap((session, project) =>
          Array.from({ length: 100 }, async () => {
            await runWithProjectTraceProvider(session, () =>
              cached.startActiveSpan(`request.${project}`, async (root) => {
                await Promise.resolve();
                platformTrace.getTracer("framework").startSpan("platform-only").end();
                assertEquals(
                  trace.getActiveSpan()?.spanContext().spanId,
                  root.spanContext().spanId,
                );
                assertEquals(getTraceContext().spanId, root.spanContext().spanId);
                setActiveSpanAttributes({ "application.active": "project" });
                await withSpan(`custom.${project}`, async (child) => {
                  assertExists(child);
                });
                root.end();
              }));
          })
        ),
      );
      await Promise.all(sessions.map((session) => session.forceFlush()));
      await platform.forceFlush();
      assertEquals(
        platformRecords.flatMap((p) =>
          p.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans))
        ).length,
        200,
      );
      for (const [index, id] of ["a", "b"].entries()) {
        const spans = received.get(id)!.flatMap((payload) =>
          payload.resourceSpans.flatMap((group) => {
            assertEquals(
              group.resource.attributes.find((attr) => attr.key === "project.id")?.value
                .stringValue,
              id,
            );
            return group.scopeSpans.flatMap((scope) => scope.spans);
          })
        );
        assertEquals(spans.length, 200);
        for (const root of spans.filter((span) => span.name.startsWith("request"))) {
          assertEquals(
            root.attributes.find((a) => a.key === "application.active")?.value.stringValue,
            "project",
          );
        }
        for (const child of spans.filter((span) => span.name.startsWith("custom"))) {
          assertEquals(child.name, `custom.${index}`);
          const parent = spans.find((span) => span.spanId === child.parentSpanId);
          assertExists(parent);
          assertEquals(parent.name, `request.${index}`);
          assertEquals(parent.traceId, child.traceId);
        }
      }
    } finally {
      await Promise.all(sessions.map((session) => session.shutdown(true)));
      await owner.shutdown();
      _resetShimForTests();
    }
  });
});
