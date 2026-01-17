import { assertEquals, assertInstanceOf } from "@std/assert";
import { describe, it } from "@std/testing/bdd";
import { MiddlewareContext } from "./context.ts";

describe("MiddlewareContext", () => {
  describe("constructor", () => {
    it("should initialize with request", () => {
      const req = new Request("https://example.com/test");
      const ctx = new MiddlewareContext(req);

      assertEquals(ctx.req, req);
      assertEquals(ctx.request, req);
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
      const req = new Request("https://example.com/test");
      const ctx = new MiddlewareContext(req);

      assertEquals(ctx.var, {});
    });
  });

  describe("json", () => {
    it("should return JSON response", async () => {
      const req = new Request("https://example.com/test");
      const ctx = new MiddlewareContext(req);

      const response = ctx.json({ message: "hello" });

      assertInstanceOf(response, Response);
      assertEquals(response.headers.get("content-type"), "application/json");
      assertEquals(await response.json(), { message: "hello" });
    });

    it("should accept custom init options", () => {
      const req = new Request("https://example.com/test");
      const ctx = new MiddlewareContext(req);

      const response = ctx.json({ error: "Not Found" }, { status: 404 });

      assertEquals(response.status, 404);
    });
  });

  describe("text", () => {
    it("should return plain text response", async () => {
      const req = new Request("https://example.com/test");
      const ctx = new MiddlewareContext(req);

      const response = ctx.text("Hello World");

      assertInstanceOf(response, Response);
      assertEquals(
        response.headers.get("content-type"),
        "text/plain; charset=utf-8",
      );
      assertEquals(await response.text(), "Hello World");
    });

    it("should accept custom init options", () => {
      const req = new Request("https://example.com/test");
      const ctx = new MiddlewareContext(req);

      const response = ctx.text("Created", { status: 201 });

      assertEquals(response.status, 201);
    });
  });

  describe("html", () => {
    it("should return HTML response", async () => {
      const req = new Request("https://example.com/test");
      const ctx = new MiddlewareContext(req);

      const response = ctx.html("<h1>Hello</h1>");

      assertInstanceOf(response, Response);
      assertEquals(
        response.headers.get("content-type"),
        "text/html; charset=utf-8",
      );
      assertEquals(await response.text(), "<h1>Hello</h1>");
    });

    it("should accept custom init options", () => {
      const req = new Request("https://example.com/test");
      const ctx = new MiddlewareContext(req);

      const response = ctx.html("<h1>Error</h1>", { status: 500 });

      assertEquals(response.status, 500);
    });
  });

  describe("redirect", () => {
    it("should return redirect response with default status 302", () => {
      const req = new Request("https://example.com/test");
      const ctx = new MiddlewareContext(req);

      const response = ctx.redirect("/new-location");

      assertEquals(response.status, 302);
      assertEquals(response.headers.get("Location"), "/new-location");
    });

    it("should accept custom status code", () => {
      const req = new Request("https://example.com/test");
      const ctx = new MiddlewareContext(req);

      const response = ctx.redirect("/permanent", 301);

      assertEquals(response.status, 301);
      assertEquals(response.headers.get("Location"), "/permanent");
    });

    it("should handle external URLs", () => {
      const req = new Request("https://example.com/test");
      const ctx = new MiddlewareContext(req);

      const response = ctx.redirect("https://other.com/path");

      assertEquals(response.headers.get("Location"), "https://other.com/path");
    });
  });

  describe("set and get", () => {
    it("should store and retrieve values", () => {
      const req = new Request("https://example.com/test");
      const ctx = new MiddlewareContext(req);

      ctx.set("userId", "123");
      assertEquals(ctx.get("userId"), "123");
    });

    it("should return undefined for non-existent keys", () => {
      const req = new Request("https://example.com/test");
      const ctx = new MiddlewareContext(req);

      assertEquals(ctx.get("nonexistent"), undefined);
    });

    it("should handle different value types", () => {
      const req = new Request("https://example.com/test");
      const ctx = new MiddlewareContext(req);

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
      const req = new Request("https://example.com/test");
      const ctx = new MiddlewareContext(req);

      ctx.set("key", "first");
      ctx.set("key", "second");

      assertEquals(ctx.get("key"), "second");
    });
  });
});
