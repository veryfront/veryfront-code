import { assertEquals, assertExists } from "@std/assert";
import { createIntegrationTools } from "./tool-factory.ts";
import type { IntegrationConnector } from "./types.ts";

const mockConnector: IntegrationConnector = {
  name: "github",
  display_name: "GitHub",
  description: "GitHub integration",
  auth: { type: "oauth2", provider: "github" },
  tools: [
    {
      id: "list-repos",
      name: "List Repositories",
      description: "List user repositories",
      requires_write: false,
      endpoint: {
        method: "GET",
        url: "https://api.github.com/user/repos",
        params: {
          per_page: { type: "number", in: "query", description: "Results per page" },
          sort: { type: "string", in: "query", description: "Sort field" },
        },
      },
    },
    {
      id: "create-issue",
      name: "Create Issue",
      description: "Create a new issue",
      requires_write: true,
      endpoint: {
        method: "POST",
        url: "https://api.github.com/repos/{owner}/{repo}/issues",
        params: {
          owner: { type: "string", in: "path", description: "Owner", required: true },
          repo: { type: "string", in: "path", description: "Repo", required: true },
        },
        body: {
          title: { type: "string", description: "Issue title", required: true },
          body: { type: "string", description: "Issue body" },
        },
      },
    },
    {
      id: "no-endpoint",
      name: "Prompt Only",
      description: "Tool without endpoint (prompt only)",
      requires_write: false,
    },
  ],
};

Deno.test("tool-factory", async (t) => {
  await t.step("creates tools for endpoints only", () => {
    const tools = createIntegrationTools(
      mockConnector,
      {},
      "https://api.example.com",
    );

    // "no-endpoint" should be skipped
    assertEquals(tools.length, 2);
  });

  await t.step("tool IDs use integration:tool format", () => {
    const tools = createIntegrationTools(
      mockConnector,
      {},
      "https://api.example.com",
    );

    assertEquals(tools.at(0)?.id, "github:list-repos");
    assertEquals(tools.at(1)?.id, "github:create-issue");
  });

  await t.step("tools have descriptions", () => {
    const tools = createIntegrationTools(
      mockConnector,
      {},
      "https://api.example.com",
    );

    assertEquals(tools.at(0)?.description, "List user repositories");
    assertEquals(tools.at(1)?.description, "Create a new issue");
  });

  await t.step("tools have MCP enabled", () => {
    const tools = createIntegrationTools(
      mockConnector,
      {},
      "https://api.example.com",
    );

    assertEquals(tools.at(0)?.mcp?.enabled, true);
    assertEquals(tools.at(1)?.mcp?.enabled, true);
  });

  await t.step("tools have input schemas with correct params", () => {
    const tools = createIntegrationTools(
      mockConnector,
      {},
      "https://api.example.com",
    );

    const tool0 = tools.at(0)!;
    const tool1 = tools.at(1)!;

    // list-repos should have per_page and sort in schema
    assertExists(tool0.inputSchemaJson);
    assertExists(tool0.inputSchemaJson.properties?.per_page);
    assertExists(tool0.inputSchemaJson.properties?.sort);

    // create-issue should have owner, repo, title, body
    assertExists(tool1.inputSchemaJson);
    assertExists(tool1.inputSchemaJson.properties?.owner);
    assertExists(tool1.inputSchemaJson.properties?.repo);
    assertExists(tool1.inputSchemaJson.properties?.title);
    assertExists(tool1.inputSchemaJson.properties?.body);
  });

  await t.step("header params are excluded from input schema", () => {
    const connectorWithHeader: IntegrationConnector = {
      ...mockConnector,
      tools: [
        {
          id: "test",
          name: "Test",
          description: "Test",
          requires_write: false,
          endpoint: {
            method: "GET",
            url: "https://api.example.com/test",
            params: {
              visible: { type: "string", in: "query", description: "Visible" },
              "X-Api-Version": { type: "string", in: "header", description: "API version" },
            },
          },
        },
      ],
    };

    const tools = createIntegrationTools(connectorWithHeader, {}, "https://api.example.com");
    const schema = tools.at(0)!.inputSchemaJson!;

    assertExists(schema.properties?.visible);
    assertEquals(schema.properties?.["X-Api-Version"], undefined);
  });

  await t.step("execute returns auth error when no token", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(
        JSON.stringify({
          error: "authentication_required",
          connectUrl: "https://auth.example.com",
        }),
      );
    };

    try {
      const tools = createIntegrationTools(mockConnector, {}, "https://api.example.com");
      const result = await tools.at(0)!.execute(
        { per_page: 10 },
        { projectId: "test-project-id" },
      );

      assertEquals((result as Record<string, unknown>).error, "authentication_required");
      assertExists((result as Record<string, unknown>).connectUrl);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  await t.step("execute returns error when no projectId in context", async () => {
    const tools = createIntegrationTools(mockConnector, {}, "https://api.example.com");
    const result = await tools.at(0)!.execute({}, {});

    assertEquals((result as Record<string, unknown>).error, "missing_project_id");
  });

  await t.step("tools allowlist filters to specified tool IDs", () => {
    const tools = createIntegrationTools(
      mockConnector,
      { tools: ["create-issue"] },
      "https://api.example.com",
    );

    assertEquals(tools.length, 1);
    assertEquals(tools.at(0)?.id, "github:create-issue");
  });

  await t.step("empty allowlist results in zero tools", () => {
    const tools = createIntegrationTools(
      mockConnector,
      { tools: [] },
      "https://api.example.com",
    );

    assertEquals(tools.length, 0);
  });

  await t.step("no allowlist exposes all tools with endpoints", () => {
    const tools = createIntegrationTools(
      mockConnector,
      {},
      "https://api.example.com",
    );

    // 2 tools with endpoints, 1 without (skipped)
    assertEquals(tools.length, 2);
  });
});
