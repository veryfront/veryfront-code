import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { PublicAgentMetadataHandler } from "./public-agent-metadata.handler.ts";
import { createAgentWithConfig, createCtx } from "./internal-agent-run.test-helpers.ts";

describe("server/handlers/request/public-agent-metadata.handler", () => {
  it("returns browser-safe source-defined agent metadata", async () => {
    let discoveryCalls = 0;
    const handler = new PublicAgentMetadataHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
      },
      getAgent: (id) =>
        id === "support-agent"
          ? createAgentWithConfig("support-agent", {
            name: "Support Agent",
            description: "Customer operations assistant",
            avatarUrl: "https://cdn.example.com/support.svg",
            suggestions: {
              welcomeMessage: "What should we triage?",
              suggestions: [
                {
                  type: "prompt",
                  title: "Triage login issue",
                  prompt: "Triage a customer who cannot sign in.",
                },
              ],
            },
          })
          : undefined,
      getAllAgentIds: () => ["support-agent"],
    });

    const result = await handler.handle(
      new Request("https://example.com/api/agents/support-agent", { method: "GET" }),
      createCtx(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 200);
    assertEquals(discoveryCalls, 1);
    assertEquals(await result.response.json(), {
      agent: {
        id: "support-agent",
        name: "Support Agent",
        description: "Customer operations assistant",
        avatar_url: "https://cdn.example.com/support.svg",
        suggestions: {
          welcomeMessage: "What should we triage?",
          suggestions: [
            {
              type: "prompt",
              title: "Triage login issue",
              prompt: "Triage a customer who cannot sign in.",
            },
          ],
        },
      },
    });
  });

  it("returns 404 when the source-defined agent does not exist", async () => {
    const handler = new PublicAgentMetadataHandler({
      ensureProjectDiscovery: async () => {},
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const result = await handler.handle(
      new Request("https://example.com/api/agents/missing", { method: "GET" }),
      createCtx(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 404);
    assertEquals(await result.response.json(), { error: "Agent not found" });
  });

  it("returns 400 when the agent id cannot be decoded", async () => {
    const handler = new PublicAgentMetadataHandler({
      ensureProjectDiscovery: async () => {
        throw new Error("should not discover");
      },
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const result = await handler.handle(
      new Request("https://example.com/api/agents/%", { method: "GET" }),
      createCtx(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 400);
    assertEquals(await result.response.json(), { error: "Invalid agent id" });
  });

  it("returns 400 for an oversized agent identifier before discovery", async () => {
    let discoveryCalls = 0;
    const handler = new PublicAgentMetadataHandler({
      ensureProjectDiscovery: async () => {
        discoveryCalls += 1;
      },
      getAgent: () => undefined,
      getAllAgentIds: () => [],
    });

    const result = await handler.handle(
      new Request(`https://example.com/api/agents/${"x".repeat(257)}`, { method: "GET" }),
      createCtx(),
    );

    assertExists(result.response);
    assertEquals(result.response.status, 400);
    assertEquals(discoveryCalls, 0);
  });

  it("ignores non-GET requests", async () => {
    const handler = new PublicAgentMetadataHandler();

    const result = await handler.handle(
      new Request("https://example.com/api/agents/support-agent", { method: "POST" }),
      createCtx(),
    );

    assertEquals(result.continue, true);
  });
});
