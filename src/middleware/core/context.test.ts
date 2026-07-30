import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertInstanceOf, assertThrows } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { MiddlewareContext } from "./context.ts";
import {
  getRequestPeerProvenance,
  isRequestFromLoopbackPeer,
  recordRequestPeerFromTransport,
} from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";

function createCtx(
  env: Record<string, unknown> = {},
  executionCtx?: unknown,
): MiddlewareContext {
  const req = new Request("https://example.com/test");
  return new MiddlewareContext(req, env, executionCtx as never);
}

describe("MiddlewareContext", () => {
  describe("constructor", () => {
    it("should initialize with request", () => {
      const req = new Request("https://example.com/test");
      const ctx = new MiddlewareContext(req);

      assertEquals(ctx.req, req);
      assertEquals(ctx.request, req);
    });

    it("should keep request aliases synchronized when either alias is replaced", () => {
      const ctx = createCtx();
      const firstReplacement = new Request("https://example.com/first");
      const secondReplacement = new Request("https://example.com/second");

      ctx.req = firstReplacement;
      assertEquals(ctx.request, firstReplacement);

      ctx.request = secondReplacement;
      assertEquals(ctx.req, secondReplacement);
    });

    it("should preserve transport provenance through both request replacement aliases", () => {
      const original = new Request("https://example.com/original");
      recordRequestPeerFromTransport(original, {
        runtime: "node",
        transport: "tcp",
        hostname: "127.0.0.2",
      });
      const ctx = new MiddlewareContext(original);
      const firstReplacement = new Request("https://example.com/first");
      recordRequestPeerFromTransport(firstReplacement, {
        runtime: "node",
        transport: "tcp",
        hostname: "203.0.113.8",
      });

      ctx.req = firstReplacement;
      assertEquals(isRequestFromLoopbackPeer(ctx.request), true);
      assertEquals(getRequestPeerProvenance(ctx.request)?.hostname, "127.0.0.2");

      ctx.request = new Request("https://example.com/second");
      assertEquals(isRequestFromLoopbackPeer(ctx.req), true);
      assertEquals(getRequestPeerProvenance(ctx.req)?.hostname, "127.0.0.2");
    });

    it("should not let a replacement invent authority when the original has none", () => {
      const ctx = createCtx();
      const replacement = new Request("https://example.com/replacement");
      recordRequestPeerFromTransport(replacement, {
        runtime: "node",
        transport: "tcp",
        hostname: "127.0.0.1",
      });

      ctx.request = replacement;

      assertEquals(getRequestPeerProvenance(ctx.req), undefined);
      assertEquals(isRequestFromLoopbackPeer(ctx.req), false);
    });

    it("should reject invalid request replacements without corrupting the context", () => {
      const ctx = createCtx();
      const original = ctx.req;

      assertThrows(
        () => {
          ctx.request = undefined as unknown as Request;
        },
        TypeError,
        "Middleware context request must be a Request",
      );

      assertEquals(ctx.req, original);
      assertEquals(ctx.request, original);
    });

    it("should initialize with env", () => {
      const req = new Request("https://example.com/test");
      const env = { API_KEY: "secret" };
      const ctx = new MiddlewareContext(req, env);

      assertEquals(ctx.env, env);
    });

    it("should initialize with executionCtx", () => {
      const req = new Request("https://example.com/test");
      const executionCtx = {
        waitUntil: () => {},
        passThroughOnException: () => {},
      };
      const ctx = new MiddlewareContext(req, {}, executionCtx);

      assertEquals(ctx.executionCtx, executionCtx);
    });

    it("should initialize var as empty object", () => {
      const ctx = createCtx();

      assertEquals(ctx.var, {});
    });
  });

  describe("json", () => {
    it("should return JSON response", async () => {
      const ctx = createCtx();
      const response = ctx.json({ message: "hello" });

      assertInstanceOf(response, Response);
      // Content-Type may include charset (e.g., "application/json;charset=utf-8" in Bun)
      const contentType = response.headers.get("content-type") ?? "";
      assert(
        contentType.startsWith("application/json"),
        `Expected application/json, got ${contentType}`,
      );
      assertEquals(await response.json(), { message: "hello" });
    });

    it("should accept custom init options", () => {
      const ctx = createCtx();
      const response = ctx.json({ error: "Not Found" }, { status: 404 });

      assertEquals(response.status, 404);
    });
  });

  describe("text", () => {
    it("should return plain text response", async () => {
      const ctx = createCtx();
      const response = ctx.text("Hello World");

      assertInstanceOf(response, Response);
      assertEquals(response.headers.get("content-type"), "text/plain; charset=utf-8");
      assertEquals(await response.text(), "Hello World");
    });

    it("should accept custom init options", () => {
      const ctx = createCtx();
      const response = ctx.text("Created", { status: 201 });

      assertEquals(response.status, 201);
    });

    it("should preserve record, tuple, and Headers instances", () => {
      const ctx = createCtx();
      const recordResponse = ctx.text("record", {
        headers: { "x-record": "yes" },
      });
      const tupleResponse = ctx.text("tuple", {
        headers: [["x-tuple", "yes"]],
      });
      const sourceHeaders = new Headers({
        "content-type": "text/custom",
        "x-headers": "yes",
      });
      const headersResponse = ctx.text("headers", { headers: sourceHeaders });

      assertEquals(recordResponse.headers.get("x-record"), "yes");
      assertEquals(tupleResponse.headers.get("x-tuple"), "yes");
      assertEquals(headersResponse.headers.get("x-headers"), "yes");
      assertEquals(headersResponse.headers.get("content-type"), "text/custom");
      assertEquals(sourceHeaders.get("content-type"), "text/custom");
    });
  });

  describe("html", () => {
    it("should return HTML response", async () => {
      const ctx = createCtx();
      const response = ctx.html("<h1>Hello</h1>");

      assertInstanceOf(response, Response);
      assertEquals(response.headers.get("content-type"), "text/html; charset=utf-8");
      assertEquals(await response.text(), "<h1>Hello</h1>");
    });

    it("should accept custom init options", () => {
      const ctx = createCtx();
      const response = ctx.html("<h1>Error</h1>", { status: 500 });

      assertEquals(response.status, 500);
    });

    it("should preserve every HeadersInit form and caller content types", () => {
      const ctx = createCtx();
      const recordResponse = ctx.html("record", {
        headers: { "x-record": "yes" },
      });
      const tupleResponse = ctx.html("tuple", {
        headers: [["x-tuple", "yes"]],
      });
      const sourceHeaders = new Headers({
        "content-type": "application/xhtml+xml",
        "x-headers": "yes",
      });
      const headersResponse = ctx.html("headers", { headers: sourceHeaders });

      assertEquals(recordResponse.headers.get("x-record"), "yes");
      assertEquals(tupleResponse.headers.get("x-tuple"), "yes");
      assertEquals(headersResponse.headers.get("x-headers"), "yes");
      assertEquals(
        headersResponse.headers.get("content-type"),
        "application/xhtml+xml",
      );
      assertEquals(sourceHeaders.get("content-type"), "application/xhtml+xml");
    });
  });

  describe("redirect", () => {
    it("should return redirect response with default status 302", () => {
      const ctx = createCtx();
      const response = ctx.redirect("/new-location");

      assertEquals(response.status, 302);
      assertEquals(response.headers.get("Location"), "/new-location");
    });

    it("should accept custom status code", () => {
      const ctx = createCtx();
      const response = ctx.redirect("/permanent", 301);

      assertEquals(response.status, 301);
      assertEquals(response.headers.get("Location"), "/permanent");
    });

    it("should handle external URLs", () => {
      const ctx = createCtx();
      const response = ctx.redirect("https://other.com/path");

      assertEquals(response.headers.get("Location"), "https://other.com/path");
    });
  });

  describe("set and get", () => {
    it("should store and retrieve values", () => {
      const ctx = createCtx();

      ctx.set("userId", "123");
      assertEquals(ctx.get("userId"), "123");
    });

    it("should return undefined for non-existent keys", () => {
      const ctx = createCtx();

      assertEquals(ctx.get("nonexistent"), undefined);
    });

    it("should handle different value types", () => {
      const ctx = createCtx();

      ctx.set("number", 42);
      ctx.set("object", { key: "value" });
      ctx.set("array", [1, 2, 3]);
      ctx.set("null", null);

      assertEquals(ctx.get("number"), 42);
      assertEquals(ctx.get("object"), { key: "value" });
      assertEquals(ctx.get("array"), [1, 2, 3]);
      assertEquals(ctx.get("null"), null);
    });

    it("should overwrite existing values", () => {
      const ctx = createCtx();

      ctx.set("key", "first");
      ctx.set("key", "second");

      assertEquals(ctx.get("key"), "second");
    });
  });
});
