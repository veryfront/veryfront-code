import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists } from "std/assert/mod.ts";
import { ClientLogHandler } from "./client-log.ts";
import type { HandlerContext } from "../types.ts";

describe("ClientLogHandler", () => {
  let handler: ClientLogHandler;
  let mockContext: HandlerContext;

  beforeEach(() => {
    handler = new ClientLogHandler();
    mockContext = {
      adapter: {} as any,
      config: {} as any,
      projectDir: "/test/project",
      mode: "development",
      securityConfig: null,
      cspUserHeader: null,
    };
  });

  it("should have correct metadata", () => {
    assertExists(handler.metadata);
    assertEquals(handler.metadata.name, "ClientLogHandler");
    assertExists(handler.metadata.patterns);
    assertEquals(handler.metadata.patterns!.length, 1);
  });

  it("should match /_veryfront/log pattern", () => {
    assertExists(handler.metadata.patterns);
    const pattern = handler.metadata.patterns!.find(
      (p) => p.pattern === "/_veryfront/log",
    );
    assertExists(pattern);
    assertEquals(pattern.exact, true);
    assertEquals(pattern.method, "POST");
  });

  it("should only be enabled in development mode", () => {
    assertExists(handler.metadata.enabled);
    assertEquals(
      handler.metadata.enabled!(mockContext),
      true,
    );

    const prodContext = { ...mockContext, mode: "production" as const };
    assertEquals(
      handler.metadata.enabled!(prodContext),
      false,
    );
  });

  it("should return ok for valid log request", async () => {
    const logData = {
      level: "info",
      message: "Test log message",
      details: { foo: "bar" },
    };

    const req = new Request("http://example.com/_veryfront/log", {
      method: "POST",
      body: JSON.stringify(logData),
      headers: { "content-type": "application/json" },
    });

    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const json = await result.response.json();
    assertEquals(json.ok, true);
  });

  it("should handle error level logs", async () => {
    const logData = {
      level: "error",
      message: "Error message",
    };

    const req = new Request("http://example.com/_veryfront/log", {
      method: "POST",
      body: JSON.stringify(logData),
    });

    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    assertEquals(result.response.status, 200);
  });

  it("should handle warn level logs", async () => {
    const logData = {
      level: "warn",
      message: "Warning message",
    };

    const req = new Request("http://example.com/_veryfront/log", {
      method: "POST",
      body: JSON.stringify(logData),
    });

    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    assertEquals(result.response.status, 200);
  });

  it("should handle info level logs", async () => {
    const logData = {
      level: "info",
      message: "Info message",
    };

    const req = new Request("http://example.com/_veryfront/log", {
      method: "POST",
      body: JSON.stringify(logData),
    });

    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    assertEquals(result.response.status, 200);
  });

  it("should not handle GET requests", async () => {
    const req = new Request("http://example.com/_veryfront/log", {
      method: "GET",
    });

    const result = await handler.handle(req, mockContext);

    assertEquals(result.response, undefined);
  });

  it("should not handle non-log paths", async () => {
    const req = new Request("http://example.com/other", {
      method: "POST",
      body: JSON.stringify({ message: "test" }),
    });

    const result = await handler.handle(req, mockContext);

    assertEquals(result.response, undefined);
  });

  it("should handle invalid JSON gracefully", async () => {
    const req = new Request("http://example.com/_veryfront/log", {
      method: "POST",
      body: "invalid json{",
    });

    const result = await handler.handle(req, mockContext);

    // Should still return ok:true even on parse error
    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const json = await result.response.json();
    assertEquals(json.ok, true);
  });

  it("should handle empty body", async () => {
    const req = new Request("http://example.com/_veryfront/log", {
      method: "POST",
      body: "",
    });

    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    assertEquals(result.response.status, 200);
  });

  it("should handle logs without details", async () => {
    const logData = {
      level: "info",
      message: "Simple message",
    };

    const req = new Request("http://example.com/_veryfront/log", {
      method: "POST",
      body: JSON.stringify(logData),
    });

    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    assertEquals(result.response.status, 200);
  });

  it("should return JSON response", async () => {
    const logData = {
      level: "info",
      message: "Test",
    };

    const req = new Request("http://example.com/_veryfront/log", {
      method: "POST",
      body: JSON.stringify(logData),
    });

    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const contentType = result.response.headers.get("content-type");
    assertExists(contentType);
    assertEquals(contentType.includes("application/json"), true);
  });
});
