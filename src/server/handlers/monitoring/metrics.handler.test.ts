import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../types.ts";
import { MetricsHandler } from "./metrics.handler.ts";

function createHandler(): MetricsHandler {
  return new MetricsHandler();
}

const localCtx = { securityConfig: undefined, isLocalProject: true } as unknown as HandlerContext;
const remoteCtx = { securityConfig: undefined, isLocalProject: false } as unknown as HandlerContext;

describe("server/handlers/monitoring/metrics", () => {
  describe("MetricsHandler metadata", () => {
    it("should have correct handler name", () => {
      const handler = createHandler();
      assertEquals(handler.metadata.name, "MetricsHandler");
    });

    it("should match /_metrics exactly", () => {
      const handler = createHandler();
      assertExists(handler.metadata.patterns);
      assertEquals(handler.metadata.patterns.length, 1);

      const pattern = handler.metadata.patterns[0];
      assertExists(pattern);
      assertEquals(typeof pattern !== "string" && pattern.pattern, "/_metrics");
      assertEquals(typeof pattern !== "string" && pattern.exact, true);
    });

    it("should only be enabled for local projects", () => {
      const handler = createHandler();
      const enabledFn = handler.metadata.enabled;
      assertEquals(typeof enabledFn, "function");

      if (typeof enabledFn !== "function") return;

      assertEquals(enabledFn({ isLocalProject: false } as unknown as HandlerContext), false);
      assertEquals(enabledFn({ isLocalProject: true } as unknown as HandlerContext), true);
      assertEquals(enabledFn({} as unknown as HandlerContext), false);
    });
  });

  describe("MetricsHandler.handle", () => {
    it("should return continue for remote projects", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/_metrics");
      const result = await handler.handle(req, remoteCtx);
      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("should return continue for non-matching pathname", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/other-path");
      const result = await handler.handle(req, localCtx);
      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("should return metrics for local projects", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/_metrics");
      const result = await handler.handle(req, localCtx);

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      assertEquals(result.response.headers.get("cache-control"), "no-store");
      assertEquals(result.response.headers.get("x-content-type-options"), "nosniff");
      const body = await result.response.json();
      assertExists(body.counters);
    });

    it("rejects cross-origin browser requests", async () => {
      const handler = createHandler();
      const req = new Request("http://localhost/_metrics", {
        headers: { Origin: "https://attacker.example" },
      });
      const result = await handler.handle(req, localCtx);

      assertExists(result.response);
      assertEquals(result.response.status, 401);
      assertEquals(result.response.headers.get("cache-control"), "no-store");
      assertEquals(result.response.headers.get("x-content-type-options"), "nosniff");
    });

    it("rejects requests sent to a non-loopback destination", async () => {
      const handler = createHandler();
      const result = await handler.handle(
        new Request("http://devbox.example/_metrics"),
        localCtx,
      );

      assertExists(result.response);
      assertEquals(result.response.status, 401);
    });

    it("returns 405 for non-GET requests", async () => {
      const handler = createHandler();
      const result = await handler.handle(
        new Request("http://localhost/_metrics", { method: "POST" }),
        localCtx,
      );

      assertExists(result.response);
      assertEquals(result.response.status, 405);
      assertEquals(result.response.headers.get("allow"), "GET");
    });
  });
});
