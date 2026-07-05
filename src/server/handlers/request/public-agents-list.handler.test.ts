import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { PublicAgentsListHandler } from "./public-agents-list.handler.ts";
import { createAgentWithConfig, createCtx } from "./internal-agent-run.test-helpers.ts";

describe("server/handlers/request/public-agents-list.handler", () => {
  it("returns every browser-safe agent, sorted by name", async () => {
    let discoveryCalls = 0;
    const handler = new PublicAgentsListHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
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
      ensureProjectDiscovery: async () => {},
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
      ensureProjectDiscovery: async () => {},
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
});
