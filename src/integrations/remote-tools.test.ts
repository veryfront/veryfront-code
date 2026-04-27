import { assertEquals, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { refreshEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  executeRemoteIntegrationTool,
  getRemoteIntegrationToolDefinitions,
  isRemoteIntegrationTool,
  syncIntegrationConfig,
} from "./remote-tools.ts";

const ENV_KEYS = [
  "VERYFRONT_API_BASE_URL",
  "VERYFRONT_API_TOKEN",
] as const;

const originalEnv = new Map(ENV_KEYS.map((key) => [key, getEnv(key)]));
const originalMultiProjectAdapter =
  (globalThis as Record<string, unknown>).__vf_multi_project_adapter;

function restoreRemoteToolEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      deleteEnv(key);
      continue;
    }
    setEnv(key, value);
  }

  if (originalMultiProjectAdapter === undefined) {
    delete (globalThis as Record<string, unknown>).__vf_multi_project_adapter;
  } else {
    (globalThis as Record<string, unknown>).__vf_multi_project_adapter =
      originalMultiProjectAdapter;
  }

  refreshEnvironmentConfig();
}

function setRemoteToolEnv(overrides: Record<string, string>): void {
  for (const key of ENV_KEYS) {
    deleteEnv(key);
  }

  for (const [key, value] of Object.entries(overrides)) {
    setEnv(key, value);
  }

  refreshEnvironmentConfig();
}

afterEach(() => {
  restoreRemoteToolEnv();
});

describe("integrations/remote-tools", () => {
  it("skips remote tool discovery when API configuration is missing", async () => {
    setRemoteToolEnv({});

    const definitions = await withMockFetch(async () => {
      throw new Error("fetch should not run without remote API configuration");
    }, async () => await getRemoteIntegrationToolDefinitions());

    assertEquals(definitions, []);
  });

  it("prefers the request-scoped token and normalizes empty input schemas", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });
    (globalThis as Record<string, unknown>).__vf_multi_project_adapter = {
      getCurrentRequestContext: () => ({ token: "request-token" }),
    };

    let authorizationHeader: string | null = null;

    const definitions = await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        authorizationHeader = request.headers.get("Authorization");

        return Response.json({
          tools: [
            {
              name: "github:list-repos",
              description: "List repos",
              inputSchema: {},
            },
            {
              name: "github:get-repo",
              description: "Get repo",
              inputSchema: {
                type: "object",
                properties: { owner: { type: "string" } },
              },
            },
          ],
        });
      },
      async () => await getRemoteIntegrationToolDefinitions(),
    );

    assertEquals(authorizationHeader, "Bearer request-token");
    assertEquals(definitions, [
      {
        name: "github:list-repos",
        description: "List repos",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "github:get-repo",
        description: "Get repo",
        parameters: {
          type: "object",
          properties: { owner: { type: "string" } },
        },
      },
    ]);
  });

  it("returns structured MCP errors without flattening JSON payloads", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let requestBody: Record<string, unknown> | undefined;

    const result = await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requestBody = await request.json();

        return Response.json({
          isError: true,
          content: [{
            text: JSON.stringify({
              error: "authentication_required",
              connectUrl: "/api/auth/github",
            }),
          }],
        });
      },
      async () =>
        await executeRemoteIntegrationTool(
          "github:list-repos",
          { visibility: "private" },
          "end-user-123",
        ),
    );

    assertEquals(requestBody, {
      name: "github:list-repos",
      arguments: { visibility: "private" },
      end_user_id: "end-user-123",
    });
    assertEquals(result, {
      error: "authentication_required",
      connectUrl: "/api/auth/github",
    });
  });

  it("returns structured content from remote tool calls and detects remote names", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const result = await withMockFetch(async () =>
      Response.json({
        content: [{ text: '{"ignored":true}' }],
        structuredContent: { repos: ["veryfront"] },
      }), async () => await executeRemoteIntegrationTool("github__list_repos", {}));

    assertEquals(result, { repos: ["veryfront"] });
    assertStrictEquals(isRemoteIntegrationTool("github__list_repos"), true);
    assertStrictEquals(isRemoteIntegrationTool("list_repos"), false);
  });

  it("posts integration config as a full replace payload", async () => {
    let requestBody: Record<string, unknown> | undefined;

    await withMockFetch(async (input: string | URL | Request, init?: RequestInit) => {
      const request = input instanceof Request ? input : new Request(input, init);
      requestBody = await request.json();

      return Response.json({ synced: 2 });
    }, async () =>
      await syncIntegrationConfig(
        "https://api.test",
        "sync-token",
        {
          github: { scope: "project", tools: ["list-repos"] },
          slack: { scope: "endUser" },
        },
      ));

    assertEquals(requestBody, {
      integrations: {
        github: { scope: "project", tools: ["list-repos"] },
        slack: { scope: "endUser" },
      },
    });
  });
});
