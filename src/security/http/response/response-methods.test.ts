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
      const res = json.call(createContext(), { message: "hello" });
      assertEquals(
        res.headers.get("content-type"),
        "application/json; charset=utf-8",
      );
      assertEquals((await res.json()).message, "hello");
    });

    it("should use default status from context", () => {
      assertEquals(json.call(createContext(200), {}).status, 200);
    });

    it("should override status when provided", () => {
      assertEquals(json.call(createContext(200), {}, 201).status, 201);
    });
  });

  describe("text", () => {
    it("should return a response with text content type", async () => {
      const res = text.call(createContext(), "hello");
      assertEquals(res.headers.get("content-type"), "text/plain; charset=utf-8");
      assertEquals(await res.text(), "hello");
    });

    it("should override status when provided", () => {
      assertEquals(text.call(createContext(), "error", 400).status, 400);
    });
  });

  describe("html", () => {
    it("should return a response with HTML content type", async () => {
      const res = html.call(createContext(), "<h1>Hello</h1>");
      assertEquals(res.headers.get("content-type"), "text/html; charset=utf-8");
      assertEquals(await res.text(), "<h1>Hello</h1>");
    });
  });

  describe("javascript", () => {
    it("should return a response with JS content type", async () => {
      const res = javascript.call(createContext(), "console.log('hi')");
      assertEquals(
        res.headers.get("content-type"),
        "application/javascript; charset=utf-8",
      );
      assertEquals(await res.text(), "console.log('hi')");
    });
  });

  describe("withContentType", () => {
    it("should set custom content type", () => {
      assertEquals(
        withContentType.call(createContext(), "application/xml", "<root/>")
          .headers.get("content-type"),
        "application/xml",
      );
    });
  });

  describe("build", () => {
    it("should build response with null body by default", () => {
      assertEquals(build.call(createContext()).status, 200);
    });

    it("should build response with body and status", async () => {
      const res = build.call(createContext(), "body content", 201);
      assertEquals(res.status, 201);
      assertEquals(await res.text(), "body content");
    });

    it("should include headers from context", () => {
      const ctx = createContext();
      ctx.headers.set("X-Custom", "value");
      assertEquals(build.call(ctx).headers.get("X-Custom"), "value");
    });
  });

  describe("notModified", () => {
    it("should return 304 status", () => {
      assertEquals(notModified.call(createContext()).status, 304);
    });

    it("should set ETag header when provided", () => {
      const res = notModified.call(createContext(), 'W/"abc"');
      assertEquals(res.status, 304);
      assertEquals(res.headers.get("ETag"), 'W/"abc"');
    });

    it("should not set ETag when not provided", () => {
      assertEquals(notModified.call(createContext()).headers.has("ETag"), false);
    });
  });
});
