import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAppRouteMethodNotAllowed,
  createPagesRouteMethodNotAllowed,
} from "./method-validator.ts";

describe("method-validator", () => {
  describe("createAppRouteMethodNotAllowed", () => {
    it("should return 405 response", () => {
      const response = createAppRouteMethodNotAllowed({ GET: () => new Response("ok") });
      assertEquals(response.status, 405);
    });

    it("should include Allow header with available methods", () => {
      const response = createAppRouteMethodNotAllowed({
        GET: () => new Response("ok"),
        POST: () => new Response("ok"),
      });

      const allowHeader = response.headers.get("Allow") ?? "";
      for (const method of ["GET", "POST"]) {
        assertEquals(allowHeader.includes(method), true);
      }
    });

    it("should handle handler with no methods", () => {
      const response = createAppRouteMethodNotAllowed({});
      assertEquals(response.status, 405);
      assertEquals(response.headers.get("Allow"), "");
    });

    it("should detect all standard HTTP methods", () => {
      const response = createAppRouteMethodNotAllowed({
        GET: () => new Response(""),
        POST: () => new Response(""),
        PUT: () => new Response(""),
        DELETE: () => new Response(""),
        PATCH: () => new Response(""),
        HEAD: () => new Response(""),
        OPTIONS: () => new Response(""),
      });

      const allowHeader = response.headers.get("Allow") ?? "";
      for (const method of ["GET", "POST", "PUT", "DELETE", "PATCH", "HEAD", "OPTIONS"]) {
        assertEquals(allowHeader.includes(method), true);
      }
    });
  });

  describe("createPagesRouteMethodNotAllowed", () => {
    it("should return 405 response", () => {
      const response = createPagesRouteMethodNotAllowed({ GET: () => new Response("ok") });
      assertEquals(response.status, 405);
    });

    it("should exclude default from allowed methods", () => {
      const response = createPagesRouteMethodNotAllowed({
        GET: () => new Response("ok"),
        default: () => new Response("ok"),
      });

      const allowHeader = response.headers.get("Allow") ?? "";
      assertEquals(allowHeader.includes("GET"), true);
      assertEquals(allowHeader.includes("default"), false);
    });

    it("should only include function handlers", () => {
      const response = createPagesRouteMethodNotAllowed({
        GET: () => new Response("ok"),
        notAMethod: "string value",
        config: { runtime: "edge" },
      });

      const allowHeader = response.headers.get("Allow") ?? "";
      assertEquals(allowHeader.includes("GET"), true);
      assertEquals(allowHeader.includes("notAMethod"), false);
      assertEquals(allowHeader.includes("config"), false);
    });
  });
});
