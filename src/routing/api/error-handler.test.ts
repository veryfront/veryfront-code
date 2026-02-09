/**
 * Tests for API route error handling
 *
 * These tests verify that API route errors are converted to RFC 9457 responses
 * with appropriate environment-specific filtering.
 */

import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { executeAppRoute, executePagesRoute } from "./route-executor.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { RouteMatch } from "./api-route-matcher.ts";
import { PROBLEM_JSON_CONTENT_TYPE } from "#veryfront/errors/http-error.ts";

function makeAdapter(mode?: string): RuntimeAdapter {
  const envMap = new Map<string, string>();
  if (mode) envMap.set("MODE", mode);

  return {
    env: {
      get: (key: string) => envMap.get(key),
    },
    fs: {} as RuntimeAdapter["fs"],
  } as RuntimeAdapter;
}

function makeRouteMatch(pattern = "/api/test"): RouteMatch {
  return {
    route: { pattern, file: "/api/test/route.ts" },
    params: {},
  };
}

describe("routing/api/error-handler", () => {
  describe("executeAppRoute error handling", () => {
    it("should return RFC 9457 response on handler error", async () => {
      const handler = {
        GET: () => {
          throw new Error("Handler failed");
        },
      };

      const req = new Request("http://localhost/api/test");
      const res = await executeAppRoute(
        handler,
        req,
        makeRouteMatch(),
        "/api/test",
        makeAdapter("production"),
      );

      assertEquals(res.status, 500);
      assertEquals(res.headers.get("Content-Type"), PROBLEM_JSON_CONTENT_TYPE);

      const body = await res.json();
      assertEquals(body.type, "https://veryfront.com/docs/errors/unknown-error");
      assertEquals(body.status, 500);
      assertEquals(body.category, "GENERAL");
      assertEquals(body.instance, "/api/test");
    });

    it("should include stack trace in development mode", async () => {
      const handler = {
        GET: () => {
          throw new Error("Dev error");
        },
      };

      const req = new Request("http://localhost/api/test");
      const res = await executeAppRoute(
        handler,
        req,
        makeRouteMatch(),
        "/api/test",
        makeAdapter("development"),
      );

      const body = await res.json();
      assertEquals(typeof body.stack, "string");
      assertEquals(body.detail, "Dev error");
    });

    it("should omit stack and detail in production for 5xx errors", async () => {
      const handler = {
        POST: () => {
          throw new Error("Secret database error");
        },
      };

      const req = new Request("http://localhost/api/test", { method: "POST" });
      const res = await executeAppRoute(
        handler,
        req,
        makeRouteMatch(),
        "/api/test",
        makeAdapter("production"),
      );

      const body = await res.json();
      assertEquals(body.stack, undefined);
      assertEquals(body.detail, undefined); // 5xx errors hide detail in production
    });

    it("should handle non-Error throws", async () => {
      const handler = {
        DELETE: () => {
          throw "string error";
        },
      };

      const req = new Request("http://localhost/api/test", { method: "DELETE" });
      const res = await executeAppRoute(
        handler,
        req,
        makeRouteMatch(),
        "/api/test",
        makeAdapter("development"),
      );

      assertEquals(res.status, 500);
      const body = await res.json();
      assertEquals(body.type, "https://veryfront.com/docs/errors/unknown-error");
    });
  });

  describe("executePagesRoute error handling", () => {
    it("should return RFC 9457 response on handler error", async () => {
      const handler = {
        GET: () => {
          throw new Error("Pages handler failed");
        },
      };

      const req = new Request("http://localhost/api/test");
      const res = await executePagesRoute(
        handler,
        req,
        makeRouteMatch(),
        "/api/test",
        makeAdapter("production"),
      );

      assertEquals(res.status, 500);
      assertEquals(res.headers.get("Content-Type"), PROBLEM_JSON_CONTENT_TYPE);

      const body = await res.json();
      assertEquals(body.type, "https://veryfront.com/docs/errors/unknown-error");
    });
  });
});
