import { describe, it } from "#veryfront/testing/bdd.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  build,
  html,
  javascript,
  json,
  notModified,
  text,
  withContentType,
} from "./response-methods.ts";
import type { ResponseMethodsContext } from "./response-methods.ts";

function createContext(status = 200): ResponseMethodsContext {
  return { headers: new Headers(), status };
}

describe("security/http/response/response-methods", () => {
  describe("json", () => {
    it("should return a response with JSON content type", async () => {
      const ctx = createContext();
      const res = json.call(ctx, { message: "hello" });
      assertEquals(res.headers.get("content-type"), "application/json; charset=utf-8");
      const body = await res.json();
      assertEquals(body.message, "hello");
    });

    it("should use default status from context", () => {
      const ctx = createContext(200);
      const res = json.call(ctx, {});
      assertEquals(res.status, 200);
    });

    it("should override status when provided", () => {
      const ctx = createContext(200);
      const res = json.call(ctx, {}, 201);
      assertEquals(res.status, 201);
    });
  });

  describe("text", () => {
    it("should return a response with text content type", async () => {
      const ctx = createContext();
      const res = text.call(ctx, "hello");
      assertEquals(res.headers.get("content-type"), "text/plain; charset=utf-8");
      assertEquals(await res.text(), "hello");
    });

    it("should override status when provided", () => {
      const ctx = createContext();
      const res = text.call(ctx, "error", 400);
      assertEquals(res.status, 400);
    });
  });

  describe("html", () => {
    it("should return a response with HTML content type", async () => {
      const ctx = createContext();
      const res = html.call(ctx, "<h1>Hello</h1>");
      assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
      assertEquals(await res.text(), "<h1>Hello</h1>");
    });
  });

  describe("javascript", () => {
    it("should return a response with JS content type", async () => {
      const ctx = createContext();
      const res = javascript.call(ctx, "console.log('hi')");
      assertEquals(
        res.headers.get("content-type"),
        "application/javascript; charset=utf-8",
      );
      assertEquals(await res.text(), "console.log('hi')");
    });
  });

  describe("withContentType", () => {
    it("should set custom content type", () => {
      const ctx = createContext();
      const res = withContentType.call(ctx, "application/xml", "<root/>");
      assertEquals(res.headers.get("content-type"), "application/xml");
    });
  });

  describe("build", () => {
    it("should build response with null body by default", () => {
      const ctx = createContext();
      const res = build.call(ctx);
      assertEquals(res.status, 200);
    });

    it("should build response with body and status", async () => {
      const ctx = createContext();
      const res = build.call(ctx, "body content", 201);
      assertEquals(res.status, 201);
      assertEquals(await res.text(), "body content");
    });

    it("should include headers from context", () => {
      const ctx = createContext();
      ctx.headers.set("X-Custom", "value");
      const res = build.call(ctx);
      assertEquals(res.headers.get("X-Custom"), "value");
    });
  });

  describe("notModified", () => {
    it("should return 304 status", () => {
      const ctx = createContext();
      const res = notModified.call(ctx);
      assertEquals(res.status, 304);
    });

    it("should set ETag header when provided", () => {
      const ctx = createContext();
      const res = notModified.call(ctx, 'W/"abc"');
      assertEquals(res.status, 304);
      assertEquals(res.headers.get("ETag"), 'W/"abc"');
    });

    it("should not set ETag when not provided", () => {
      const ctx = createContext();
      const res = notModified.call(ctx);
      assertEquals(res.headers.has("ETag"), false);
    });
  });
});
