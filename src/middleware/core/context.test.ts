import { describe, it } from "jsr:@std/testing/bdd";
import { assertEquals, assertExists } from "jsr:@std/assert";
import { MiddlewareContext } from "./context.ts";
import { HTTP_REDIRECT_FOUND } from "@veryfront/utils";

describe("MiddlewareContext", () => {
  it("should create context with request", () => {
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);

    assertEquals(ctx.req, req);
    assertEquals(ctx.request, req);
    assertExists(ctx.var);
    assertExists(ctx.env);
  });

  it("should create context with env", () => {
    const req = new Request("http://localhost/test");
    const env = { API_KEY: "secret" };
    const ctx = new MiddlewareContext(req, env);

    assertEquals(ctx.env, env);
    assertEquals(ctx.env.API_KEY, "secret");
  });

  it("should create context with execution context", () => {
    const req = new Request("http://localhost/test");
    const executionCtx = {
      waitUntil: () => {},
      passThroughOnException: () => {},
    };
    const ctx = new MiddlewareContext(req, {}, executionCtx);

    assertEquals(ctx.executionCtx, executionCtx);
  });

  it("should return JSON response", () => {
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const data = { message: "Hello", status: "ok" };

    const response = ctx.json(data);

    assertExists(response);
    assertEquals(response.headers.get("content-type"), "application/json");
  });

  it("should return JSON response with custom status", () => {
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);
    const data = { error: "Not found" };

    const response = ctx.json(data, { status: 404 });

    assertExists(response);
    assertEquals(response.status, 404);
  });

  it("should return text response", () => {
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);

    const response = ctx.text("Hello, World!");

    assertExists(response);
    assertEquals(response.headers.get("content-type"), "text/plain; charset=utf-8");
  });

  it("should return text response with custom status", () => {
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);

    const response = ctx.text("Not Found", { status: 404 });

    assertExists(response);
    assertEquals(response.status, 404);
    assertEquals(response.headers.get("content-type"), "text/plain; charset=utf-8");
  });

  it("should return HTML response", () => {
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);

    const response = ctx.html("<h1>Hello</h1>");

    assertExists(response);
    assertEquals(response.headers.get("content-type"), "text/html; charset=utf-8");
  });

  it("should return HTML response with custom status", () => {
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);

    const response = ctx.html("<h1>Error</h1>", { status: 500 });

    assertExists(response);
    assertEquals(response.status, 500);
    assertEquals(response.headers.get("content-type"), "text/html; charset=utf-8");
  });

  it("should return redirect response with default status", () => {
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);

    const response = ctx.redirect("http://example.com");

    assertExists(response);
    assertEquals(response.status, HTTP_REDIRECT_FOUND);
    assertEquals(response.headers.get("Location"), "http://example.com");
  });

  it("should return redirect response with custom status", () => {
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);

    const response = ctx.redirect("http://example.com", 301);

    assertExists(response);
    assertEquals(response.status, 301);
    assertEquals(response.headers.get("Location"), "http://example.com");
  });

  it("should set and get values from store", () => {
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);

    ctx.set("userId", 123);
    ctx.set("userName", "John");

    assertEquals(ctx.get("userId"), 123);
    assertEquals(ctx.get("userName"), "John");
  });

  it("should return undefined for non-existent keys", () => {
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);

    assertEquals(ctx.get("nonExistent"), undefined);
  });

  it("should have var property for middleware variables", () => {
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);

    ctx.var.token = "abc123";
    ctx.var.user = { id: 1, name: "Test" };

    assertEquals(ctx.var.token, "abc123");
    assertEquals((ctx.var.user as { id: number; name: string }).id, 1);
  });

  it("should store different types of values", () => {
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);

    ctx.set("string", "value");
    ctx.set("number", 42);
    ctx.set("boolean", true);
    ctx.set("object", { key: "value" });
    ctx.set("array", [1, 2, 3]);

    assertEquals(ctx.get("string"), "value");
    assertEquals(ctx.get("number"), 42);
    assertEquals(ctx.get("boolean"), true);
    assertEquals((ctx.get("object") as { key: string }).key, "value");
    assertEquals((ctx.get("array") as number[]).length, 3);
  });

  it("should override values when setting the same key", () => {
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);

    ctx.set("key", "initial");
    assertEquals(ctx.get("key"), "initial");

    ctx.set("key", "updated");
    assertEquals(ctx.get("key"), "updated");
  });

  it("should have independent stores between contexts", () => {
    const req1 = new Request("http://localhost/test1");
    const req2 = new Request("http://localhost/test2");
    const ctx1 = new MiddlewareContext(req1);
    const ctx2 = new MiddlewareContext(req2);

    ctx1.set("key", "value1");
    ctx2.set("key", "value2");

    assertEquals(ctx1.get("key"), "value1");
    assertEquals(ctx2.get("key"), "value2");
  });

  it("should handle null values in store", () => {
    const req = new Request("http://localhost/test");
    const ctx = new MiddlewareContext(req);

    ctx.set("nullKey", null);

    assertEquals(ctx.get("nullKey"), null);
  });
});
