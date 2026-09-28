import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  endSpan,
  extractContext,
  getTraceContext,
  startSpan,
  trace,
  withSpan,
} from "veryfront/observability";
import { createWorkerTraceRecorder } from "./worker-trace-recorder.ts";

const parent = `00-${"1".repeat(32)}-${"2".repeat(16)}-01`;

describe("worker trace recorder", () => {
  it("honors an explicitly extracted traceparent and ignores invalid headers", () => {
    const recorder = createWorkerTraceRecorder(parent)!;
    recorder.run(() => {
      const ctx = extractContext(
        new Headers({ traceparent: `00-${"3".repeat(32)}-${"4".repeat(16)}-01` }),
      );
      assertExists(ctx);
      trace.getTracer("app").startSpan("remote-parent", {}, ctx).end();
      const invalid = extractContext(new Headers({ traceparent: "invalid" }));
      trace.getTracer("app").startSpan("original-parent", {}, invalid).end();
    });
    const records = JSON.parse(recorder.finish());
    assertEquals(records[0].traceId, "3".repeat(32));
    assertEquals(records[0].parentSpanId, "4".repeat(16));
    assertEquals(records[1].traceId, "1".repeat(32));
    assertEquals(records[1].parentSpanId, "2".repeat(16));
  });

  it("starts an independent trace for root spans and preserves it for children", () => {
    const recorder = createWorkerTraceRecorder(parent)!;
    recorder.run(() =>
      trace.getTracer("app").startActiveSpan(
        "root",
        { root: true } as import("./api-shim.ts").SpanStartOptions,
        (root) => {
          trace.getTracer("app").startSpan("child").end();
          root.end();
        },
      )
    );
    const records = JSON.parse(recorder.finish());
    const root = records.find((record: { name: string }) => record.name === "root");
    const child = records.find((record: { name: string }) => record.name === "child");
    assertEquals(root.traceId === "1".repeat(32), false);
    assertEquals(root.parentSpanId, undefined);
    assertEquals(child.traceId, root.traceId);
    assertEquals(child.parentSpanId, root.spanId);
  });

  it("retains an explicit end timestamp", () => {
    const recorder = createWorkerTraceRecorder(parent)!;
    const completedAt = Date.now() + 1000;
    recorder.run(() => trace.getTracer("app").startSpan("timed").end(completedAt));
    assertEquals(JSON.parse(recorder.finish())[0].endTime, completedAt);
  });

  it("preserves nested custom span parents across await and closes the request", async () => {
    const recorder = createWorkerTraceRecorder(parent);
    assertExists(recorder);
    recorder.run(() => {
      assertEquals(getTraceContext().traceId, "1".repeat(32));
      assertEquals(getTraceContext().spanId, "2".repeat(16));
    });
    let late: ReturnType<typeof startSpan>;
    await recorder.run(() =>
      withSpan("outer", async () => {
        await Promise.resolve();
        const child = trace.getTracer("app").startSpan("child");
        child.setAttribute("answer", 42);
        child.addEvent("work", { phase: "done" });
        child.end();
        late = startSpan("late");
      })
    );
    const records = JSON.parse(recorder.finish());
    assertEquals(records.length, 2);
    const outer = records.find((record: { name: string }) => record.name === "outer");
    const child = records.find((record: { name: string }) => record.name === "child");
    assertEquals(outer.parentSpanId, "2".repeat(16));
    assertEquals(child.parentSpanId, outer.spanId);
    assertEquals(child.attributes.answer, 42);
    assertEquals(child.events[0].name, "work");
    endSpan(late!);
    assertEquals(recorder.finish(), JSON.stringify(records));
  });

  it("bounds records per request and ignores absent or malformed trace parents", () => {
    assertEquals(createWorkerTraceRecorder(undefined), undefined);
    assertEquals(createWorkerTraceRecorder("invalid"), undefined);
    const recorder = createWorkerTraceRecorder(parent)!;
    recorder.run(() => {
      for (let index = 0; index < 200; index++) trace.getTracer("app").startSpan("bounded").end();
    });
    assertEquals(JSON.parse(recorder.finish()).length, 128);
  });
});
