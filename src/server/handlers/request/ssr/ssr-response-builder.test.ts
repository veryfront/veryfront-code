import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { buildSSRResponse } from "./ssr-response-builder.ts";
import type { SSRRenderResult } from "../../../services/rendering/ssr.service.ts";
import { ResponseBuilder } from "#veryfront/security/http/response/builder.ts";
import type { HandlerContext } from "../../types.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";

function createMockAdapter(): RuntimeAdapter {
  return {
    id: "memory",
    name: "mock",
    capabilities: {
      typescript: true,
      jsx: true,
      fileWatcher: false,
      shell: false,
      kvStore: false,
      workers: false,
    },
    fs: {
      exists: () => Promise.resolve(false),
      readFile: () => Promise.resolve(""),
      writeFile: () => Promise.resolve(),
      readDir: () => Promise.resolve([]),
      mkdir: () => Promise.resolve(),
      remove: () => Promise.resolve(),
      stat: () => Promise.resolve({ isFile: true, isDirectory: false, size: 0, mtime: null }),
    },
    env: {
      get: () => undefined,
      set: () => {},
      delete: () => {},
      toObject: () => ({}),
    },
    server: { createHandler: () => () => new Response() },
    serve: () => Promise.resolve({ close: () => Promise.resolve() } as any),
  } as unknown as RuntimeAdapter;
}

function makeCtx(overrides: Partial<HandlerContext> = {}): HandlerContext {
  return {
    projectDir: "/tmp/test",
    adapter: createMockAdapter(),
    securityConfig: null,
    cspUserHeader: null,
    ...overrides,
  };
}

function makeResult(overrides: Partial<SSRRenderResult> = {}): SSRRenderResult {
  return {
    status: 200,
    html: "<html><body>Hello</body></html>",
    isStreaming: false,
    cacheStrategy: "no-cache",
    slug: "index",
    ...overrides,
  };
}

describe("server/handlers/request/ssr/ssr-response-builder", () => {
  describe("buildSSRResponse", () => {
    it("returns buffered HTML response for non-streaming result", async () => {
      const req = new Request("http://localhost/");
      const ctx = makeCtx();
      const result = makeResult({ html: "<p>Hello</p>" });
      const builder = new ResponseBuilder();

      const response = await buildSSRResponse(req, ctx, result, builder);
      assertEquals(response.status, 200);
      const body = await response.text();
      assertEquals(body, "<p>Hello</p>");
    });

    it("returns correct status code from result", async () => {
      const req = new Request("http://localhost/not-found");
      const ctx = makeCtx();
      const result = makeResult({ status: 404, html: "<p>Not Found</p>" });
      const builder = new ResponseBuilder();

      const response = await buildSSRResponse(req, ctx, result, builder);
      assertEquals(response.status, 404);
    });

    it("returns null body for HEAD requests (buffered)", async () => {
      const req = new Request("http://localhost/", { method: "HEAD" });
      const ctx = makeCtx();
      const result = makeResult({ html: "<p>Hello</p>" });
      const builder = new ResponseBuilder();

      const response = await buildSSRResponse(req, ctx, result, builder);
      assertEquals(response.status, 200);
      assertEquals(response.body, null);
    });

    it("returns 304 for matching etag in production", async () => {
      const etag = '"abc123"';
      const req = new Request("http://localhost/", {
        headers: { "if-none-match": etag },
      });
      const ctx = makeCtx({ isLocalProject: false });
      const result = makeResult({ etag });
      const builder = new ResponseBuilder();

      const response = await buildSSRResponse(req, ctx, result, builder);
      assertEquals(response.status, 304);
    });

    it("does NOT return 304 for matching etag in dev mode", async () => {
      const etag = '"abc123"';
      const req = new Request("http://localhost/", {
        headers: { "if-none-match": etag },
      });
      const ctx = makeCtx({ isLocalProject: true });
      const result = makeResult({ etag, html: "<p>Dev</p>" });
      const builder = new ResponseBuilder();

      const response = await buildSSRResponse(req, ctx, result, builder);
      assertEquals(response.status, 200);
    });

    it("returns streaming response when isStreaming with stream", async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("<p>Streamed</p>"));
          controller.close();
        },
      });
      const req = new Request("http://localhost/");
      const ctx = makeCtx();
      const result = makeResult({ isStreaming: true, stream, html: undefined });
      const builder = new ResponseBuilder();

      const response = await buildSSRResponse(req, ctx, result, builder);
      assertEquals(response.status, 200);
      const body = await response.text();
      assertEquals(body, "<p>Streamed</p>");
    });

    it("returns null body for HEAD request with streaming", async () => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode("<p>Streamed</p>"));
          controller.close();
        },
      });
      const req = new Request("http://localhost/", { method: "HEAD" });
      const ctx = makeCtx();
      const result = makeResult({ isStreaming: true, stream, html: undefined });
      const builder = new ResponseBuilder();

      const response = await buildSSRResponse(req, ctx, result, builder);
      assertEquals(response.status, 200);
      assertEquals(response.body, null);
    });

    it("includes etag header when etag is provided (buffered)", async () => {
      const req = new Request("http://localhost/");
      const ctx = makeCtx();
      const result = makeResult({ etag: '"test-etag"' });
      const builder = new ResponseBuilder();

      const response = await buildSSRResponse(req, ctx, result, builder);
      assertEquals(response.headers.get("etag"), '"test-etag"');
    });

    it("falls back to error page when no html or stream", async () => {
      const req = new Request("http://localhost/");
      const ctx = makeCtx();
      const result = makeResult({ html: undefined, stream: undefined });
      const builder = new ResponseBuilder();

      const response = await buildSSRResponse(req, ctx, result, builder);
      assertEquals(response.status, 200);
      const body = await response.text();
      // ErrorPages.serverError() should produce some HTML
      assertEquals(body.includes("<!DOCTYPE html>") || body.includes("<html"), true);
    });
  });
});
