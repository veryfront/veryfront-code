import "#veryfront/schemas/_test-setup.ts";
import { validateVeryfrontConfig } from "#veryfront/config/schemas/config.schema.ts";
import { createMCPServer, type IntegrationLoaderConfig } from "#veryfront/mcp/server.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import type { IntegrationScope } from "./types.ts";

const originalFetch = globalThis.fetch;

function requireCanonicalScope(scope: IntegrationScope): "user" | "project" {
  return scope;
}

describe("integration scope compatibility", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("exposes only canonical user and project scopes", () => {
    const scopes: IntegrationScope[] = ["user", "project"];

    assertEquals(scopes.map(requireCanonicalScope), ["user", "project"]);
  });

  it("accepts legacy endUser config and normalizes it to user", () => {
    const config = validateVeryfrontConfig({
      integrations: {
        slack: { scope: "endUser", tools: ["search"] },
      },
    });

    assertEquals(config.integrations, {
      slack: { scope: "user", tools: ["search"] },
    });
    assertEquals(JSON.stringify(config.integrations).includes("endUser"), false);
  });

  it("accepts canonical user config without rewriting it", () => {
    const config = validateVeryfrontConfig({
      integrations: {
        slack: { scope: "user", tools: ["search"] },
      },
    });

    assertEquals(config.integrations, {
      slack: { scope: "user", tools: ["search"] },
    });
  });

  it("emits only canonical scopes during MCP config sync", async () => {
    let requestBody: unknown;
    globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requestBody = await request.json();
      return Response.json({ synced: 4 });
    };

    const server = createMCPServer({
      enabled: true,
      auth: { type: "none", allowUnauthenticated: true },
    });
    server.setIntegrationLoader({
      integrations: {
        legacy: { scope: "endUser" },
        canonical: { scope: "user" },
        shared: { scope: "project" },
        deprecatedPerUser: { perUser: true },
      } as unknown as IntegrationLoaderConfig["integrations"],
      apiBaseUrl: "https://api.example.com",
      apiToken: "test-token",
    });

    await server.handleRequest({ jsonrpc: "2.0", id: 1, method: "tools/list" });

    assertEquals(requestBody, {
      integrations: {
        legacy: { scope: "user" },
        canonical: { scope: "user" },
        shared: { scope: "project" },
        deprecatedPerUser: { scope: "user" },
      },
    });
    assertEquals(JSON.stringify(requestBody).includes("endUser"), false);
  });
});
