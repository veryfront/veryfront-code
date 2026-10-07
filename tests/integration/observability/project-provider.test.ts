import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { createWorkerTraceRecorder } from "#veryfront/observability/tracing/worker-trace-recorder.ts";
import { OtlpTracingExporter } from "../../../extensions/ext-observability-opentelemetry/src/index.ts";
import {
  _resetShimForTests,
  createPublicSpan,
  setGlobalTracerProvider,
  type Span,
  trace as platformTrace,
  type TracerProvider,
} from "#veryfront/observability/tracing/api-shim.ts";
import { getTraceContext, setActiveSpanAttributes, trace, withSpan } from "veryfront/observability";
import {
  addSpanEvent,
  createChildSpan,
  endSpan,
  getActiveContext,
  injectContext,
  setSpanAttributes,
  startSpan,
  withActiveSpan,
  withSpanSync,
} from "veryfront/observability";
import {
  getContextProjectProvider,
  getSpanProjectProvider,
  rememberProjectContext,
  runWithProjectTraceProvider,
} from "#veryfront/observability/tracing/project-trace-scope.ts";

type Payload = {
  resourceSpans: {
    resource: { attributes: { key: string; value: { stringValue?: string } }[] };
    scopeSpans: {
      spans: {
        name: string;
        spanId: string;
        parentSpanId?: string;
        links?: {
          traceId: string;
          spanId: string;
          attributes: { key: string; value: { stringValue?: string } }[];
        }[];
        events?: { name: string }[];
        traceId: string;
        attributes: { key: string; value: { stringValue?: string } }[];
      }[];
    }[];
  }[];
};

