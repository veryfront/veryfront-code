/**
 * Handler Registry Factory Tests
 *
 * Verifies that createHandlerRegistry:
 * - Registers all expected handlers in the correct priority order
 * - Routes requests to the correct handler via the registry
 * - Respects overrides when provided
 *
 * @module server/runtime-handler/handler-registry-factory.test
 */

import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { RuntimeAdapter } from "#veryfront/platform/adapters/base.ts";
import type { Handler, HandlerResult } from "#veryfront/types";
import { HandlerPriority } from "#veryfront/types";
import { createHandlerRegistry, HANDLER_NAMES } from "./index.ts";

/** Minimal mock adapter — only `env.get` is needed by the factory. */
function createMockAdapter(): RuntimeAdapter {
  return {
    id: "test",
    name: "test",
    capabilities: {},
    fs: {} as RuntimeAdapter["fs"],
    env: {
      get: (_key: string) => undefined,
      set: () => {},
      delete: () => {},
      has: () => false,
      toObject: () => ({}),
    },
    server: {} as RuntimeAdapter["server"],
    serve: () => Promise.resolve({ close: () => Promise.resolve() }),
  } as unknown as RuntimeAdapter;
}

/** Creates a mock handler that responds to a specific path prefix. */
function createMockHandler(
  name: string,
  priority: HandlerPriority,
  pathPrefix?: string,
): Handler & { callCount: number } {
  const mock = {
    callCount: 0,
    metadata: {
      name,
      priority,
    },
    async handle(req: Request): Promise<HandlerResult> {
      if (pathPrefix) {
        const url = new URL(req.url);
        if (url.pathname.startsWith(pathPrefix)) {
          mock.callCount++;
          return { response: new Response(`${name} handled`, { status: 200 }) };
        }
      }
      return { continue: true };
    },
  };
  return mock;
}

