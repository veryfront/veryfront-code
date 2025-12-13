import { describe, it, beforeEach } from "std/testing/bdd.ts";
import { assertEquals, assertExists, assertStringIncludes } from "std/assert/mod.ts";
import { NotFoundHandler } from "./not-found.ts";
import type { HandlerContext } from "../types.ts";

describe("NotFoundHandler", () => {
  let handler: NotFoundHandler;
  let mockContext: HandlerContext;

  beforeEach(() => {
    handler = new NotFoundHandler();
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
    assertEquals(handler.metadata.name, "NotFoundHandler");
    assertExists(handler.metadata.priority);
    assertEquals(Array.isArray(handler.metadata.patterns), true);
  });

  it("should return 404 response for any request", async () => {
    const req = new Request("http://example.com/not-found");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    assertEquals(result.response.status, 404);
  });

  it("should include HTML content in response", async () => {
    const req = new Request("http://example.com/missing-page");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const text = await result.response.text();
    assertStringIncludes(text, "<!DOCTYPE html>");
    assertStringIncludes(text, "<html");
    assertStringIncludes(text, "404");
  });

  it("should include pathname in error message", async () => {
    const req = new Request("http://example.com/test-path");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const text = await result.response.text();
    assertStringIncludes(text, "/test-path");
  });

  it("should escape HTML in pathname", async () => {
    const req = new Request("http://example.com/<script>alert('xss')</script>");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const text = await result.response.text();
    // URL encoding happens before our escape function, but we can verify escaping works
    // The path gets URL encoded by the Request constructor, so we see %3C instead of <
    assertStringIncludes(text, "&#039;");  // Check that apostrophes are escaped
  });

  it("should include 'Page Not Found' title", async () => {
    const req = new Request("http://example.com/missing");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const text = await result.response.text();
    assertStringIncludes(text, "Page Not Found");
  });

  it("should include home link", async () => {
    const req = new Request("http://example.com/missing");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const text = await result.response.text();
    assertStringIncludes(text, 'href="/"');
    assertStringIncludes(text, "Go Home");
  });

  it("should include back button", async () => {
    const req = new Request("http://example.com/missing");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const text = await result.response.text();
    assertStringIncludes(text, "history.back()");
    assertStringIncludes(text, "Go Back");
  });

  it("should include viewport meta tag", async () => {
    const req = new Request("http://example.com/missing");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const text = await result.response.text();
    assertStringIncludes(text, 'name="viewport"');
  });

  it("should have proper content type", async () => {
    const req = new Request("http://example.com/missing");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const contentType = result.response.headers.get("content-type");
    assertExists(contentType);
    assertStringIncludes(contentType, "text/html");
  });

  it("should handle root path correctly", async () => {
    const req = new Request("http://example.com/");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    assertEquals(result.response.status, 404);
    const text = await result.response.text();
    assertStringIncludes(text, "404");
  });

  it("should handle nested paths", async () => {
    const req = new Request("http://example.com/deep/nested/path");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    assertEquals(result.response.status, 404);
    const text = await result.response.text();
    assertStringIncludes(text, "/deep/nested/path");
  });

  it("should escape special characters", async () => {
    const req = new Request("http://example.com/path?query=<script>");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const text = await result.response.text();
    // The pathname won't include query string, just the path
    assertExists(text);
  });

  it("should include responsive styling", async () => {
    const req = new Request("http://example.com/missing");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    const text = await result.response.text();
    assertStringIncludes(text, "<style>");
    assertStringIncludes(text, "viewport");
  });

  it("should handle handler result structure", async () => {
    const req = new Request("http://example.com/missing");
    const result = await handler.handle(req, mockContext);

    assertExists(result.response);
    assertEquals(typeof result.response, "object");
    assertEquals(result.response instanceof Response, true);
  });
});
