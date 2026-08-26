import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { HandlerContext } from "../types.ts";
import { MetricsHandler } from "./metrics.handler.ts";
import { recordRequestPeerFromTransport } from "#veryfront/platform/adapters/runtime/shared/request-peer.ts";

function createHandler(
  metricsRuntime?: ConstructorParameters<typeof MetricsHandler>[0],
): MetricsHandler {
  return new MetricsHandler(metricsRuntime);
}

function createLoopbackRequest(input: string | URL, init?: RequestInit): Request {
  const headers = new Headers(init?.headers);
  headers.set("host", new URL(input).host);
  const request = new Request(input, { ...init, headers });
  recordRequestPeerFromTransport(request, {
    runtime: "deno",
    transport: "tcp",
    hostname: "127.0.0.1",
  });
  return request;
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
      const req = createLoopbackRequest("http://localhost/_metrics");
      const result = await handler.handle(req, remoteCtx);
      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("should return continue for non-matching pathname", async () => {
      const handler = createHandler();
      const req = createLoopbackRequest("http://localhost/other-path");
      const result = await handler.handle(req, localCtx);
      assertEquals(result.continue, true);
      assertEquals(result.response, undefined);
    });

    it("should return metrics for local projects", async () => {
      const handler = createHandler();
      const req = createLoopbackRequest("http://localhost/_metrics");
      const result = await handler.handle(req, localCtx);

      assertExists(result.response);
      assertEquals(result.response.status, 200);
      const body = await result.response.json();
      assertExists(body.counters, "metrics payload must include counters");
      assertExists(body.profiling, "metrics payload must include request profiling");
      assertExists(body.memory, "metrics payload must include process memory");
      assertEquals(
        typeof body.uptime,
        "number",
        "metrics payload must include numeric process uptime",
      );
    });

    it("should return 500 when gathering metrics fails", async () => {
      const handler = createHandler({
        snapshot: () => {
          throw new Error("snapshot unavailable");
        },
      });
      const req = createLoopbackRequest("http://localhost/_metrics");
      const result = await handler.handle(req, localCtx);

      assertExists(result.response);
      assertEquals(result.response.status, 500, "a snapshot failure must surface as 500");
      assertEquals(await result.response.text(), "Failed to gather metrics");
    });
  });
});
