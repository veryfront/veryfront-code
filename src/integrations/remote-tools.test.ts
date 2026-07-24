import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals } from "#veryfront/testing/assert.ts";
import { afterEach, describe, it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { refreshEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { runWithRequestContext } from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  executeRemoteIntegrationTool,
  getRemoteIntegrationToolDefinitions,
  isRemoteIntegrationTool,
} from "./remote-tools.ts";

const ENV_KEYS = [
  "PROXY_MODE",
  "VERYFRONT_API_BASE_URL",
  "VERYFRONT_API_TOKEN",
  "VERYFRONT_PROJECT_SLUG",
] as const;

const originalEnv = new Map(ENV_KEYS.map((key) => [key, getEnv(key)]));

function restoreRemoteToolEnv(): void {
  for (const key of ENV_KEYS) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      deleteEnv(key);
      continue;
    }
    setEnv(key, value);
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
  it("does not keep a legacy string end-user overload for remote tool execution", async () => {
    const source = await Deno.readTextFile(new URL("./remote-tools.ts", import.meta.url));

    assertEquals(source.includes("contextOrEndUserId"), false);
    assertEquals(source.includes('typeof contextOrEndUserId === "string"'), false);
  });

  it("does not keep legacy OAuth caller identity URL sanitizers in live remote tools", async () => {
    const source = await Deno.readTextFile(new URL("./remote-tools.ts", import.meta.url));
    const legacyCallerIdentityParam = ["end", "User", "Id"].join("");

    assertEquals(source.includes(legacyCallerIdentityParam), false);
  });

  it("skips remote tool discovery when API configuration is missing", async () => {
    setRemoteToolEnv({});

    const definitions = await withMockFetch(async () => {
      throw new Error("fetch should not run without remote API configuration");
    }, async () => await getRemoteIntegrationToolDefinitions());

    assertEquals(definitions, []);
  });

  it("prefers the request-scoped token and normalizes empty input schemas", async () => {
    setRemoteToolEnv({
      PROXY_MODE: "1",
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
      VERYFRONT_PROJECT_SLUG: "environment-project",
    });

    let authorizationHeader: string | null = null;
    let projectSlugHeader: string | null = null;

    const definitions = await runWithRequestContext(
      {
        projectSlug: "request-project",
        token: "request-token",
        productionMode: false,
      },
      async () =>
        await withMockFetch(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            authorizationHeader = request.headers.get("Authorization");
            projectSlugHeader = request.headers.get("x-veryfront-project-slug");

            return Response.json({
              tools: [
                {
                  name: "github__list_repos",
                  description: "List repos",
                  inputSchema: {},
                },
                {
                  name: "github__get_repo",
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
        ),
    );

    assertEquals(authorizationHeader, "Bearer request-token");
    assertEquals(projectSlugHeader, "request-project");
    assertEquals(definitions, [
      {
        name: "github__list_repos",
        description: "List repos",
        parameters: { type: "object", properties: {} },
      },
      {
        name: "github__get_repo",
        description: "Get repo",
        parameters: {
          type: "object",
          properties: { owner: { type: "string" } },
        },
      },
    ]);
  });

  it("filters remote tool discovery through the active source integration policy", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const policy = normalizeSourceIntegrationPolicy({
      allow: { github: { allowedTools: ["list_repos"] } },
    });
    const definitions = await runWithExactSourceIntegrationPolicy(
      policy,
      () =>
        withMockFetch(
          async () =>
            Response.json({
              tools: [
                {
                  name: "github__list_repos",
                  description: "List repos",
                  inputSchema: {},
                },
                {
                  name: "github__delete_repo",
                  description: "Delete repo",
                  inputSchema: {},
                },
                {
                  name: "confluence__get_page",
                  description: "Get page",
                  inputSchema: {},
                },
              ],
            }),
          () => getRemoteIntegrationToolDefinitions(),
        ),
    );

    assertEquals(definitions.map((definition) => definition.name), [
      "github__list_repos",
    ]);
  });

  it("rejects source-disallowed remote execution before dispatch", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const policy = normalizeSourceIntegrationPolicy({
      allow: { github: { allowedTools: ["list_repos"] } },
    });
    let dispatchCalls = 0;

    await assertRejects(
      () =>
        runWithExactSourceIntegrationPolicy(
          policy,
          () =>
            withMockFetch(
              async () => {
                dispatchCalls++;
                return Response.json({ structuredContent: { deleted: true } });
              },
              () => executeRemoteIntegrationTool("github__delete_repo", {}),
            ),
        ),
      Error,
      'Tool "github__delete_repo" is not allowed by the source integration policy',
    );
    assertEquals(dispatchCalls, 0);
  });

  it("rejects non-canonical remote tool names before dispatch", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });
    let dispatchCalls = 0;

    await assertRejects(
      () =>
        withMockFetch(
          async () => {
            dispatchCalls++;
            return Response.json({ structuredContent: {} });
          },
          () => executeRemoteIntegrationTool("github:list-repos", {}),
        ),
      Error,
      'Remote integration tool "github:list-repos" must use the canonical integration__tool_id name',
    );
    assertEquals(dispatchCalls, 0);
  });

  it("uses the environment token only in single-project mode", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let authorizationHeader: string | null = null;
    const definitions = await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        authorizationHeader = request.headers.get("Authorization");
        return Response.json({ tools: [] });
      },
      async () => await getRemoteIntegrationToolDefinitions(),
    );

    assertEquals(authorizationHeader, "Bearer env-token");
    assertEquals(definitions, []);
  });

  it("uses the environment project slug when no request context is active", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
      VERYFRONT_PROJECT_SLUG: "environment-project",
    });

    let projectSlugHeader: string | null = null;
    const definitions = await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        projectSlugHeader = request.headers.get("x-veryfront-project-slug");
        return Response.json({ tools: [] });
      },
      async () => await getRemoteIntegrationToolDefinitions(),
    );

    assertEquals(projectSlugHeader, "environment-project");
    assertEquals(definitions, []);
  });

  it("does not fall back to the environment project slug when request context has an empty slug", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
      VERYFRONT_PROJECT_SLUG: "environment-project",
    });

    let projectSlugHeader: string | null = "unexpected";
    const definitions = await runWithRequestContext(
      { projectSlug: "   ", token: "request-token" },
      async () =>
        await withMockFetch(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            projectSlugHeader = request.headers.get("x-veryfront-project-slug");
            return Response.json({ tools: [] });
          },
          async () => await getRemoteIntegrationToolDefinitions(),
        ),
    );

    assertEquals(projectSlugHeader, null);
    assertEquals(definitions, []);
  });

  it("omits the project slug header when no project context is configured", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let projectSlugHeader: string | null = "unexpected";
    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        projectSlugHeader = request.headers.get("x-veryfront-project-slug");
        return Response.json({ tools: [] });
      },
      async () => await getRemoteIntegrationToolDefinitions(),
    );

    assertEquals(projectSlugHeader, null);
  });

  it("fails closed when the API lists a legacy integration tool alias", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const definitions = await withMockFetch(async () =>
      Response.json({
        tools: [{
          name: "github:list-repos",
          description: "Legacy alias",
          inputSchema: { type: "object", properties: {} },
        }],
      }), async () => await getRemoteIntegrationToolDefinitions());

    assertEquals(definitions, []);
  });

  it("fails closed in proxy mode without a request context", async () => {
    setRemoteToolEnv({
      PROXY_MODE: "1",
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let fetchCalls = 0;
    const definitions = await withMockFetch(async () => {
      fetchCalls++;
      return Response.json({ tools: [] });
    }, async () => await getRemoteIntegrationToolDefinitions());

    assertEquals(fetchCalls, 0);
    assertEquals(definitions, []);
  });

  for (const invalidToken of ["", "   ", 42] as const) {
    it(`fails closed in proxy mode for invalid request token ${JSON.stringify(invalidToken)}`, async () => {
      setRemoteToolEnv({
        PROXY_MODE: "1",
        VERYFRONT_API_BASE_URL: "https://api.test",
        VERYFRONT_API_TOKEN: "env-token",
      });

      let fetchCalls = 0;
      const outcome = await runWithRequestContext(
        {
          projectSlug: "request-project",
          token: invalidToken as unknown as string,
          productionMode: false,
        },
        async () =>
          await withMockFetch(async () => {
            fetchCalls++;
            return Response.json({ tools: [] });
          }, async () => ({
            definitions: await getRemoteIntegrationToolDefinitions(),
            execution: await executeRemoteIntegrationTool("github__list_repos", {}),
          })),
      );

      assertEquals(fetchCalls, 0);
      assertEquals(outcome, {
        definitions: [],
        execution: { error: "no_api_token", message: "No API token available" },
      });
    });
  }

  it("rejects an invalid environment token in single-project mode", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "   ",
    });

    let fetchCalls = 0;
    const definitions = await withMockFetch(async () => {
      fetchCalls++;
      return Response.json({ tools: [] });
    }, async () => await getRemoteIntegrationToolDefinitions());

    assertEquals(fetchCalls, 0);
    assertEquals(definitions, []);
  });

  it("does not downgrade an invalid request credential to the environment token", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let fetchCalls = 0;
    const definitions = await runWithRequestContext(
      { projectSlug: "request-project", token: "   " },
      async () =>
        await withMockFetch(async () => {
          fetchCalls++;
          return Response.json({ tools: [] });
        }, async () => await getRemoteIntegrationToolDefinitions()),
    );

    assertEquals(fetchCalls, 0);
    assertEquals(definitions, []);
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
          "github__list_repos",
          { visibility: "private" },
        ),
    );

    assertEquals(requestBody, {
      name: "github__list_repos",
      arguments: { visibility: "private" },
    });
    assertEquals(result, {
      error: "authentication_required",
      connectUrl: "/api/auth/github",
    });
  });

  it("forwards the request project slug when executing a remote integration tool", async () => {
    setRemoteToolEnv({
      PROXY_MODE: "1",
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
      VERYFRONT_PROJECT_SLUG: "environment-project",
    });

    let projectSlugHeader: string | null = null;
    const result = await runWithRequestContext(
      {
        projectSlug: "request-project",
        token: "request-token",
        productionMode: false,
      },
      async () =>
        await withMockFetch(
          async (input: string | URL | Request, init?: RequestInit) => {
            const request = input instanceof Request ? input : new Request(input, init);
            projectSlugHeader = request.headers.get("x-veryfront-project-slug");
            return Response.json({ content: [], structuredContent: { ok: true } });
          },
          async () => await executeRemoteIntegrationTool("github__list_repos", {}),
        ),
    );

    assertEquals(projectSlugHeader, "request-project");
    assertEquals(result, { ok: true });
  });

  it("forwards run and agent context without caller-supplied end-user identity", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    let requestBody: Record<string, unknown> | undefined;

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        requestBody = await request.json();

        return Response.json({ structuredContent: { ok: true } });
      },
      async () =>
        await executeRemoteIntegrationTool(
          "gmail__list_emails",
          { maxResults: 10 },
          { runId: "run-123", agentId: "agent-123" },
        ),
    );

    assertEquals(requestBody, {
      name: "gmail__list_emails",
      arguments: { maxResults: 10 },
      run_id: "run-123",
      agent_id: "agent-123",
    });
  });

  it("prefers structuredContent for MCP error results without text content", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const result = await withMockFetch(async () =>
      Response.json({
        isError: true,
        content: [],
        structuredContent: {
          error: "authentication_required",
          integration: "linear",
          connectUrl: "/oauth/connect/linear?projectId=project-1",
          message: "Authentication required for Linear.",
        },
      }), async () => await executeRemoteIntegrationTool("linear__search_issues", { query: "*" }));

    assertEquals(result, {
      error: "authentication_required",
      integration: "linear",
      connectUrl: "/oauth/connect/linear?projectId=project-1",
      message: "Authentication required for Linear.",
    });
  });

  it("preserves protocol-relative auth URL authority from structured tool results", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const result = await withMockFetch(async () =>
      Response.json({
        content: [],
        structuredContent: {
          error: "authentication_required",
          connectUrl: "//auth.example.com/oauth/connect/github?projectId=project-1",
        },
      }), async () => await executeRemoteIntegrationTool("github__list_repos", {}));

    assertEquals(result, {
      error: "authentication_required",
      connectUrl: "//auth.example.com/oauth/connect/github?projectId=project-1",
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
    assertStrictEquals(isRemoteIntegrationTool("github:list-repos"), false);
    assertStrictEquals(isRemoteIntegrationTool("list_repos"), false);
    assertStrictEquals(isRemoteIntegrationTool("__start"), false);
    assertStrictEquals(isRemoteIntegrationTool("end__"), false);
    assertStrictEquals(isRemoteIntegrationTool("middle__middle__name"), false);
  });

  it("omits undefined call tool text entries when joining text content", async () => {
    setRemoteToolEnv({
      VERYFRONT_API_BASE_URL: "https://api.test",
      VERYFRONT_API_TOKEN: "env-token",
    });

    const result = await withMockFetch(async () =>
      Response.json({
        content: [{ text: undefined }, { text: "plain result" }],
      }), async () => await executeRemoteIntegrationTool("github__list_repos", {}));

    assertEquals(result, "plain result");
  });
});