describe("project trace SDK provider", () => {
  it("preserves a retained child when its worker root ends after request closure", async () => {
    const owner = new OtlpTracingExporter();
    const received: Payload[] = [];
    const session = await owner.createProjectProvider({
      resource: { "project.id": "host-project" },
      createTransport: () => ({
        send: (data) => {
          received.push(JSON.parse(new TextDecoder().decode(data)));
          return Promise.resolve({ status: "success" as const });
        },
        shutdown() {},
      }),
    });
    const parent = { traceId: "1".repeat(32), spanId: "2".repeat(16), traceFlags: 1 };
    const recorder = createWorkerTraceRecorder(`00-${parent.traceId}-${parent.spanId}-01`)!;
    let rootContext: { traceId: string; spanId: string } | undefined;
    try {
      recorder.run(() =>
        trace.getTracer("app").startActiveSpan(
          "unfinished-root",
          { root: true } as import("#veryfront/observability/tracing/api-shim.ts").SpanStartOptions,
          (root) => {
            rootContext = root.spanContext();
            trace.getTracer("app").startSpan("retained-child").end();
          },
        )
      );
      session.importSpans!(recorder.finish(), parent);
      await session.forceFlush();
      const child = received[0]!.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
      assertEquals(child.traceId, rootContext!.traceId);
      assertEquals(child.parentSpanId, rootContext!.spanId);
      assertEquals(
        child.attributes.find((a) => a.key === "project.id")?.value.stringValue,
        "host-project",
      );
    } finally {
      await owner.shutdown();
    }
  });

  it("preserves bounded worker span links through host export", async () => {
    const owner = new OtlpTracingExporter();
    const received: Payload[] = [];
    const session = await owner.createProjectProvider({
      resource: { "service.name": "worker-links" },
      createTransport: () => ({
        send: (data) => {
          received.push(JSON.parse(new TextDecoder().decode(data)));
          return Promise.resolve({ status: "success" as const });
        },
        shutdown() {},
      }),
    });
    const parent = { traceId: "1".repeat(32), spanId: "2".repeat(16), traceFlags: 1 };
    const link = {
      context: { traceId: "3".repeat(32), spanId: "4".repeat(16), traceFlags: 1 },
      attributes: { reason: "cause" },
    };
    const recorder = createWorkerTraceRecorder(`00-${parent.traceId}-${parent.spanId}-01`)!;
    try {
      recorder.run(() =>
        trace.getTracer("linked-app").startSpan("linked", { links: Array(12).fill(link) }).end()
      );
      session.importSpans!(recorder.finish(), parent);
      await session.forceFlush();
      const span = received[0]!.resourceSpans[0]!.scopeSpans[0]!.spans[0]!;
      assertEquals(span.links?.length, 8);
      assertEquals(span.links?.[0]?.traceId, link.context.traceId);
      assertEquals(span.links?.[0]?.spanId, link.context.spanId);
      assertEquals(span.links?.[0]?.attributes[0]?.value.stringValue, "cause");
    } finally {
      await owner.shutdown();
    }
  });

  it("imports bounded worker spans only under the host request identity", async () => {
    const owner = new OtlpTracingExporter();
    const received: Payload[] = [];
    const session = await owner.createProjectProvider({
      resource: { "project.id": "host-project", "environment.id": "host-env" },
      createTransport: () => ({
        send: (data) => {
          received.push(JSON.parse(new TextDecoder().decode(data)));
          return Promise.resolve({ status: "success" as const });
        },
        shutdown() {},
      }),
    });
    const parent = { traceId: "1".repeat(32), spanId: "2".repeat(16), traceFlags: 1 };
    const record = {
      name: "worker.custom",
      spanId: "3".repeat(16),
      parentSpanId: "invalid",
      traceId: "invalid",
      kind: 0,
      startTime: Date.now(),
      endTime: Date.now(),
      attributes: { "project.id": "spoofed", "environment.id": "spoofed", value: "kept" },
    };
    try {
      session.importSpans!("invalid json", parent);
      session.importSpans!(JSON.stringify([record, record]), parent);
      session.importSpans!(" ".repeat(256 * 1024 + 1), parent);
      session.importSpans!(JSON.stringify([record]), parent);
      await session.forceFlush();
      const spans = received.flatMap((p) =>
        p.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans))
      );
      assertEquals(spans.length, 1);
      assertEquals(spans[0]!.traceId, parent.traceId);
      assertEquals(spans[0]!.parentSpanId, parent.spanId);
      assertEquals(
        spans[0]!.attributes.find((a) => a.key === "project.id")?.value.stringValue,
        "host-project",
      );
      assertEquals(
        spans[0]!.attributes.find((a) => a.key === "environment.id")?.value.stringValue,
        "host-env",
      );
      await session.shutdown(true);
      session.importSpans!(JSON.stringify([record]), parent);
      assertEquals(received.length, 1);
    } finally {
      await owner.shutdown();
    }
  });

  it("does not adopt a foreign provider span or its context", async () => {
    const owner = new OtlpTracingExporter();
    const options = {
      resource: { "service.name": "ownership" },
      createTransport: () => ({
        send: () => Promise.resolve({ status: "success" as const }),
        shutdown() {},
      }),
    };
    const project = await owner.createProjectProvider(options);
    const foreign = await owner.createProjectProvider(options);
    const foreignTracer = foreign.getProvider().getTracer(
      "platform",
    ) as import("npm:@opentelemetry/api@1.9.1").Tracer;
    const raw = foreignTracer.startSpan("platform.request") as unknown as Span;
    try {
      runWithProjectTraceProvider(project, () => {
        createPublicSpan(raw);
        const context = project.getTraceAPI().setSpan(
          project.getContextAPI().active(),
          raw,
        ) as import("#veryfront/observability/tracing/api-shim.ts").Context;
        rememberProjectContext(context);
        assertEquals(getSpanProjectProvider(raw), undefined);
        assertEquals(getContextProjectProvider(context), undefined);
      });
    } finally {
      raw.end();
      await owner.shutdown();
    }
  });

  it("sets trusted resource attributes without inherited setters", async () => {
    const owner = new OtlpTracingExporter();
    const exported: Payload[] = [];
    const session = await owner.createProjectProvider({
      resource: { "project.id": "owner", "environment.id": "preview" },
      createTransport: () => ({
        send: (data) => {
          exported.push(JSON.parse(new TextDecoder().decode(data)));
          return Promise.resolve({ status: "success" as const });
        },
        shutdown() {},
      }),
    });
    const tracer = session.getProvider().getTracer(
      "app",
    ) as import("npm:@opentelemetry/api@1.9.1").Tracer;
    const span = tracer.startSpan("resource.private", {
      attributes: { marker: "synthetic-private" },
    });
    const keys = ["project.id", "environment.id"];
    const originals = keys.map((key) => Object.getOwnPropertyDescriptor(Object.prototype, key));
    let exposed = 0;
    try {
      for (const key of keys) {
        Object.defineProperty(Object.prototype, key, {
          configurable: true,
          set(value) {
            if (this.marker === "synthetic-private") exposed++;
            Object.defineProperty(this, key, {
              value,
              enumerable: true,
              configurable: true,
              writable: true,
            });
          },
        });
      }
      span.end();
    } finally {
      for (let index = 0; index < keys.length; index++) {
        const descriptor = originals[index];
        if (descriptor) Object.defineProperty(Object.prototype, keys[index]!, descriptor);
        else Reflect.deleteProperty(Object.prototype, keys[index]!);
      }
      try {
        await session.forceFlush();
      } finally {
        await owner.shutdown();
      }
    }
    assertEquals(exposed, 0);
    assertEquals(exported.length, 1);
    const attributes = exported[0]!.resourceSpans[0]!.scopeSpans[0]!.spans[0]!.attributes;
    assertEquals(attributes.find(({ key }) => key === "project.id")?.value.stringValue, "owner");
    assertEquals(
      attributes.find(({ key }) => key === "environment.id")?.value.stringValue,
      "preview",
    );
  });

  it("measures queued payloads without a replaceable byteLength getter", async () => {
    const owner = new OtlpTracingExporter();
    const session = await owner.createProjectProvider({
      resource: { "service.name": "private-byte-length" },
      createTransport: () => ({
        send: () => Promise.resolve({ status: "success" as const }),
        shutdown() {},
      }),
    });
    const tracer = session.getProvider().getTracer(
      "app",
    ) as import("npm:@opentelemetry/api@1.9.1").Tracer;
    const span = tracer.startSpan("size.private");
    const descriptor = Object.getOwnPropertyDescriptor(Uint8Array.prototype, "byteLength");
    const nativeLength = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(Uint8Array.prototype),
      "byteLength",
    )!.get!;
    let exposed = 0;
    try {
      Object.defineProperty(Uint8Array.prototype, "byteLength", {
        configurable: true,
        get() {
          exposed++;
          return Reflect.apply(nativeLength, this, []);
        },
      });
      span.end();
    } finally {
      if (descriptor) Object.defineProperty(Uint8Array.prototype, "byteLength", descriptor);
      else delete (Uint8Array.prototype as { byteLength?: number }).byteLength;
      await owner.shutdown();
    }
    assertEquals(exposed, 0);
  });

  it("keeps public span and helper ownership private from WeakMap hooks", async () => {
    const owner = new OtlpTracingExporter();
    const session = await owner.createProjectProvider({
      resource: { "service.name": "private-owners" },
      createTransport: () => ({
        send: () => Promise.resolve({ status: "success" as const }),
        shutdown() {},
      }),
    });
    const get = WeakMap.prototype.get;
    const set = WeakMap.prototype.set;
    let exposed = 0;
    try {
      WeakMap.prototype.get = function (key) {
        if (
          key === session ||
          (typeof key === "object" && key !== null && "name" in key && key.name === "owner.private")
        ) exposed++;
        return Reflect.apply(get, this, [key]);
      };
      WeakMap.prototype.set = function (key, value) {
        if (
          key === session ||
          (typeof key === "object" && key !== null && "name" in key && key.name === "owner.private")
        ) exposed++;
        return Reflect.apply(set, this, [key, value]);
      };
      runWithProjectTraceProvider(session, () => {
        const span = startSpan("owner.private");
        assertExists(span);
        endSpan(span);
      });
    } finally {
      WeakMap.prototype.get = get;
      WeakMap.prototype.set = set;
      await owner.shutdown();
    }
    assertEquals(exposed, 0);
  });

  it("does not expose cached SDK tracers through replaced Map methods", async () => {
    const owner = new OtlpTracingExporter();
    const session = await owner.createProjectProvider({
      resource: { "service.name": "private-tracer-cache" },
      createTransport: () => ({
        send: () => Promise.resolve({ status: "success" as const }),
        shutdown() {},
      }),
    });
    const provider = session.getProvider();
    provider.getTracer("cached-app");
    const get = Map.prototype.get;
    let exposed = 0;
    try {
      Map.prototype.get = function (key) {
        const value = Reflect.apply(get, this, [key]);
        if (typeof value?.startSpan === "function") exposed++;
        return value;
      };
      provider.getTracer("cached-app");
    } finally {
      Map.prototype.get = get;
      await owner.shutdown();
    }
    assertEquals(exposed, 0);
  });

  it("copies SDK snapshot data without consulting shared traversal methods", async () => {
    const owner = new OtlpTracingExporter();
    const session = await owner.createProjectProvider({
      resource: { "service.name": "snapshot-operations" },
      createTransport: () => ({
        send: () => Promise.resolve({ status: "success" as const }),
        shutdown() {},
      }),
    });
    const tracer = session.getProvider().getTracer(
      "app",
    ) as import("npm:@opentelemetry/api@1.9.1").Tracer;
    const span = tracer.startSpan("snapshot.private", {
      attributes: { marker: "synthetic-private-value" },
    });
    span.addEvent("snapshot.event", { marker: "synthetic-private-event" });
    const sdkSpan =
      span as unknown as import("npm:@opentelemetry/sdk-trace-base@2.10.0").ReadableSpan;
    const keys = Object.keys;
    const map = Array.prototype.map;
    let exposed = 0;
    try {
      Object.keys = (value: object) => {
        if (value === sdkSpan.attributes) exposed++;
        return keys(value);
      };
      Array.prototype.map = function (callback, receiver) {
        if (this === sdkSpan.events || this === sdkSpan.links) exposed++;
        return Reflect.apply(map, this, [callback, receiver]);
      };
      span.end();
    } finally {
      Object.keys = keys;
      Array.prototype.map = map;
      await owner.shutdown();
    }
    assertEquals(exposed, 0);
  });

  it("keeps processor queue entries private from replaced array methods", async () => {
    const owner = new OtlpTracingExporter();
    const session = await owner.createProjectProvider({
      resource: { "service.name": "queue-repro" },
      createTransport: () => ({
        send: () => Promise.resolve({ status: "success" as const }),
        shutdown() {},
      }),
    });
    const tracer = session.getProvider().getTracer(
      "app",
    ) as import("npm:@opentelemetry/api@1.9.1").Tracer;
    const span = tracer.startSpan("victim.private");
    const push = Array.prototype.push;
    const apply = Reflect.apply;
    let queueExposures = 0;
    try {
      Array.prototype.push = function (...items) {
        for (let index = 0; index < items.length; index++) {
          if (items[index]?.span?.name === "victim.private") queueExposures++;
        }
        return apply(push, this, items);
      };
      span.end();
    } finally {
      Array.prototype.push = push;
      await owner.shutdown();
    }
    assertEquals(queueExposures, 0);
  });
  it("keeps provider handles private when shared Set methods are replaced", async () => {
    const owner = new OtlpTracingExporter();
    // Load the SDK before installing the hook so this targets provider bookkeeping.
    const options = {
      resource: { "service.name": "private-handles" },
      createTransport: () => ({
        send: () => Promise.resolve({ status: "success" as const }),
        shutdown() {},
      }),
    };
    await owner.createProjectProvider(options);
    const add = Set.prototype.add;
    const remove = Set.prototype.delete;
    let exposed = 0;
    try {
      Set.prototype.add = function (value) {
        if (value?.getProvider && value?.shutdown) exposed++;
        return Reflect.apply(add, this, [value]);
      };
      Set.prototype.delete = function (value) {
        if (value?.getProvider && value?.shutdown) exposed++;
        return Reflect.apply(remove, this, [value]);
      };
      const session = await owner.createProjectProvider(options);
      await session.shutdown(true);
      await owner.shutdown();
    } finally {
      Set.prototype.add = add;
      Set.prototype.delete = remove;
      await owner.shutdown();
    }
    assertEquals(exposed, 0);
  });

  it("snapshots span, event and link attribute arrays before queueing", async () => {
    const owner = new OtlpTracingExporter();
    const captures: string[] = [];
    const session = await owner.createProjectProvider({
      resource: { "service.name": "snapshot" },
      createTransport: () => ({
        send(data) {
          captures.push(new TextDecoder().decode(data));
          return Promise.resolve({ status: "success" });
        },
        shutdown() {},
      }),
    });
    try {
      const spanValues = [1];
      const eventValues = [2];
      const linkValues = [3];
      const tracer = session.getProvider().getTracer(
        "app",
      ) as import("npm:@opentelemetry/api@1.9.1").Tracer;
      const span = tracer.startSpan("snapshot.arrays", {
        attributes: { spanValues },
        links: [{
          context: { traceId: "1".repeat(32), spanId: "2".repeat(16), traceFlags: 1 },
          attributes: { linkValues },
        }],
      });
      span.addEvent("event", { eventValues });
      span.end();
      // The SDK span remains reachable after end; queued data must be independent.
      const ended =
        span as unknown as import("npm:@opentelemetry/sdk-trace-base@2.10.0").ReadableSpan;
      (ended.attributes.spanValues as number[]).push(999);
      (ended.events[0]!.attributes!.eventValues as number[]).push(999);
      (ended.links[0]!.attributes!.linkValues as number[]).push(999);
      spanValues.push(...Array(10000).fill(999));
      eventValues.push(...Array(10000).fill(999));
      linkValues.push(...Array(10000).fill(999));
      await session.forceFlush();
      assertEquals(captures.length, 1);
      assertEquals(new TextEncoder().encode(captures[0]).byteLength < 64 * 1024, true);
      const payload = JSON.parse(captures[0]!);
      const exported = payload.resourceSpans[0].scopeSpans[0].spans[0];
      for (
        const [attributes, key, expected] of [
          [exported.attributes, "spanValues", 1],
          [exported.events[0].attributes, "eventValues", 2],
          [exported.links[0].attributes, "linkValues", 3],
        ] as const
      ) {
        const attribute = attributes.find((item: { key: string }) => item.key === key);
        assertEquals(attribute.value.arrayValue.values.length, 1);
        assertEquals(Number(attribute.value.arrayValue.values[0].intValue), expected);
      }
    } finally {
      await owner.shutdown();
    }
  });

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
      const emptyContext = runWithProjectTraceProvider(session, () => getActiveContext());
      assertExists(emptyContext);
      assertEquals(startSpan("unowned.root", { parent: emptyContext }), null);
      for (const useRawTracer of [false, true]) {
        const parent = runWithProjectTraceProvider(
          session,
          () =>
            useRawTracer
              ? trace.getTracer("app").startSpan("retained.parent")
              : startSpan("retained.parent"),
        );
        assertExists(parent);
        setSpanAttributes(parent, { "application.detached": "updated" });
        addSpanEvent(parent, "detached.event");
        const explicit = startSpan("detached.explicit", { parent });
        assertExists(explicit);
        endSpan(explicit);
        await withSpan("detached.async", async (span) => {
          assertExists(span);
          await Promise.resolve();
          assertEquals(getTraceContext().spanId, span.spanContext().spanId);
        }, { parent });
        withSpanSync("detached.sync", (span) => {
          assertExists(span);
          assertEquals(getTraceContext().spanId, span.spanContext().spanId);
        }, { parent });
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
        const savedContext = await withActiveSpan(parent, async () => getActiveContext());
        assertExists(savedContext);
        const key = Symbol("application.context");
        for (
          const context of [
            savedContext,
            savedContext.setValue(key, true).deleteValue(key),
            trace.setSpan(emptyContext, parent),
          ]
        ) {
          assertEquals(trace.getSpan(context)?.spanContext().spanId, parent.spanContext().spanId);
          const headers = new Headers();
          injectContext(context, headers);
          const parentIds = parent.spanContext();
          assertEquals(
            headers.get("traceparent"),
            `00-${parentIds.traceId}-${parentIds.spanId}-01`,
          );
          const cached = trace.getTracer("detached");
          cached.startSpan("detached.tracer-context", {}, context).end();
          await cached.startActiveSpan("detached.tracer-active", {}, context, async (span) => {
            assertEquals(getTraceContext().spanId, span.spanContext().spanId);
            span.end();
          });
          const contextChild = startSpan("detached.context", { parent: context });
          assertExists(contextChild);
          endSpan(contextChild);
          await withSpan("detached.context-async", async (span) => {
            assertExists(span);
            assertEquals(getTraceContext().spanId, span.spanContext().spanId);
          }, { parent: context });
          withSpanSync("detached.context-sync", (span) => {
            assertExists(span);
            assertEquals(getTraceContext().spanId, span.spanContext().spanId);
          }, { parent: context });
        }
        endSpan(parent);
      }
      await session.forceFlush();
      const spans = received.flatMap((p) =>
        p.resourceSpans.flatMap((r) => r.scopeSpans.flatMap((s) => s.spans))
      );
      assertEquals(spans.length, 42);
      for (const parent of spans.filter((span) => span.name === "retained.parent")) {
        assertEquals(
          parent.attributes.find((a) => a.key === "application.detached")?.value.stringValue,
          "updated",
        );
        assertEquals(parent.events?.map((event) => event.name), ["detached.event"]);
      }
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
