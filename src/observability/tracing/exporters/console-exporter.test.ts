import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { ConsoleSpanExporter, convertReadableSpan } from "./console-exporter.ts";
import { getSpanBuffer, resetSpanBuffer } from "../span-buffer.ts";

function makeReadableSpan(overrides: Record<string, unknown> = {}): {
  name: string;
  kind: number;
  spanContext: () => { traceId: string; spanId: string };
  parentSpanId?: string;
  startTime: [number, number];
  endTime: [number, number];
  status: { code: number; message?: string };
  attributes: Record<string, unknown>;
  duration: [number, number];
} {
  const now = Date.now();
  const seconds = Math.floor(now / 1000);
  const nanos = (now % 1000) * 1_000_000;

  return {
    name: "test.span",
    kind: 0, // INTERNAL
    spanContext: () => ({
      traceId: "abc123def456",
      spanId: "span001",
    }),
    startTime: [seconds, nanos],
    endTime: [seconds, nanos + 10_000_000], // +10ms
    status: { code: 1 }, // OK
    attributes: {},
    duration: [0, 10_000_000], // 10ms
    ...overrides,
  };
}

describe("observability/tracing/exporters/console-exporter", () => {
  describe("convertReadableSpan", () => {
    it("should convert a basic span", () => {
      const readable = makeReadableSpan();
      const entry = convertReadableSpan(readable);

      assertEquals(entry.name, "test.span");
      assertEquals(entry.kind, "internal");
      assertEquals(entry.status, "ok");
      assertEquals(entry.traceId, "abc123def456");
      assertEquals(entry.spanId, "span001");
      assertEquals(entry.duration >= 9 && entry.duration <= 11, true);
    });

    it("should map span kinds correctly", () => {
      assertEquals(convertReadableSpan(makeReadableSpan({ kind: 0 })).kind, "internal");
      assertEquals(convertReadableSpan(makeReadableSpan({ kind: 1 })).kind, "server");
      assertEquals(convertReadableSpan(makeReadableSpan({ kind: 2 })).kind, "client");
      assertEquals(convertReadableSpan(makeReadableSpan({ kind: 3 })).kind, "producer");
      assertEquals(convertReadableSpan(makeReadableSpan({ kind: 4 })).kind, "consumer");
    });

    it("should map status codes correctly", () => {
      assertEquals(convertReadableSpan(makeReadableSpan({ status: { code: 0 } })).status, "unset");
      assertEquals(convertReadableSpan(makeReadableSpan({ status: { code: 1 } })).status, "ok");
      assertEquals(convertReadableSpan(makeReadableSpan({ status: { code: 2 } })).status, "error");
    });

    it("should include status message for errors", () => {
      const entry = convertReadableSpan(
        makeReadableSpan({ status: { code: 2, message: "something failed" } }),
      );
      assertEquals(entry.status, "error");
      assertEquals(entry.statusMessage, "something failed");
    });

    it("should flatten attributes", () => {
      const entry = convertReadableSpan(
        makeReadableSpan({
          attributes: {
            "http.method": "GET",
            "http.status_code": 200,
            "is.ok": true,
            nested: { a: 1 },
          },
        }),
      );

      assertEquals(entry.attributes["http.method"], "GET");
      assertEquals(entry.attributes["http.status_code"], 200);
      assertEquals(entry.attributes["is.ok"], true);
      assertEquals(entry.attributes.nested, "[object Object]");
    });

    it("should include parentSpanId", () => {
      const entry = convertReadableSpan(makeReadableSpan({ parentSpanId: "parent-123" }));
      assertEquals(entry.parentSpanId, "parent-123");
    });
  });

  describe("ConsoleSpanExporter", () => {
    it("should export spans to SpanBuffer", () => {
      resetSpanBuffer();
      const exporter = new ConsoleSpanExporter();
      const spans = [makeReadableSpan({ name: "test.export" })];

      let resultCode = -1;
      exporter.export(spans, (result) => {
        resultCode = result.code;
      });

      assertEquals(resultCode, 0);

      const buffer = getSpanBuffer();
      assertEquals(buffer.count, 1);
      assertEquals(buffer.getAll()[0].name, "test.export");
    });

    it("should export multiple spans", () => {
      resetSpanBuffer();
      const exporter = new ConsoleSpanExporter();
      const spans = [
        makeReadableSpan({ name: "span-a" }),
        makeReadableSpan({ name: "span-b" }),
        makeReadableSpan({ name: "span-c" }),
      ];

      let resultCode = -1;
      exporter.export(spans, (result) => {
        resultCode = result.code;
      });

      assertEquals(resultCode, 0);
      assertEquals(getSpanBuffer().count, 3);
    });

    it("should fail after shutdown", () => {
      resetSpanBuffer();
      const exporter = new ConsoleSpanExporter();
      exporter.shutdown();

      let resultCode = -1;
      exporter.export([makeReadableSpan()], (result) => {
        resultCode = result.code;
      });

      assertEquals(resultCode, 1);
      assertEquals(getSpanBuffer().count, 0);
    });

    it("should handle forceFlush", async () => {
      const exporter = new ConsoleSpanExporter();
      await exporter.forceFlush();
      // Should not throw
    });

    it("should skip malformed spans without failing", () => {
      resetSpanBuffer();
      const exporter = new ConsoleSpanExporter();

      const badSpan = {
        name: null,
        kind: 0,
        spanContext: () => {
          throw new Error("bad span");
        },
        startTime: [0, 0] as [number, number],
        endTime: [0, 0] as [number, number],
        status: { code: 0 },
        attributes: {},
        duration: [0, 0] as [number, number],
      };

      let resultCode = -1;
      exporter.export([badSpan as never], (result) => {
        resultCode = result.code;
      });

      assertEquals(resultCode, 0);
    });
  });
});