describe("server/runtime-handler/createHandlerRegistry", () => {
  const adapter = createMockAdapter();
  const projectDir = "/tmp/test-project";

  it("registers all expected handlers", () => {
    const { registry } = createHandlerRegistry(projectDir, adapter);
    const stats = registry.getStats();

    // Should have all handlers from HANDLER_NAMES registered
    assertEquals(stats.totalHandlers, HANDLER_NAMES.length);

    // Verify key handlers are present
    const names = stats.handlerNames;
    assertEquals(names.includes("AuthHandler"), true);
    assertEquals(names.includes("CsrfHandler"), true);
    assertEquals(names.includes("CorsHandler"), true);
    assertEquals(names.includes("HealthHandler"), true);
    assertEquals(names.includes("SSRHandler"), true);
    assertEquals(names.includes("NotFoundHandler"), true);
    assertEquals(names.includes("ApiHandlerWrapper"), true);
    assertEquals(names.includes("HMRHandler"), true);
  });

  it("returns handlers sorted by priority (lowest number = highest priority)", () => {
    const { registry } = createHandlerRegistry(projectDir, adapter);
    const handlers = registry.getHandlers();

    // Verify the handlers are sorted by priority
    for (let i = 1; i < handlers.length; i++) {
      const prevPriority = handlers[i - 1].metadata.priority;
      const currPriority = handlers[i].metadata.priority;
      assertEquals(
        prevPriority <= currPriority,
        true,
        `Handler "${handlers[i - 1].metadata.name}" (priority ${prevPriority}) ` +
          `should come before "${handlers[i].metadata.name}" (priority ${currPriority})`,
      );
    }
  });

  it("places auth/security handlers before content handlers", () => {
    const { registry } = createHandlerRegistry(projectDir, adapter);
    const handlers = registry.getHandlers();
    const names = handlers.map((h) => h.metadata.name);

    const authIndex = names.indexOf("AuthHandler");
    const ssrIndex = names.indexOf("SSRHandler");
    const notFoundIndex = names.indexOf("NotFoundHandler");

    assertEquals(authIndex < ssrIndex, true, "AuthHandler should come before SSRHandler");
    assertEquals(ssrIndex < notFoundIndex, true, "SSRHandler should come before NotFoundHandler");
  });

  it("places NotFoundHandler last (FALLBACK priority)", () => {
    const { registry } = createHandlerRegistry(projectDir, adapter);
    const handlers = registry.getHandlers();
    const last = handlers[handlers.length - 1];

    assertEquals(last.metadata.name, "NotFoundHandler");
    assertEquals(last.metadata.priority, HandlerPriority.FALLBACK);
  });

  it("returns the apiHandler instance for initialization", () => {
    const { apiHandler } = createHandlerRegistry(projectDir, adapter);
    assertExists(apiHandler);
    assertEquals(typeof apiHandler.initialize, "function");
  });

  it("uses override when provided for a specific handler", () => {
    const mockHealth = createMockHandler("HealthHandler", HandlerPriority.HIGH, "/__/health");

    const { registry } = createHandlerRegistry(projectDir, adapter, {
      overrides: {
        HealthHandler: mockHealth,
      },
    });

    // The mock should be registered in place of the real HealthHandler
    const handlers = registry.getHandlers();
    const healthHandler = handlers.find((h) => h.metadata.name === "HealthHandler");
    assertExists(healthHandler);

    // Verify it is our mock (same object reference)
    assertEquals(healthHandler, mockHealth as Handler);
  });

  it("only overrides the specified handler, leaves others intact", () => {
    const mockSSR = createMockHandler("SSRHandler", HandlerPriority.LOW, "/");

    const { registry } = createHandlerRegistry(projectDir, adapter, {
      overrides: {
        SSRHandler: mockSSR,
      },
    });

    const stats = registry.getStats();

    // Total count should remain the same
    assertEquals(stats.totalHandlers, 32);

    // AuthHandler should still be the real one (not overridden)
    assertEquals(stats.handlerNames.includes("AuthHandler"), true);
    assertEquals(stats.handlerNames.includes("SSRHandler"), true);
  });

  it("routes request to mock handler when overridden", async () => {
    const mockHealth = createMockHandler("HealthHandler", HandlerPriority.HIGH, "/__/health");

    const { registry } = createHandlerRegistry(projectDir, adapter, {
      overrides: {
        HealthHandler: mockHealth,
      },
    });

    // Minimal HandlerContext for the registry.execute call
    const ctx = {
      projectDir,
      adapter,
      securityConfig: null,
      cspUserHeader: null,
    };

    const req = new Request("http://localhost/__/health");
    const response = await registry.execute(req, ctx as Parameters<typeof registry.execute>[1]);

    assertExists(response);
    assertEquals(response!.status, 200);
    assertEquals(await response!.text(), "HealthHandler handled");
    assertEquals(mockHealth.callCount, 1);
  });

  it("supports multiple simultaneous overrides", () => {
    const mockAuth = createMockHandler("AuthHandler", HandlerPriority.CRITICAL, "/__/auth");
    const mockSSR = createMockHandler("SSRHandler", HandlerPriority.LOW, "/");
    const mockHealth = createMockHandler("HealthHandler", HandlerPriority.HIGH, "/__/health");

    const { registry } = createHandlerRegistry(projectDir, adapter, {
      overrides: {
        AuthHandler: mockAuth,
        SSRHandler: mockSSR,
        HealthHandler: mockHealth,
      },
    });

    const handlers = registry.getHandlers();
    const authHandler = handlers.find((h) => h.metadata.name === "AuthHandler");
    const ssrHandler = handlers.find((h) => h.metadata.name === "SSRHandler");
    const healthHandler = handlers.find((h) => h.metadata.name === "HealthHandler");

    assertEquals(authHandler, mockAuth as Handler);
    assertEquals(ssrHandler, mockSSR as Handler);
    assertEquals(healthHandler, mockHealth as Handler);
    assertEquals(registry.getStats().totalHandlers, 32);
  });

  it("ignores overrides with non-existent handler names", () => {
    const mockFake = createMockHandler("FakeHandler", HandlerPriority.LOW);

    const { registry } = createHandlerRegistry(projectDir, adapter, {
      overrides: {
        FakeHandler: mockFake,
      },
    });

    // FakeHandler is not in the default list, so it should be ignored
    const stats = registry.getStats();
    assertEquals(stats.totalHandlers, 32);
    assertEquals(stats.handlerNames.includes("FakeHandler"), false);
  });

  it("works with empty overrides object", () => {
    const { registry } = createHandlerRegistry(projectDir, adapter, {
      overrides: {},
    });

    assertEquals(registry.getStats().totalHandlers, 32);
  });

  it("works with debug mode enabled", () => {
    const { registry } = createHandlerRegistry(projectDir, adapter, {
      debug: true,
    });

    assertEquals(registry.getStats().totalHandlers, 32);
  });

  it("contains all security handler group", () => {
    const { registry } = createHandlerRegistry(projectDir, adapter);
    const names = registry.getStats().handlerNames;
    for (const handler of ["AuthHandler", "CsrfHandler", "CorsHandler"]) {
      assertEquals(names.includes(handler), true, `Missing security handler: ${handler}`);
    }
  });

  it("contains all API handler group", () => {
    const { registry } = createHandlerRegistry(projectDir, adapter);
    const names = registry.getStats().handlerNames;
    for (const handler of ["OpenAPIHandler", "OpenAPIDocsHandler", "AgentStreamHandler"]) {
      assertEquals(names.includes(handler), true, `Missing API handler: ${handler}`);
    }
  });

  it("contains all content handler group", () => {
    const { registry } = createHandlerRegistry(projectDir, adapter);
    const names = registry.getStats().handlerNames;
    for (const handler of ["SSRHandler", "StaticHandler", "ModuleHandler", "RSCHandler"]) {
      assertEquals(names.includes(handler), true, `Missing content handler: ${handler}`);
    }
  });

  it("contains all dev handler group", () => {
    const { registry } = createHandlerRegistry(projectDir, adapter);
    const names = registry.getStats().handlerNames;
    for (const handler of ["HMRHandler", "DevEndpointsHandler", "DevDashboardHandler"]) {
      assertEquals(names.includes(handler), true, `Missing dev handler: ${handler}`);
    }
  });

  it("apiHandler has handle method", () => {
    const { apiHandler } = createHandlerRegistry(projectDir, adapter);
    assertEquals(typeof apiHandler.handle, "function");
  });

  it("override does not affect a separately created registry", () => {
    const mockHealth = createMockHandler("HealthHandler", HandlerPriority.HIGH, "/__/health");
    const { registry: r1 } = createHandlerRegistry(projectDir, adapter, {
      overrides: { HealthHandler: mockHealth },
    });
    const { registry: r2 } = createHandlerRegistry(projectDir, adapter);

    const r1Health = r1.getHandlers().find((h) => h.metadata.name === "HealthHandler");
    const r2Health = r2.getHandlers().find((h) => h.metadata.name === "HealthHandler");

    assertEquals(r1Health, mockHealth as Handler);
    assertEquals(r2Health !== mockHealth, true);
  });

  it("preserves handler count across multiple factory calls (no shared state)", () => {
    const { registry: r1 } = createHandlerRegistry(projectDir, adapter);
    const { registry: r2 } = createHandlerRegistry(projectDir, adapter);

    assertEquals(r1.getStats().totalHandlers, r2.getStats().totalHandlers);

    // They should be independent instances
    assertEquals(r1 !== r2, true);
  });
});
