import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import type { RemoteToolSource, ToolExecutionContext } from "#veryfront/tool";
import { agent } from "../index.ts";
import { agentRegistry } from "../composition/index.ts";
import {
  type RuntimeRemoteToolConfig,
  VERYFRONT_STUDIO_MCP_SOURCE_ID,
} from "./mcp-server-tool-sources.ts";
import { scriptedModel } from "./model-runtime.test-helpers.ts";

function eagerAgent(config: Parameters<typeof agent>[0]): ReturnType<typeof agent> {
  return agent({ ...config, __vfToolLoadingMode: "eager" } as Parameters<typeof agent>[0]);
}

Deno.test("local delegates inherit the trusted request-scoped MCP source", async () => {
  const childId = "request-scoped-mcp-child";
  const rootId = "request-scoped-mcp-root";
  const listedBy: string[] = [];

  const injectedStudioSource: RemoteToolSource = {
    id: VERYFRONT_STUDIO_MCP_SOURCE_ID,
    listTools(context) {
      listedBy.push(context?.agentId ?? "unknown");
      return Promise.resolve([
        {
          name: "get_file",
          description: "Read a project file",
          parameters: { type: "object", properties: {} },
        },
        {
          name: "delete_file",
          description: "Delete a project file",
          parameters: { type: "object", properties: {} },
        },
      ]);
    },
    executeTool: () => Promise.resolve({ ok: true }),
  };

  const childModel = scriptedModel([
    { text: "child completed" },
  ], { provider: "test", modelId: "test/delegate-child", only: "stream" });
  const rootModel = scriptedModel([
    {
      toolCalls: [{
        id: "delegate-call-1",
        name: `agent_${childId}`,
        input: { input: "Read the project file" },
      }],
    },
    { text: "root completed" },
  ], { provider: "test", modelId: "test/delegate-root", only: "stream" });

  eagerAgent({
    id: childId,
    model: "test/delegate-child",
    system: "Use the project tool.",
    tools: true,
    mcpServers: [{ kind: "veryfront-studio" }],
    resolveModelTransport: () => ({ model: childModel }),
  });
  const root = eagerAgent(
    {
      id: rootId,
      model: "test/delegate-root",
      system: "Delegate the task.",
      delegates: [childId],
      resolveModelTransport: () => ({ model: rootModel }),
      __vfAllowedRemoteTools: ["get_file"],
      __vfRemoteToolSources: [injectedStudioSource],
    } as Parameters<typeof agent>[0] & RuntimeRemoteToolConfig,
  );

  try {
    const body = await (await root.stream({ input: "Run the child" }))
      .toDataStreamResponse()
      .text();

    assertEquals(childModel.callCount, 1);
    assertEquals(rootModel.callCount, 2);
    assertEquals(listedBy.includes(childId), true);
    assertEquals(childModel.toolNames(0).includes("get_file"), true);
    assertEquals(childModel.toolNames(0).includes("delete_file"), false);
    assertEquals(body.includes("root completed"), true);
    assertEquals(body.includes('"type":"error"'), false);
  } finally {
    agentRegistry.delete(childId);
    agentRegistry.delete(rootId);
  }
});

