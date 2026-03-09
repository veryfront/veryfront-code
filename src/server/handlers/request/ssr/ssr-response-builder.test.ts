import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildSSRResponse } from "./ssr-response-builder.ts";
import type { HandlerContext } from "../../types.ts";
import type { SSRRenderResult } from "../../../services/rendering/ssr.service.ts";
import type { ResponseBuilder } from "#veryfront/security/http/response/builder.ts";

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    isLocalProject: false,
    securityConfig: undefined,
    ...overrides,
  } as unknown as HandlerContext;
}

function makeResult(overrides: Partial<SSRRenderResult> = {}): SSRRenderResult {
  return {
    status: 200,
    html: "<html><body>Hello</body></html>",
    isStreaming: false,
    cacheStrategy: "no-cache",
    slug: "test",
    ...overrides,
  };
}

function makeBuilder(): ResponseBuilder {
  const self: ResponseBuilder = {
    withCORS: () => self,
    withSecurity: () => self,
    withClientHints: () => self,
    withCache: () => self,
    withETag: () => self,
    withContentType: (contentType: string, body: unknown, status: number) => {
      return new Response(body as BodyInit, {
        status,
        headers: { "content-type": contentType },
      });
    },
    notModified: (etag: string) => {
      return new Response(null, {
        status: 304,
        headers: { etag },
      });
    },
    html: (content: string, status: number) => {
      return new Response(content, {
        status,
        headers: { "content-type": "text/html" },
      });
    },
  } as unknown as ResponseBuilder;
  return self;
}

describe("server/handlers/request/ssr/ssr-response-builder", () => {
  describe("buildSSRResponse", () => {
    it("should return buffered HTML response for non-streaming result", async () => {
      const req = new Request("http://localhost/test");
      const ctx = makeCtx();
      const result = makeResult({ html: "<p>Hello</p>" });
      const builder = makeBuilder();

      const response = await buildSSRResponse(req, ctx, result, builder);
      assertEquals(response.status, 200);
      const body = await response.text();
      assertEquals(body.includes("Hello"), true);
    });

    it("should return null body for HEAD requests on buffered content", async () => {
      const req = new Request("http://localhost/test", { method: "HEAD" });
      const ctx = makeCtx();
      const result = makeResult({ html: "<p>Hello</p>" });
      const builder = makeBuilder();

      const response = await buildSSRResponse(req, ctx, result, builder);
      assertEquals(response.status, 200);
      const body = await response.text();
      assertEquals(body, "");
    });

    it("should use result status code", async () => {
      const req = new Request("http://localhost/test");
      const ctx = makeCtx();
      const result = makeResult({ status: 404, html: "Not Found" });
      const builder = makeBuilder();

      const response = await buildSSRResponse(req, ctx, result, builder);
      assertEquals(response.status, 404);
    });

    it("should handle streaming responses", async () => {
      const encoder = new TextEncoder();
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode("<html>"));
          controller.enqueue(encoder.encode("</html>"));
          controller.close();
        },
      });

      const req = new Request("http://localhost/test");
      const ctx = makeCtx();
      const result = makeResult({ isStreaming: true, stream, html: undefined });
      const builder = makeBuilder();

      const response = await buildSSRResponse(req, ctx, result, builder);
      assertEquals(response.status, 200);
    });

    it("should return 304 for matching etag in production", async () => {
      const etag = '"abc123"';
      const req = new Request("http://localhost/test", {
        headers: { "if-none-match": etag },
      });
      const ctx = makeCtx({ isLocalProject: false });
      const result = makeResult({ etag });
      const builder = makeBuilder();

      const response = await buildSSRResponse(req, ctx, result, builder);
      assertEquals(response.status, 304);
    });

    it("should not return 304 for dev mode even with matching etag", async () => {
      const etag = '"abc123"';
      const req = new Request("http://localhost/test", {
        headers: { "if-none-match": etag },
      });
      const ctx = makeCtx({ isLocalProject: true });
      const result = makeResult({ etag, html: "<p>content</p>" });
      const builder = makeBuilder();

      const response = await buildSSRResponse(req, ctx, result, builder);
      assertEquals(response.status, 200);
    });
  });
});
