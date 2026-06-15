import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { Context, Span } from "#veryfront/observability/tracing/api-shim.ts";
import { runProxyRequestLifecycle } from "./request-lifecycle.ts";

describe("proxy request lifecycle", () => {
  it("starts a server span, runs inside the extracted context, and ends with response status", async () => {
    const req = new Request("https://example.com/docs", {
      method: "POST",
      headers: { traceparent: "00-test" },
    });
    const url = new URL(req.url);
    const parentContext = {} as Context;
    const span = {} as Span;
    const calls: string[] = [];

    const response = await runProxyRequestLifecycle({
      req,
      url,
      extractContext(headers) {
        calls.push(`extract:${headers.get("traceparent")}`);
        return parentContext;
      },
      startServerSpan(method, path, receivedParentContext) {
        calls.push(`start:${method}:${path}:${receivedParentContext === parentContext}`);
        return { span, context: "span-context" as unknown as Context };
      },
      withContext(spanContext, fn) {
        calls.push(`context:${spanContext === ("span-context" as unknown as Context)}`);
        return fn();
      },
      endSpan(receivedSpan, statusCode, error) {
        calls.push(`end:${receivedSpan === span}:${statusCode}:${error?.message ?? ""}`);
      },
      handle: async () => new Response("created", { status: 201 }),
    });

    assertEquals(response.status, 201);
    assertEquals(calls, [
      "extract:00-test",
      "start:POST:/docs:true",
      "context:true",
      "end:true:201:",
    ]);
  });

  it("honors an explicit lifecycle end and does not end the span twice", async () => {
    const req = new Request("https://example.com/protected");
    const span = {} as Span;
    const ended: string[] = [];

    const response = await runProxyRequestLifecycle({
      req,
      url: new URL(req.url),
      extractContext: () => undefined,
      startServerSpan: () => ({ span, context: {} as Context }),
      withContext: (_context, fn) => fn(),
      endSpan(_span, statusCode, error) {
        ended.push(`${statusCode}:${error?.message ?? ""}`);
      },
      handle: async (lifecycle) => {
        lifecycle.end(403);
        return new Response(null, { status: 302 });
      },
    });

    assertEquals(response.status, 302);
    assertEquals(ended, ["403:"]);
  });

  it("ends the span once with the thrown error before rethrowing", async () => {
    const req = new Request("https://example.com/fail");
    const span = {} as Span;
    const ended: string[] = [];

    try {
      await runProxyRequestLifecycle({
        req,
        url: new URL(req.url),
        extractContext: () => undefined,
        startServerSpan: () => ({ span, context: {} as Context }),
        withContext: (_context, fn) => fn(),
        endSpan(_span, statusCode, error) {
          ended.push(`${statusCode}:${error?.message ?? ""}`);
        },
        handle: () => {
          throw new Error("boom");
        },
      });
    } catch (error) {
      assertEquals(error instanceof Error ? error.message : String(error), "boom");
    }

    assertEquals(ended, ["500:boom"]);
  });
});
