import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  createAgentServiceRemoteMcpConfig,
  defaultAgentServiceMcpServers,
} from "./mcp-server-config.ts";

Deno.test("defaultAgentServiceMcpServers enables first-party MCP servers", () => {
  assertEquals(defaultAgentServiceMcpServers(), [
    { kind: "veryfront-api" },
    { kind: "veryfront-studio" },
  ]);
});

Deno.test("createAgentServiceRemoteMcpConfig builds Veryfront API MCP config", async () => {
  const config = createAgentServiceRemoteMcpConfig({
    server: { kind: "veryfront-api" },
    authToken: "token-1",
    apiMcpUrl: "https://api.example/mcp",
  });
  assertEquals(config?.id, "veryfront-mcp");
  assertEquals(config?.endpoint, "https://api.example/mcp");
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
      Authorization: "Bearer run-token-1",
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
