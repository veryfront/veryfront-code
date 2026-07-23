import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import type { ModelRuntime } from "#veryfront/provider";
import type { RemoteToolSource } from "#veryfront/tool";
import { agent } from "../index.ts";
import { agentRegistry } from "../composition/index.ts";
import {
  type RuntimeRemoteToolConfig,
  VERYFRONT_STUDIO_MCP_SOURCE_ID,
} from "./mcp-server-tool-sources.ts";

function createRuntimeStream(parts: unknown[]) {
  return new ReadableStream<unknown>({
    start(controller) {
      for (const part of parts) controller.enqueue(part);
      controller.close();
    },
  });
}

function getRuntimeToolNames(options: unknown): string[] {
  const tools = (options as { tools?: unknown }).tools;
  return Array.isArray(tools)
    ? tools.map((entry) =>
      (entry as { name?: string; id?: string }).name ??
        (entry as { name?: string; id?: string }).id ?? ""
    )
    : Object.keys((tools as Record<string, unknown> | undefined) ?? {});
}

Deno.test("local delegates inherit the trusted request-scoped MCP source", async () => {
  const childId = "request-scoped-mcp-child";
  const rootId = "request-scoped-mcp-root";
  let childModelCalls = 0;
  let rootModelCalls = 0;
  const listedBy: string[] = [];
  let childRuntimeToolNames: string[] = [];

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

  const childModel: ModelRuntime = {
    provider: "test",
    modelId: "test/delegate-child",
    doGenerate: () => Promise.reject(new Error("unused")),
    doStream(options) {
      childModelCalls++;
      childRuntimeToolNames = getRuntimeToolNames(options);
      return Promise.resolve({
        stream: createRuntimeStream([
          { type: "text-delta", text: "child completed" },
          {
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        ]),
      });
    },
  };
  const rootModel: ModelRuntime = {
    provider: "test",
    modelId: "test/delegate-root",
    doGenerate: () => Promise.reject(new Error("unused")),
    doStream() {
      rootModelCalls++;
      return Promise.resolve({
        stream: createRuntimeStream(
          rootModelCalls === 1
            ? [
              {
                type: "tool-call",
                toolCallId: "delegate-call-1",
                toolName: `agent_${childId}`,
                input: { input: "Read the project file" },
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]
            : [
              { type: "text-delta", text: "root completed" },
              {
                type: "finish",
                finishReason: "stop",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ],
        ),
      });
    },
  };

  agent({
    id: childId,
    model: "test/delegate-child",
    system: "Use the project tool.",
    tools: true,
    mcpServers: [{ kind: "veryfront-studio" }],
    resolveModelTransport: () => ({ model: childModel }),
  });
  const root = agent(
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

    assertEquals(childModelCalls, 1);
    assertEquals(rootModelCalls, 2);
    assertEquals(listedBy.includes(childId), true);
    assertEquals(childRuntimeToolNames.includes("get_file"), true);
    assertEquals(childRuntimeToolNames.includes("delete_file"), false);
    assertEquals(body.includes("root completed"), true);
    assertEquals(body.includes('"type":"error"'), false);
  } finally {
    agentRegistry.delete(childId);
    agentRegistry.delete(rootId);
  }
});

Deno.test("local-only delegates preserve the trusted MCP source for a grandchild", async () => {
  const grandchildId = "request-scoped-mcp-grandchild";
  const childId = "request-scoped-local-child";
  const rootId = "request-scoped-mcp-nested-root";
  let grandchildModelCalls = 0;
  let childModelCalls = 0;
  let rootModelCalls = 0;
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

  const grandchildModel: ModelRuntime = {
    provider: "test",
    modelId: "test/delegate-grandchild",
    doGenerate: () => Promise.reject(new Error("unused")),
    doStream() {
      grandchildModelCalls++;
      return Promise.resolve({
        stream: createRuntimeStream([
          { type: "text-delta", text: "grandchild completed" },
          {
            type: "finish",
            finishReason: "stop",
            usage: { inputTokens: 1, outputTokens: 1 },
          },
        ]),
      });
    },
  };
  const childModel: ModelRuntime = {
    provider: "test",
    modelId: "test/delegate-intermediate",
    doGenerate: () => Promise.reject(new Error("unused")),
    doStream() {
      childModelCalls++;
      return Promise.resolve({
        stream: createRuntimeStream(
          childModelCalls === 1
            ? [
              {
                type: "tool-call",
                toolCallId: "grandchild-call-1",
                toolName: `agent_${grandchildId}`,
                input: { input: "Read the project file" },
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]
            : [
              { type: "text-delta", text: "child completed" },
              {
                type: "finish",
                finishReason: "stop",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ],
        ),
      });
    },
  };
  const rootModel: ModelRuntime = {
    provider: "test",
    modelId: "test/delegate-nested-root",
    doGenerate: () => Promise.reject(new Error("unused")),
    doStream() {
      rootModelCalls++;
      return Promise.resolve({
        stream: createRuntimeStream(
          rootModelCalls === 1
            ? [
              {
                type: "tool-call",
                toolCallId: "child-call-1",
                toolName: `agent_${childId}`,
                input: { input: "Delegate to the grandchild" },
              },
              {
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ]
            : [
              { type: "text-delta", text: "root completed" },
              {
                type: "finish",
                finishReason: "stop",
                usage: { inputTokens: 1, outputTokens: 1 },
              },
            ],
        ),
      });
    },
  };

  agent({
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
  agent({
    id: childId,
    model: "test/delegate-intermediate",
    system: "Delegate once.",
    delegates: [grandchildId],
    resolveModelTransport: () => ({ model: childModel }),
  });
  const root = agent(
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

    assertEquals(grandchildModelCalls, 1);
    assertEquals(childModelCalls, 2);
    assertEquals(rootModelCalls, 2);
    assertEquals(listedBy.includes(grandchildId), true);
    assertEquals(body.includes("root completed"), true);
    assertEquals(body.includes('"type":"error"'), false);
  } finally {
    agentRegistry.delete(grandchildId);
    agentRegistry.delete(childId);
    agentRegistry.delete(rootId);
  }
});
