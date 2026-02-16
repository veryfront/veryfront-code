import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { SpanBuffer, type SpanEntry } from "./span-buffer.ts";

function makeSpan(overrides: Partial<Omit<SpanEntry, "id">> = {}): Omit<SpanEntry, "id"> {
  return {
    traceId: "trace-1",
    spanId: `span-${Math.random().toString(36).slice(2, 8)}`,
    name: "test.span",
    kind: "internal",
    status: "ok",
    startTime: Date.now(),
    endTime: Date.now() + 10,
    duration: 10,
    attributes: {},
    ...overrides,
  };
}

describe("observability/tracing/span-buffer", () => {
  describe("SpanBuffer", () => {
    it("should append span entries", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan());
      assertEquals(buf.count, 1);
    });

    it("should assign unique IDs", () => {
      const buf = new SpanBuffer();
      const a = buf.append(makeSpan());
      const b = buf.append(makeSpan());
      assertEquals(a.id !== b.id, true);
    });

    it("should enforce maxSize with FIFO eviction", () => {
      const buf = new SpanBuffer({ maxSize: 3 });
      buf.append(makeSpan({ name: "span-1" }));
      buf.append(makeSpan({ name: "span-2" }));
      buf.append(makeSpan({ name: "span-3" }));
      buf.append(makeSpan({ name: "span-4" }));

      assertEquals(buf.count, 3);

      const first = buf.getAll()[0];
      assertExists(first);
      assertEquals(first.name, "span-2");
    });

    it("should query without filter", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan());
      buf.append(makeSpan());

      const results = buf.query();
      assertEquals(results.length, 2);
    });

    it("should query by traceId", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan({ traceId: "trace-a" }));
      buf.append(makeSpan({ traceId: "trace-b" }));
      buf.append(makeSpan({ traceId: "trace-a" }));

      const results = buf.query({ traceId: "trace-a" });
      assertEquals(results.length, 2);
    });

    it("should query by name string", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan({ name: "http.request" }));
      buf.append(makeSpan({ name: "render.page" }));
      buf.append(makeSpan({ name: "http.fetch" }));

      const results = buf.query({ name: "http" });
      assertEquals(results.length, 2);
    });

    it("should query by name regex", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan({ name: "http.request" }));
      buf.append(makeSpan({ name: "render.page" }));

      const results = buf.query({ name: /^render/ });
      assertEquals(results.length, 1);
    });

    it("should query by status", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan({ status: "ok" }));
      buf.append(makeSpan({ status: "error" }));
      buf.append(makeSpan({ status: "ok" }));

      const results = buf.query({ status: "error" });
      assertEquals(results.length, 1);
    });

    it("should query by multiple statuses", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan({ status: "ok" }));
      buf.append(makeSpan({ status: "error" }));
      buf.append(makeSpan({ status: "unset" }));

      const results = buf.query({ status: ["ok", "error"] });
      assertEquals(results.length, 2);
    });

    it("should query by kind", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan({ kind: "server" }));
      buf.append(makeSpan({ kind: "client" }));
      buf.append(makeSpan({ kind: "internal" }));

      const results = buf.query({ kind: "server" });
      assertEquals(results.length, 1);
    });

    it("should query by minDuration", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan({ duration: 5 }));
      buf.append(makeSpan({ duration: 50 }));
      buf.append(makeSpan({ duration: 100 }));

      const results = buf.query({ minDuration: 50 });
      assertEquals(results.length, 2);
    });

    it("should query by maxDuration", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan({ duration: 5 }));
      buf.append(makeSpan({ duration: 50 }));
      buf.append(makeSpan({ duration: 100 }));

      const results = buf.query({ maxDuration: 50 });
      assertEquals(results.length, 2);
    });

    it("should query by since", () => {
      const now = Date.now();
      const buf = new SpanBuffer();
      buf.append(makeSpan({ startTime: now - 1000 }));
      buf.append(makeSpan({ startTime: now }));

      const results = buf.query({ since: now });
      assertEquals(results.length, 1);
    });

    it("should query with limit", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan({ name: "a" }));
      buf.append(makeSpan({ name: "b" }));
      buf.append(makeSpan({ name: "c" }));

      const results = buf.query({ limit: 2 });
      assertEquals(results.length, 2);
      assertEquals(results[0].name, "b");
    });

    it("should get trace by traceId sorted by startTime", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan({ traceId: "t1", name: "child", startTime: 200 }));
      buf.append(makeSpan({ traceId: "t1", name: "root", startTime: 100 }));
      buf.append(makeSpan({ traceId: "t2", name: "other", startTime: 150 }));

      const trace = buf.getTrace("t1");
      assertEquals(trace.length, 2);
      assertEquals(trace[0].name, "root");
      assertEquals(trace[1].name, "child");
    });

    it("should get grouped traces", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan({ traceId: "t1", name: "root", startTime: 100, endTime: 200 }));
      buf.append(
        makeSpan({ traceId: "t1", name: "child", startTime: 110, endTime: 180, parentSpanId: "p" }),
      );
      buf.append(makeSpan({ traceId: "t2", name: "other-root", startTime: 300, endTime: 400 }));

      const traces = buf.getTraces();
      assertEquals(traces.length, 2);
      // Most recent first
      assertEquals(traces[0].traceId, "t2");
      assertEquals(traces[1].traceId, "t1");
      assertEquals(traces[1].spans.length, 2);
    });

    it("should limit grouped traces", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan({ traceId: "t1", startTime: 100, endTime: 200 }));
      buf.append(makeSpan({ traceId: "t2", startTime: 200, endTime: 300 }));
      buf.append(makeSpan({ traceId: "t3", startTime: 300, endTime: 400 }));

      const traces = buf.getTraces({ limit: 2 });
      assertEquals(traces.length, 2);
    });

    it("should count by status", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan({ status: "ok" }));
      buf.append(makeSpan({ status: "ok" }));
      buf.append(makeSpan({ status: "error" }));

      const counts = buf.countByStatus();
      assertEquals(counts.ok, 2);
      assertEquals(counts.error, 1);
      assertEquals(counts.unset, 0);
    });

    it("should clear entries", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan());
      buf.clear();
      assertEquals(buf.count, 0);
    });

    it("should notify subscribers", () => {
      const buf = new SpanBuffer();
      const received: string[] = [];
      const unsub = buf.subscribe((entry) => received.push(entry.name));

      buf.append(makeSpan({ name: "test" }));
      assertEquals(received, ["test"]);

      unsub();
      buf.append(makeSpan({ name: "after-unsub" }));
      assertEquals(received.length, 1);
    });

    it("should ignore subscriber errors", () => {
      const buf = new SpanBuffer();
      buf.subscribe(() => {
        throw new Error("subscriber error");
      });

      const entry = buf.append(makeSpan());
      assertExists(entry.id);
    });

    it("should format entries", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan({ name: "http.request", status: "ok", duration: 42.5 }));

      const formatted = buf.format();
      assertEquals(formatted.includes("OK"), true);
      assertEquals(formatted.includes("http.request"), true);
      assertEquals(formatted.includes("42.5ms"), true);
    });

    it("should serialize to JSON", () => {
      const buf = new SpanBuffer();
      buf.append(makeSpan());
      buf.append(makeSpan());

      const json = buf.toJSON();
      assertEquals(json.length, 2);
    });
  });
});