Deno.test("local delegates execute inherited MCP tools with the parent credential identity", async () => {
  const childId = "request-scoped-auth-child";
  const rootId = "request-scoped-auth-root";
  let executeContext: ToolExecutionContext | undefined;

  const injectedStudioSource: RemoteToolSource = {
    id: VERYFRONT_STUDIO_MCP_SOURCE_ID,
    listTools: () =>
      Promise.resolve([{
        name: "get_file",
        description: "Read a project file",
        parameters: { type: "object", properties: {} },
      }]),
    executeTool(_toolName, _args, context) {
      executeContext = context;
      return Promise.resolve({ content: "project file" });
    },
  };

  const childModel = scriptedModel([
    {
      toolCalls: [{
        id: "get-file-call-1",
        name: "get_file",
        input: { path: "README.md" },
      }],
    },
    { text: "child completed" },
  ], { provider: "test", modelId: "test/delegate-auth-child", only: "stream" });
  const rootModel = scriptedModel([
    {
      toolCalls: [{
        id: "delegate-call-1",
        name: `agent_${childId}`,
        input: { input: "Read the project file" },
      }],
    },
    { text: "root completed" },
  ], { provider: "test", modelId: "test/delegate-auth-root", only: "stream" });

  eagerAgent({
    id: childId,
    model: "test/delegate-auth-child",
    system: "Use the project tool.",
    tools: { get_file: true },
    mcpServers: [{ kind: "veryfront-studio" }],
    resolveModelTransport: () => ({ model: childModel }),
  });
  const root = eagerAgent(
    {
      id: rootId,
      model: "test/delegate-auth-root",
      system: "Delegate the task.",
      delegates: [childId],
      resolveModelTransport: () => ({ model: rootModel }),
      __vfAllowedRemoteTools: ["get_file"],
      __vfRemoteToolSources: [injectedStudioSource],
    } as Parameters<typeof agent>[0] & RuntimeRemoteToolConfig,
  );

  try {
    const body = await (await root.stream({
      input: "Run the child",
      context: {
        authToken: "parent-token",
        runId: "parent-run",
        agentId: rootId,
        projectId: "project-1",
      },
    })).toDataStreamResponse().text();

    assertEquals(childModel.callCount, 2);
    assertEquals(rootModel.callCount, 2);
    assertEquals(body.includes("root completed"), true);
    assertEquals(executeContext?.authToken, "parent-token");
    assertEquals(executeContext?.runId, "parent-run");
    assertEquals(executeContext?.agentId, rootId);
    assertEquals(executeContext?.toolCallId, "get-file-call-1");
  } finally {
    agentRegistry.delete(childId);
    agentRegistry.delete(rootId);
  }
});

Deno.test("local-only delegates preserve the trusted MCP source for a grandchild", async () => {
  const grandchildId = "request-scoped-mcp-grandchild";
  const childId = "request-scoped-local-child";
  const rootId = "request-scoped-mcp-nested-root";
  const listedBy: string[] = [];

  const injectedStudioSource: RemoteToolSource = {
    id: VERYFRONT_STUDIO_MCP_SOURCE_ID,
    listTools(context) {
      listedBy.push(context?.agentId ?? "unknown");
      return Promise.resolve([{
        name: "get_file",
        description: "Read a project file",
        parameters: { type: "object", properties: {} },
      }]);
    },
    executeTool: () => Promise.resolve({ ok: true }),
  };

  const grandchildModel = scriptedModel([
    { text: "grandchild completed" },
  ], { provider: "test", modelId: "test/delegate-grandchild", only: "stream" });
  const childModel = scriptedModel([
    {
      toolCalls: [{
        id: "grandchild-call-1",
        name: `agent_${grandchildId}`,
        input: { input: "Read the project file" },
      }],
    },
    { text: "child completed" },
  ], { provider: "test", modelId: "test/delegate-intermediate", only: "stream" });
  const rootModel = scriptedModel([
    {
      toolCalls: [{
        id: "child-call-1",
        name: `agent_${childId}`,
        input: { input: "Delegate to the grandchild" },
      }],
    },
    { text: "root completed" },
  ], { provider: "test", modelId: "test/delegate-nested-root", only: "stream" });

  eagerAgent({
    id: grandchildId,
    model: "test/delegate-grandchild",
    system: "Use the project tool.",
    tools: { get_file: true },
    mcpServers: [{
      kind: "veryfront-studio",
      toolPolicy: { allow: ["get_file"] },
    }],
    resolveModelTransport: () => ({ model: grandchildModel }),
  });
  eagerAgent({
    id: childId,
    model: "test/delegate-intermediate",
    system: "Delegate once.",
    delegates: [grandchildId],
    resolveModelTransport: () => ({ model: childModel }),
  });
  const root = eagerAgent(
    {
      id: rootId,
      model: "test/delegate-nested-root",
      system: "Delegate the task.",
      delegates: [childId],
      resolveModelTransport: () => ({ model: rootModel }),
      __vfRemoteToolSources: [injectedStudioSource],
    } as Parameters<typeof agent>[0] & RuntimeRemoteToolConfig,
  );

  try {
    const body = await (await root.stream({ input: "Run the nested child" }))
      .toDataStreamResponse()
      .text();

    assertEquals(grandchildModel.callCount, 1);
    assertEquals(childModel.callCount, 2);
    assertEquals(rootModel.callCount, 2);
    assertEquals(listedBy.includes(grandchildId), true);
    assertEquals(grandchildModel.toolNames(0).includes("get_file"), true);
    assertEquals(body.includes("root completed"), true);
    assertEquals(body.includes('"type":"error"'), false);
  } finally {
    agentRegistry.delete(grandchildId);
    agentRegistry.delete(childId);
    agentRegistry.delete(rootId);
  }
});
