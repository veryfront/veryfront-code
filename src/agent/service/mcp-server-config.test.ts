import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import type { ToolExecutionContext } from "#veryfront/tool";
import { MAX_OPAQUE_ID_CODE_UNITS } from "#veryfront/utils/project-identity.ts";
import { resolveHostedToolExecutionContext } from "../hosted/runtime-state-resolver.ts";
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

Deno.test("Veryfront API MCP headers ignore inherited execution auth", async () => {
  const config = createAgentServiceRemoteMcpConfig({
    server: { kind: "veryfront-api" },
    authToken: "host-token",
    apiMcpUrl: "https://api.example/mcp",
  });
  const headers = config?.headers;
  if (typeof headers !== "function") {
    throw new Error("Expected dynamic Veryfront API headers");
  }

  let inheritedGetterCalls = 0;
  const context = Object.create({
    get authToken() {
      inheritedGetterCalls += 1;
      return "inherited-token";
    },
  }) as ToolExecutionContext;

  assertEquals(await headers(context), {
    Authorization: "Bearer host-token",
  });
  assertEquals(inheritedGetterCalls, 0);
});

Deno.test("Veryfront MCP headers fail closed for invalid explicit execution auth", async () => {
  const apiConfig = createAgentServiceRemoteMcpConfig({
    server: { kind: "veryfront-api" },
    authToken: "host-token",
    apiMcpUrl: "https://api.example/mcp",
  });
  const apiHeaders = apiConfig?.headers;
  if (typeof apiHeaders !== "function") {
    throw new Error("Expected dynamic Veryfront API headers");
  }

  for (const authToken of [undefined, "", " padded-token "]) {
    await assertRejects(
      async () => await apiHeaders({ authToken }),
      TypeError,
      "Execution context authToken is invalid",
    );
  }

  let getterCalls = 0;
  const accessorContext = {} as ToolExecutionContext;
  Object.defineProperty(accessorContext, "authToken", {
    get() {
      getterCalls += 1;
      return "accessor-token";
    },
  });
  await assertRejects(
    async () => await apiHeaders(accessorContext),
    TypeError,
    "Execution context authToken is unreadable",
  );
  assertEquals(getterCalls, 0);
});

Deno.test("Veryfront MCP headers do not fall back for hosted absent auth", async () => {
  const config = createAgentServiceRemoteMcpConfig({
    server: { kind: "veryfront-api" },
    authToken: "ambient-host-token",
    apiMcpUrl: "https://api.example/mcp",
  });
  const headers = config?.headers;
  if (typeof headers !== "function") {
    throw new Error("Expected dynamic Veryfront API headers");
  }

  const hostedContext = resolveHostedToolExecutionContext(
    {
      projectId: "hosted-project",
      projectSlug: "hosted-project",
    },
    undefined,
  );

  assertEquals(Object.hasOwn(hostedContext, "authToken"), true);
  assertEquals(Object.hasOwn(hostedContext, "projectId"), false);
  assertEquals(Object.hasOwn(hostedContext, "projectSlug"), false);
  await assertRejects(
    async () => await headers(hostedContext),
    TypeError,
    "Execution context authToken is invalid",
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
  if (typeof allowedConfig?.headers !== "function") {
    throw new Error("Expected dynamic Studio MCP headers");
  }
  const allowedHeaders = allowedConfig.headers;

  assertEquals(await allowedHeaders(), {
    Authorization: "Bearer token-1",
    "x-conversation-id": "conversation-1",
    "x-project-id": "project-2",
  });
  assertEquals(await allowedHeaders({ runId: "run-1" }), {
    Authorization: "Bearer token-1",
    "x-conversation-id": "conversation-1",
    "x-project-id": "project-2",
  });
  assertEquals(await allowedHeaders({ projectId: "unowned-project" }), {
    Authorization: "Bearer token-1",
    "x-conversation-id": "conversation-1",
    "x-project-id": "project-2",
  });
  assertEquals(
    await allowedHeaders({
      authToken: "old-token",
      projectId: "old-project",
    }),
    {
      Authorization: "Bearer old-token",
      "x-conversation-id": "conversation-1",
      "x-project-id": "old-project",
    },
  );
  assertEquals(await allowedHeaders({ authToken: "projectless-token" }), {
    Authorization: "Bearer projectless-token",
    "x-conversation-id": "conversation-1",
  });
  assertEquals(await allowedHeaders({ authToken: "run-token-2", projectId: "project-2" }), {
    Authorization: "Bearer run-token-2",
    "x-conversation-id": "conversation-1",
    "x-project-id": "project-2",
  });

  let projectGetterCalls = 0;
  const accessorContext = { authToken: "run-token-3" } as ToolExecutionContext;
  Object.defineProperty(accessorContext, "projectId", {
    get() {
      projectGetterCalls += 1;
      return "accessor-project";
    },
  });
  await assertRejects(
    async () => await allowedHeaders(accessorContext),
    TypeError,
    "Execution context projectId is unreadable",
  );
  assertEquals(projectGetterCalls, 0);

  for (
    const invalidProjectId of [
      "control\u0000project",
      "x".repeat(MAX_OPAQUE_ID_CODE_UNITS + 1),
    ]
  ) {
    await assertRejects(
      async () =>
        await allowedHeaders({
          authToken: "run-token-4",
          projectId: invalidProjectId,
        }),
      TypeError,
      "Execution context projectId is invalid",
    );
  }
});
