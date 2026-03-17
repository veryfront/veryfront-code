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
import { createHandlerRegistry } from "./index.ts";

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

    // Should have all 31 handlers registered
    assertEquals(stats.totalHandlers, 32);

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

  it("preserves handler count across multiple factory calls (no shared state)", () => {
    const { registry: r1 } = createHandlerRegistry(projectDir, adapter);
    const { registry: r2 } = createHandlerRegistry(projectDir, adapter);

    assertEquals(r1.getStats().totalHandlers, r2.getStats().totalHandlers);

    // They should be independent instances
    assertEquals(r1 !== r2, true);
  });
});
