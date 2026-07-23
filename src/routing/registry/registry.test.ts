import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { buildRouteRegistrySpanAttributes, RouteRegistry } from "./registry.ts";
import type { Handler, HandlerContext, HandlerResult } from "./types.ts";
import { CONFIG_NOT_FOUND } from "#veryfront/errors/error-registry.ts";
import {
  createWebSocketUpgradeResponse,
  type RuntimeResponse,
} from "#veryfront/platform/adapters/base.ts";
import { getBaseLogger, runWithRequestContextAsync } from "#veryfront/utils";
import {
  __registerLogRecordEmitter,
  __resetLogRecordEmitterForTests,
  type LogEntry,
} from "#veryfront/utils/logger/logger.ts";

function makeHandler(
  name: string,
  priority: number,
  result: HandlerResult<RuntimeResponse> = { continue: true },
  enabled?: (ctx: HandlerContext) => boolean,
): Handler<RuntimeResponse> {
  return {
    metadata: { name, priority, enabled },
    handle: () => Promise.resolve(result),
  };
}

function makeCtx(): HandlerContext {
  return {
    projectDir: "/tmp/test",
    adapter: {} as HandlerContext["adapter"],
    securityConfig: null,
    cspUserHeader: null,
  };
}

function makeReq(): Request {
  return new Request("http://localhost/test");
}

