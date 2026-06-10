import "../../_helpers/contract-init.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  _resetShimForTests,
  type AttributeValue,
  setGlobalTracerProvider,
  type Span,
  type Tracer,
} from "../../../src/observability/tracing/api-shim.ts";
import {
  createInstrumentedFetch,
  instrumentHttpHandler,
} from "../../../src/observability/auto-instrument/http-instrumentation.ts";
import { endSpan, startSpan, withActiveSpan } from "../../../src/observability/tracing/index.ts";

type RecordedSpan = {
  name: string;
  attributes: Record<string, AttributeValue>;
};

function createRecordingSpan(record: RecordedSpan): Span {
  return {
    setAttribute(key, value) {
      record.attributes[key] = value;
      return this;
    },
    setAttributes(attrs) {
      Object.assign(record.attributes, attrs);
      return this;
    },
    setStatus() {
      return this;
    },
    recordException() {},
    addEvent() {
      return this;
    },
    end() {},
    spanContext() {
      return {
        traceId: "0".repeat(32),
        spanId: "0".repeat(16),
        traceFlags: 0,
      };
    },
    updateName() {},
  };
}

function installRecordingTracer(records: RecordedSpan[]): void {
  const tracer = {
    startActiveSpan(
      name: string,
      optionsOrFn:
        | { attributes?: Record<string, AttributeValue> }
        | ((span: Span) => unknown),
      contextOrFn?: unknown,
      fn?: (span: Span) => unknown,
    ) {
      const options = typeof optionsOrFn === "function" ? {} : optionsOrFn;
      const callback = typeof optionsOrFn === "function"
        ? optionsOrFn
        : typeof contextOrFn === "function"
        ? contextOrFn
        : fn!;
      const record = { name, attributes: { ...(options.attributes ?? {}) } };
      records.push(record);
      return callback(createRecordingSpan(record));
    },
  } as unknown as Tracer;

  setGlobalTracerProvider({ getTracer: () => tracer });
}

describe("HTTP Tracing Integration", () => {
  it("should inject W3C trace context into fetch headers", async () => {
    let capturedHeaders: Headers | null = null;

    const mockFetch = (_input: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = new Headers(init?.headers);
      return Promise.resolve(new Response("OK"));
    };

    const instrumentedFetch = createInstrumentedFetch(mockFetch as unknown as typeof fetch);

    await withActiveSpan(startSpan("parent-op"), async () => {
      await instrumentedFetch("https://example.com");
    });

    assertExists(capturedHeaders);
  });

  it("should extract W3C trace context in http handler", async () => {
    const traceId = "0af7651916cd43dd8448eb211c80319c";
    const spanId = "b7ad6b7169203331";
    const traceparent = `00-${traceId}-${spanId}-01`;

    const handler = (_req: Request) => {
      const span = startSpan("child-in-handler");
      endSpan(span);
      return new Response("OK");
    };

    const instrumented = instrumentHttpHandler(handler);
    const req = new Request("http://localhost/test", {
      headers: { traceparent },
    });

    const res = await instrumented(req);
    assertEquals(res.status, 200);
  });

  it("records http.url without query strings or URL credentials", async () => {
    const records: RecordedSpan[] = [];
    installRecordingTracer(records);

    try {
      const instrumentedFetch = createInstrumentedFetch(() => Promise.resolve(new Response("OK")));
      await instrumentedFetch("https://user:secret@example.com/cache/get?key=cache-secret#frag");

      const handler = instrumentHttpHandler(() => new Response("OK"));
      const response = await handler(
        new Request("https://app.example.com/callback?token=callback-secret&next=/dashboard"),
      );

      assertEquals(response.status, 200);

      const fetchSpan = records.find((record) => record.name === "http.client.fetch");
      const serverSpan = records.find((record) => record.name === "http.server.request");
      assertExists(fetchSpan);
      assertExists(serverSpan);

      assertEquals(fetchSpan.attributes["http.url"], "https://example.com/cache/get");
      assertEquals(fetchSpan.attributes["http.target"], "/cache/get");
      assertEquals(String(fetchSpan.attributes["http.url"]).includes("cache-secret"), false);
      assertEquals(serverSpan.attributes["http.url"], "https://app.example.com/callback");
      assertEquals(serverSpan.attributes["http.target"], "/callback");
      assertEquals(String(serverSpan.attributes["http.url"]).includes("callback-secret"), false);
    } finally {
      _resetShimForTests();
    }
  });
});
