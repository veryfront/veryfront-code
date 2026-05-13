import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  createAgentServiceRemoteMcpConfig,
  defaultAgentServiceMcpServers,
} from "./agent-service-mcp-server-config.ts";

Deno.test("defaultAgentServiceMcpServers enables the Veryfront API MCP server", () => {
  assertEquals(defaultAgentServiceMcpServers(), [{ kind: "veryfront-api" }]);
});

Deno.test("createAgentServiceRemoteMcpConfig builds Veryfront API MCP config", () => {
  assertEquals(
    createAgentServiceRemoteMcpConfig({
      server: { kind: "veryfront-api" },
      authToken: "token-1",
      apiMcpUrl: "https://api.example/mcp",
    }),
    {
      id: "veryfront-mcp",
      endpoint: "https://api.example/mcp",
      headers: {
        Authorization: "Bearer token-1",
      },
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

Deno.test("createAgentServiceRemoteMcpConfig builds generic MCP config without dropping options", () => {
  const customFetch = () => Promise.resolve(new Response("{}"));
  const headers = { Authorization: "Bearer external-token" };
  assertEquals(
    createAgentServiceRemoteMcpConfig({
      server: {
        id: "linear",
        endpoint: "https://linear.example/mcp",
        headers,
        fetch: customFetch,
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
      fetch: customFetch,
      listMethod: "tools/list",
      callMethod: "tools/call",
    },
  );
});

Deno.test("createAgentServiceRemoteMcpConfig gates Studio MCP by client profile", async () => {
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