describe("routing/registry/RouteRegistry", () => {
  afterEach(() => {
    __resetLogRecordEmitterForTests();
  });

  describe("register()", () => {
    it("should register a handler", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("test", 100));
      assertEquals(registry.has("test"), true);
    });

    it("should sort handlers by priority after registration", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("low", 1000));
      registry.register(makeHandler("high", 100));
      registry.register(makeHandler("medium", 500));

      const names = registry.getHandlers().map((h) => h.metadata.name);
      assertEquals(names, ["high", "medium", "low"]);
    });

    it("should return this for chaining", () => {
      const registry = new RouteRegistry();
      const result = registry.register(makeHandler("test", 100));
      assertEquals(result, registry);
    });
  });

  describe("registerAll()", () => {
    it("should register multiple handlers", () => {
      const registry = new RouteRegistry();
      registry.registerAll([
        makeHandler("a", 100),
        makeHandler("b", 200),
        makeHandler("c", 300),
      ]);
      assertEquals(registry.getHandlers().length, 3);
    });

    it("should sort all handlers by priority", () => {
      const registry = new RouteRegistry();
      registry.registerAll([
        makeHandler("c", 300),
        makeHandler("a", 100),
        makeHandler("b", 200),
      ]);
      const names = registry.getHandlers().map((h) => h.metadata.name);
      assertEquals(names, ["a", "b", "c"]);
    });
  });

  describe("execute()", () => {
    it("records only the method in routing span attributes", () => {
      const req = new Request(
        "http://private-domain-canary.example/private-route-canary?private-query-canary=1",
        { method: "POST" },
      );
      const url = new URL(req.url);
      const attributes = buildRouteRegistrySpanAttributes(req, url, {
        ...makeCtx(),
        projectSlug: "private-project-canary",
        projectId: "private-project-id-canary",
        releaseId: "private-release-canary",
        resolvedEnvironment: "production",
        environmentName: "private-environment-canary",
        enriched: {
          projectSlug: "private-enriched-project-canary",
          projectId: "private-enriched-project-id-canary",
        } as HandlerContext["enriched"],
      });

      assertEquals(attributes, { "http.method": "POST" });
      const serializedAttributes = JSON.stringify(attributes);
      for (
        const privateValue of [
          "private-domain-canary",
          "private-route-canary",
          "private-query-canary",
          "private-project-canary",
          "private-project-id-canary",
          "private-release-canary",
          "private-environment-canary",
          "private-enriched-project-canary",
          "private-enriched-project-id-canary",
        ]
      ) {
        assertEquals(serializedAttributes.includes(privateValue), false);
      }
    });

    it("should return response from first matching handler", async () => {
      const registry = new RouteRegistry();
      registry.register(
        makeHandler("responder", 100, {
          response: new Response("ok", { status: 200 }),
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(result?.status, 200);
    });

    it("preserves WebSocket upgrade response identity", async () => {
      const registry = new RouteRegistry();
      const upgradeResponse = createWebSocketUpgradeResponse();
      registry.register(
        makeHandler("websocket", 100, { response: upgradeResponse }),
      );

      const result = await registry.execute(makeReq(), makeCtx());

      assertEquals(Object.is(result, upgradeResponse), true);
    });

    it("should skip handlers that return continue: true", async () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("pass-through", 100, { continue: true }));
      registry.register(
        makeHandler("responder", 200, {
          response: new Response("found", { status: 200 }),
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(result?.status, 200);
      assert(result instanceof Response);
      assertEquals(await result?.text(), "found");
    });

    it("should return null when no handler matches", async () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("pass", 100, { continue: true }));

      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(result, null);
    });

    it("should stop chain when handler returns continue: false without response", async () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("stopper", 100, { continue: false }));
      registry.register(
        makeHandler("never-reached", 200, {
          response: new Response("should not see"),
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(result, null);
    });

    it("should skip disabled handlers", async () => {
      const registry = new RouteRegistry();
      registry.register(
        makeHandler(
          "disabled",
          100,
          { response: new Response("disabled") },
          () => false,
        ),
      );
      registry.register(
        makeHandler("enabled", 200, {
          response: new Response("enabled"),
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());
      assert(result instanceof Response);
      assertEquals(await result?.text(), "enabled");
    });

    it("should return RFC 9457 error response when handler throws", async () => {
      const registry = new RouteRegistry();
      const errorHandler: Handler<RuntimeResponse> = {
        metadata: { name: "erroring", priority: 100 },
        handle: () => Promise.reject(new Error("handler error")),
      };

      registry.register(errorHandler);
      registry.register(
        makeHandler("fallback", 200, {
          response: new Response("fallback", { status: 200 }),
        }),
      );

      const result = await registry.execute(makeReq(), makeCtx());

      // Should return error response, not continue to fallback handler
      assertEquals(result?.status, 500);
      assertEquals(result?.headers.get("Content-Type"), "application/problem+json");
      assert(result instanceof Response);

      const body = await result?.json() as { type?: string; title?: string; category?: string };
      assertEquals(body.type?.includes("unknown-error"), true);
      assertEquals(body.category, "GENERAL");
    });

    it("keeps handler failure logs useful without request or error details", async () => {
      const entries: LogEntry[] = [];
      __registerLogRecordEmitter((entry) => entries.push(entry));
      const registry = new RouteRegistry();
      const error = new TypeError("private-error-message-canary");
      registry.register({
        metadata: { name: "erroring-handler", priority: 100 },
        handle: () => Promise.reject(error),
      });

      const requestLogger = getBaseLogger("SERVER").child({
        requestId: "private-request-id-canary",
        request_url: "http://private-domain-canary.example/private-route-canary",
        domain: "private-domain-canary.example",
        project_slug: "private-project-canary",
        project_id: "private-project-id-canary",
        release_id: "private-release-canary",
        branch_id: "private-branch-id-canary",
        branch_name: "private-branch-name-canary",
      });

      const result = await runWithRequestContextAsync(
        {
          logger: requestLogger,
          requestId: "private-request-id-canary",
          projectSlug: "private-project-canary",
          projectId: "private-project-id-canary",
          domain: "private-domain-canary.example",
        },
        () =>
          registry.execute(
            new Request(
              "http://private-domain-canary.example/private-route-canary?private-query-canary=1",
              { method: "POST" },
            ),
            {
              ...makeCtx(),
              projectSlug: "private-project-canary",
              projectId: "private-project-id-canary",
              releaseId: "private-release-canary",
              environmentName: "private-environment-canary",
            },
          ),
      );

      assertEquals(result?.status, 500);
      const failureEntry = entries.find((entry) => entry.message === "Route handler failed");
      assert(failureEntry);
      assertEquals(failureEntry.context?.handler, "erroring-handler");
      assertEquals(failureEntry.context?.method, "POST");
      assertEquals(failureEntry.context?.status, 500);
      assertEquals(failureEntry.context?.errorName, "TypeError");

      const serializedEntry = JSON.stringify(failureEntry);
      for (
        const privateValue of [
          "private-error-message-canary",
          "private-request-id-canary",
          "private-domain-canary",
          "private-route-canary",
          "private-query-canary",
          "private-project-canary",
          "private-project-id-canary",
          "private-release-canary",
          "private-branch-id-canary",
          "private-branch-name-canary",
          "private-environment-canary",
        ]
      ) {
        assertEquals(serializedEntry.includes(privateValue), false);
      }
    });

    it("should return RFC 9457 response with correct slug for VeryfrontError", async () => {
      const registry = new RouteRegistry();
      const errorHandler: Handler<RuntimeResponse> = {
        metadata: { name: "config-error", priority: 100 },
        handle: () => Promise.reject(CONFIG_NOT_FOUND.create({ detail: "Test config error" })),
      };

      registry.register(errorHandler);

      const result = await registry.execute(makeReq(), makeCtx());

      assertEquals(result?.status, 404);
      assertEquals(result?.headers.get("Content-Type"), "application/problem+json");
      assert(result instanceof Response);

      const body = await result?.json() as {
        type?: string;
        detail?: string;
        suggestion?: string;
        category?: string;
      };
      assertEquals(body.type?.includes("config-not-found"), true);
      assertEquals(body.category, "CONFIG");
      assertEquals(body.detail, "Test config error");
      assertEquals(body.suggestion?.includes("veryfront init"), true);
    });

    it("should return null on empty registry", async () => {
      const registry = new RouteRegistry();
      const result = await registry.execute(makeReq(), makeCtx());
      assertEquals(result, null);
    });
  });

  describe("getHandlers()", () => {
    it("should return all registered handlers", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("a", 100));
      registry.register(makeHandler("b", 200));
      assertEquals(registry.getHandlers().length, 2);
    });

    it("should return empty array when no handlers registered", () => {
      const registry = new RouteRegistry();
      assertEquals(registry.getHandlers().length, 0);
    });

    it("returns a snapshot that cannot mutate registry state", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("registered", 100));

      const snapshot = registry.getHandlers() as Handler<RuntimeResponse>[];
      snapshot.length = 0;

      assertEquals(registry.has("registered"), true);
      assertEquals(registry.getHandlers().length, 1);
    });
  });

  describe("clear()", () => {
    it("should remove all handlers", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("a", 100));
      registry.register(makeHandler("b", 200));
      registry.clear();
      assertEquals(registry.getHandlers().length, 0);
    });

    it("should return this for chaining", () => {
      const registry = new RouteRegistry();
      const result = registry.clear();
      assertEquals(result, registry);
    });
  });

  describe("remove()", () => {
    it("should remove handler by name", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("a", 100));
      registry.register(makeHandler("b", 200));
      registry.remove("a");
      assertEquals(registry.has("a"), false);
      assertEquals(registry.has("b"), true);
    });

    it("should return this for chaining", () => {
      const registry = new RouteRegistry();
      const result = registry.remove("nonexistent");
      assertEquals(result, registry);
    });
  });

  describe("has()", () => {
    it("should return true for existing handler", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("test", 100));
      assertEquals(registry.has("test"), true);
    });

    it("should return false for non-existing handler", () => {
      const registry = new RouteRegistry();
      assertEquals(registry.has("nonexistent"), false);
    });
  });

  describe("getStats()", () => {
    it("should return correct statistics", () => {
      const registry = new RouteRegistry();
      registry.register(makeHandler("a", 100));
      registry.register(makeHandler("b", 100));
      registry.register(makeHandler("c", 500));

      const stats = registry.getStats();
      assertEquals(stats.totalHandlers, 3);
      assertEquals(stats.handlerNames, ["a", "b", "c"]);
      assertEquals(stats.handlersByPriority["100"], 2);
      assertEquals(stats.handlersByPriority["500"], 1);
    });

    it("should return empty stats for empty registry", () => {
      const registry = new RouteRegistry();
      const stats = registry.getStats();
      assertEquals(stats.totalHandlers, 0);
      assertEquals(stats.handlerNames, []);
      assertEquals(stats.handlersByPriority, {});
    });
  });
});
