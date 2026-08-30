import "#veryfront/schemas/_test-setup.ts";
import { createEmptyDiscoveryResult } from "#veryfront/discovery";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { PublicAgentsListHandler } from "./public-agents-list.handler.ts";
import { ensureProjectDiscovery } from "./api/project-discovery.ts";
import type { HandlerContext } from "../types.ts";
import { createAgentWithConfig, createCtx } from "./internal-agent-run.test-helpers.ts";

/**
 * A shared multi-project runtime context without a host execution grant.
 * Mirrors the proxy topology that produced Sentry VERYFRONT-SERVER-Z: the
 * runtime is shared, so remote executable discovery must not run in-process.
 */
function createSharedRuntimeCtx(overrides: Record<string, unknown> = {}): HandlerContext {
  const fs = {
    isMultiProjectMode: () => true,
    isContextualMode: () => false,
    runWithContext: async (
      _slug: string,
      _token: string,
      fn: () => Promise<unknown>,
    ) => await fn(),
  };
  return {
    projectDir: "/project",
    projectSlug: "demo-project",
    projectId: "proj-1",
    proxyToken: "token",
    isLocalProject: false,
    securityConfig: null,
    adapter: { env: { get: () => undefined }, fs },
    ...overrides,
  } as unknown as HandlerContext;
}

describe("server/handlers/request/public-agents-list.handler", () => {
  it("returns every browser-safe agent, sorted by name", async () => {
    let discoveryCalls = 0;
    const handler = new PublicAgentsListHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
        return createEmptyDiscoveryResult();
      },
      getAgent: (id) =>
        createAgentWithConfig(id, {
          name: id === "support-agent" ? "Support Agent" : "Sales Agent",
          description: id === "support-agent" ? "Customer operations assistant" : null,
        }),
      // Deliberately unsorted to prove the handler orders by name.
      getAllAgentIds: () => ["support-agent", "sales-agent"],
    });

    const result = await handler.handle(
      new Request("https://example.com/api/agents", { method: "GET" }),
      createCtx(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(discoveryCalls, 1);
    assertEquals(await result.response.json(), {
      agents: [
        { id: "sales-agent", name: "Sales Agent", description: null },
        {
          id: "support-agent",
          name: "Support Agent",
          description: "Customer operations assistant",
        },
      ],
    });
  });

  it("skips ids that no longer resolve to an agent", async () => {
    const handler = new PublicAgentsListHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: (id) =>
        id === "support-agent"
          ? createAgentWithConfig(id, { name: "Support Agent", description: null })
          : undefined,
      getAllAgentIds: () => ["support-agent", "ghost-agent"],
    });

    const result = await handler.handle(
      new Request("https://example.com/api/agents", { method: "GET" }),
      createCtx(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), {
      agents: [{ id: "support-agent", name: "Support Agent", description: null }],
    });
  });

  it("returns an empty list when the project exposes no agents", async () => {
    const handler = new PublicAgentsListHandler({
      ensureProjectDiscovery: async () => createEmptyDiscoveryResult(),
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const result = await handler.handle(
      new Request("https://example.com/api/agents", { method: "GET" }),
      createCtx(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(await result.response.json(), { agents: [] });
  });

  it("ignores non-GET requests", async () => {
    const handler = new PublicAgentsListHandler();

    const result = await handler.handle(
      new Request("https://example.com/api/agents", { method: "POST" }),
      createCtx(),
    );

    assertEquals(result.continue, true);
  });

  describe("shared runtime without a host execution grant", () => {
    it("fails closed with project-execution-unavailable instead of leaking the discovery error", async () => {
      // Regression for Sentry VERYFRONT-SERVER-Z (issue-inbox#854): in a
      // shared proxy runtime the real discovery guard throws
      // "Remote executable discovery requires an isolated project runtime and
      // cannot run in the shared host", and this handler let that raw 500
      // escape. Sibling surfaces (SSR, snippet, app-router) answer the same
      // topology with a structured 503 problem response.
      const handler = new PublicAgentsListHandler({
        ensureProjectDiscovery,
        getAgent: () => undefined,
        getAllAgentIds: () => [],
      });

      const result = await handler.handle(
        new Request("https://example.com/api/agents", { method: "GET" }),
        createSharedRuntimeCtx(),
      );

      assertExists(
        result.response,
        "an ungranted shared runtime must receive a structured response, not a thrown discovery error",
      );
      assertEquals(
        result.response.status,
        503,
        "the shared-runtime denial must surface as project-execution-unavailable",
      );
      assertEquals(
        result.response.headers.get("content-type"),
        "application/problem+json",
        "the denial must be an RFC 9457 problem response",
      );
      assertEquals(
        (await result.response.json() as { type?: string }).type,
        "https://veryfront.com/docs/code/guides/errors#project-execution-unavailable",
        "the problem type must identify the dedicated-runtime requirement",
      );
    });

    it("serves a shared runtime the host granted execution", async () => {
      // The granted counterpart. Without it, a handler that denies every
      // shared runtime passes the fail-closed test above.
      let discoveryCalls = 0;
      const handler = new PublicAgentsListHandler({
        ensureProjectDiscovery: async () => {
          discoveryCalls += 1;
          return createEmptyDiscoveryResult();
        },
        getAgent: () => undefined,
        getAllAgentIds: () => [],
      });

      const result = await handler.handle(
        new Request("https://example.com/api/agents", { method: "GET" }),
        createSharedRuntimeCtx({ allowHostProjectCodeExecution: true }),
      );

      assertExists(result.response);
      assertEquals(
        result.response.status,
        200,
        "a granted shared executor must not return project-execution-unavailable",
      );
      assertEquals(discoveryCalls, 1, "the granted path must reach discovery");
    });
  });
});
