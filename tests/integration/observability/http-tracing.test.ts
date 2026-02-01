import { assertEquals, assertExists } from "#veryfront/testing/assert";
import { describe, it } from "#veryfront/testing/bdd";
import {
  createInstrumentedFetch,
  instrumentHttpHandler,
} from "../../../src/observability/auto-instrument/http-instrumentation.ts";
import {
  endSpan,
  startSpan,
  withActiveSpan,
} from "../../../src/observability/tracing/index.ts";

describe("HTTP Tracing Integration", () => {
  it("should inject W3C trace context into fetch headers", async () => {
    let capturedHeaders: Headers | null = null;

    const mockFetch = (input: RequestInfo | URL, init?: RequestInit) => {
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
});
