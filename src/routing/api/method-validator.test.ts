import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAppRouteMethodNotAllowed,
  createPagesRouteMethodNotAllowed,
} from "./method-validator.ts";

describe("method-validator", () => {
  describe("createAppRouteMethodNotAllowed", () => {
    it("should return 405 response", () => {
      const handler = { GET: () => new Response("ok") };
      const response = createAppRouteMethodNotAllowed(handler);

      assertEquals(response.status, 405);
    });

    it("should include Allow header with available methods", () => {
      const handler = {
        GET: () => new Response("ok"),
        POST: () => new Response("ok"),
      };
      const response = createAppRouteMethodNotAllowed(handler);

      const allowHeader = response.headers.get("Allow");
      assertEquals(allowHeader?.includes("GET"), true);
      assertEquals(allowHeader?.includes("POST"), true);
    });

    it("should handle handler with no methods", () => {
      const handler = {};
      const response = createAppRouteMethodNotAllowed(handler);

      assertEquals(response.status, 405);
      assertEquals(response.headers.get("Allow"), "");
    });

    it("should detect all standard HTTP methods", () => {
      const handler = {
        GET: () => new Response(""),
        POST: () => new Response(""),
        PUT: () => new Response(""),
        DELETE: () => new Response(""),
        PATCH: () => new Response(""),
        HEAD: () => new Response(""),
        OPTIONS: () => new Response(""),
      };
      const response = createAppRouteMethodNotAllowed(handler);
      const allowHeader = response.headers.get("Allow") || "";

      assertEquals(allowHeader.includes("GET"), true);
      assertEquals(allowHeader.includes("POST"), true);
      assertEquals(allowHeader.includes("PUT"), true);
      assertEquals(allowHeader.includes("DELETE"), true);
      assertEquals(allowHeader.includes("PATCH"), true);
      assertEquals(allowHeader.includes("HEAD"), true);
      assertEquals(allowHeader.includes("OPTIONS"), true);
    });
  });

  describe("createPagesRouteMethodNotAllowed", () => {
    it("should return 405 response", () => {
      const handler = { GET: () => new Response("ok") };
      const response = createPagesRouteMethodNotAllowed(handler);

      assertEquals(response.status, 405);
    });

    it("should exclude default from allowed methods", () => {
      const handler = {
        GET: () => new Response("ok"),
        default: () => new Response("ok"),
      };
      const response = createPagesRouteMethodNotAllowed(handler);

      const allowHeader = response.headers.get("Allow") || "";
      assertEquals(allowHeader.includes("GET"), true);
      assertEquals(allowHeader.includes("default"), false);
    });

    it("should only include function handlers", () => {
      const handler = {
        GET: () => new Response("ok"),
        notAMethod: "string value",
        config: { runtime: "edge" },
      };
      const response = createPagesRouteMethodNotAllowed(handler);

      const allowHeader = response.headers.get("Allow") || "";
      assertEquals(allowHeader.includes("GET"), true);
      assertEquals(allowHeader.includes("notAMethod"), false);
      assertEquals(allowHeader.includes("config"), false);
    });
  });
});
