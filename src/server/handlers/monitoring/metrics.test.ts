import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists, assert } from "std/assert/mod.ts";
import { MetricsHandler } from "./metrics.ts";
import type { HandlerContext } from "../types.ts";

describe("MetricsHandler", () => {
  let handler: MetricsHandler;
  let mockContext: HandlerContext;

  beforeEach(() => {
    handler = new MetricsHandler();
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
    assertEquals(handler.metadata.name, "MetricsHandler");
    assertExists(handler.metadata.patterns);
    assertEquals(handler.metadata.patterns!.length, 1);
  });

  it("should match /_metrics pattern", () => {
    assertExists(handler.metadata.patterns);
    const pattern = handler.metadata.patterns!.find((p) => p.pattern === "/_metrics");
    assertExists(pattern);
    assertEquals(pattern.exact, true);
  });

  it("should return metrics JSON for /_metrics", async () => {
    const req = new Request("http://example.com/_metrics");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    const json = await result.response.json();
    assertExists(json);
  });

  it("should include counters in response", async () => {
    const req = new Request("http://example.com/_metrics");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const json = await result.response.json();
    assertExists(json.counters);
  });

  it("should include memory in response", async () => {
    const req = new Request("http://example.com/_metrics");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const json = await result.response.json();
    // Memory may be undefined in some environments, but the field should exist
    assert("memory" in json);
  });

  it("should include uptime in response", async () => {
    const req = new Request("http://example.com/_metrics");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const json = await result.response.json();
    // Uptime may be undefined in some environments, but the field should exist
    assert("uptime" in json);
  });

  it("should not handle non-metrics paths", async () => {
    const req = new Request("http://example.com/other");
    const result = await handler.handle(req, mockContext);

    assertEquals(result.response, undefined);
  });

  it("should have content-type application/json", async () => {
    const req = new Request("http://example.com/_metrics");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const contentType = result.response.headers.get("content-type");
    assertExists(contentType);
    assert(contentType.includes("application/json"));
  });

  it("should return 200 status code on success", async () => {
    const req = new Request("http://example.com/_metrics");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    assertEquals(result.response.status, 200);
  });

  it("should handle metrics collection gracefully", async () => {
    const req = new Request("http://example.com/_metrics");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    // Should not throw and should return a valid response
    assertEquals(typeof result.response, "object");
  });
});
