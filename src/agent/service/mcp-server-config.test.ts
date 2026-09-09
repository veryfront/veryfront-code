import "#veryfront/schemas/_test-setup.ts";
import { createRemoteMCPToolSource } from "#veryfront/tool";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { wrapRemoteToolSourceWithMcpPolicy } from "../mcp-tool-policy.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  createAgentServiceRemoteMcpConfig,
  createProjectScopedMcpUrl,
  defaultAgentServiceMcpServers,
} from "./mcp-server-config.ts";

it("defaultAgentServiceMcpServers enables first-party MCP servers", () => {
  assertEquals(defaultAgentServiceMcpServers(), [{ kind: "veryfront-api" }]);
});

it("createAgentServiceRemoteMcpConfig builds Veryfront API MCP config", async () => {
  let projectId = "project-1";
  const config = createAgentServiceRemoteMcpConfig({
    server: { kind: "veryfront-api" },
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    getProjectId: () => projectId,
  });
  assertEquals(config?.id, "veryfront-mcp");
  assertEquals(
    typeof config?.endpoint === "function" ? await config.endpoint() : config?.endpoint,
    "https://api.example/projects/project-1/mcp",
  );
  projectId = "project-2";
  assertEquals(
    typeof config?.endpoint === "function" ? await config.endpoint() : config?.endpoint,
    "https://api.example/projects/project-2/mcp",
  );
  assertEquals(
    typeof config?.headers === "function" ? await config.headers() : config?.headers,
    {
      Authorization: "Bearer token-1",
    },
  );
  assertEquals(
    typeof config?.headers === "function"
      ? await config.headers({ authToken: "run-token-1" })
      : config?.headers,
    {
      Authorization: "Bearer token-1",
    },
  );

  assertEquals(
    createAgentServiceRemoteMcpConfig({
      server: { kind: "veryfront-api", id: "veryfront-child" },
      authToken: "token-1",
      apiMcpUrl: "https://api.example/mcp",
      defaultSourceId: "veryfront-mcp-fork",
    })?.id,
    "veryfront-child",
  );
});

describe("createProjectScopedMcpUrl", () => {
  it("normalizes and replaces the project segment", () => {
    assertEquals(
      createProjectScopedMcpUrl("https://api.example", " project/1 "),
      "https://api.example/projects/project%2F1/mcp",
    );
    assertEquals(
      createProjectScopedMcpUrl("https://api.example/projects/old/mcp", "new"),
      "https://api.example/projects/new/mcp",
    );
    assertEquals(
      createProjectScopedMcpUrl("https://api.example/mcp", "  "),
      "https://api.example/mcp",
    );
    assertEquals(
      createProjectScopedMcpUrl(
        "https://api.example/mcp/?environment=staging",
        "project-1",
      ),
      "https://api.example/projects/project-1/mcp?environment=staging",
    );
    assertEquals(
      createProjectScopedMcpUrl("not an absolute URL", "project-1"),
      "not an absolute URL",
    );
  });
});

it("createAgentServiceRemoteMcpConfig builds generic MCP config without dropping options", () => {
  const headers = { Authorization: "Bearer external-token" };
  assertEquals(
    createAgentServiceRemoteMcpConfig({
      server: {
        id: "linear",
        endpoint: "https://linear.example/mcp",
        headers,
        listMethod: "tools/list",
        callMethod: "tools/call",
      },
      authToken: "token-1",
      apiMcpUrl: "https://api.example/mcp",
    }),
    {
      id: "linear",
      endpoint: "https://linear.example/mcp",
      headers,
      listMethod: "tools/list",
      callMethod: "tools/call",
    },
  );
});

it("createAgentServiceRemoteMcpConfig gates Studio MCP by client profile", async () => {
  const blockedConfig = createAgentServiceRemoteMcpConfig({
    server: { kind: "veryfront-studio" },
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    studioMcpUrl: "https://studio.example/mcp",
    clientProfile: {
      id: "veryfront-cli",
      type: "cli",
      trusted: true,
      capabilities: [],
    },
    getProjectId: () => "project-1",
  });
  assertEquals(blockedConfig, null);

  let projectId = "project-1";
  const allowedConfig = createAgentServiceRemoteMcpConfig({
    server: { kind: "veryfront-studio" },
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
    studioMcpUrl: "https://studio.example/mcp",
    clientProfile: {
      id: "veryfront-studio",
      type: "web",
      trusted: true,
      capabilities: ["ui_panels"],
    },
    conversationId: "conversation-1",
    getProjectId: () => projectId,
  });

  assertEquals(allowedConfig?.id, "studio-mcp");
  assertEquals(allowedConfig?.endpoint, "https://studio.example/mcp");
  projectId = "project-2";
  const headers = typeof allowedConfig?.headers === "function"
    ? await allowedConfig.headers()
    : allowedConfig?.headers;
  assertEquals(headers, {
    Authorization: "Bearer token-1",
    "x-conversation-id": "conversation-1",
    "x-project-id": "project-2",
  });
});

it("keeps legacy invocation and deny policies across API naming versions", async () => {
  for (const supportsNamingMode of [true, false]) {
    const config = createAgentServiceRemoteMcpConfig({
      server: { kind: "veryfront-api" },
      authToken: "test-token",
      apiMcpUrl: "https://93.184.216.34/mcp?tool_names=canonical",
    });
    if (!config) throw new Error("Expected API source configuration");
    const source = wrapRemoteToolSourceWithMcpPolicy(createRemoteMCPToolSource(config), {
      deny: ["update_file"],
    });
    const calledNames: string[] = [];
    await withMockFetch(async (_url, init) => {
      const body = JSON.parse(String(init?.body));
      if (body.method === "tools/list") {
        const canonical = supportsNamingMode &&
          body.params?._meta?.["veryfront/tool-names"] !== "legacy";
        return Response.json({
          jsonrpc: "2.0",
          id: body.id,
          result: {
            tools: ["get_file", "update_file", "gmail__list_emails"].map((name) => ({
              name: canonical && !name.includes("__") ? `veryfront__${name}` : name,
              description: "Tool",
              inputSchema: {},
            })),
          },
        });
      }
      calledNames.push(body.params.name);
      return Response.json({
        jsonrpc: "2.0",
        id: body.id,
        result: { content: [{ type: "text", text: "ok" }] },
      });
    }, async () => {
      assertEquals((await source.listTools()).map((tool) => tool.name), [
        "get_file",
        "gmail__list_emails",
      ]);
      await assertRejects(
        async () => await source.executeTool("update_file", {}),
        Error,
        "not allowed",
      );
      await source.executeTool("get_file", {});
      assertEquals(calledNames, ["get_file"]);
    });
  }
});
