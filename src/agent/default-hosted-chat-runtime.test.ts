import { assertEquals, assertExists } from "#veryfront/testing/assert.ts";
import type {
  RemoteMCPToolSourceConfig,
  RemoteToolSource,
  ToolExecutionContext,
} from "#veryfront/tool";
import { z } from "zod";
import {
  createDefaultHostedChatRuntime,
  type DefaultHostedChatRuntimeTaskContext,
} from "./default-hosted-chat-runtime.ts";

function localTool(description: string) {
  return {
    description,
    inputSchema: z.object({}),
    execute: () => ({ ok: true }),
  };
}

function emptyRemoteSource(config: RemoteMCPToolSourceConfig): RemoteToolSource {
  return {
    id: config.id ?? "source",
    listTools: () => Promise.resolve([]),
    executeTool: (_toolName: string, _args: unknown, _context?: ToolExecutionContext) =>
      Promise.resolve({ ok: true }),
  };
}

Deno.test("createDefaultHostedChatRuntime builds a cloud-backed hosted runtime", async () => {
  let capturedContext: DefaultHostedChatRuntimeTaskContext | undefined;

  const runtime = await createDefaultHostedChatRuntime({
    options: {
      projectId: "project-1",
      branchId: "branch-1",
      authToken: "token-1",
      instructions: "Base instructions",
      model: "sonnet",
      allowedTools: ["sleep"],
      conversationId: "conversation-1",
      userId: "user-1",
      parentRunId: "run-1",
      parentMessageId: "message-1",
    },
    config: {
      apiUrl: "https://api.example.com",
      apiMcpUrl: "https://api.example.com/mcp",
      studioMcpUrl: "https://studio.example.com/mcp",
    },
    buildLocalTools: (taskContext) => {
      capturedContext = taskContext;
      return { sleep: localTool("Sleep") };
    },
    createRemoteToolSource: emptyRemoteSource,
    preloadLatestConversationUserText: false,
  });

  assertEquals(runtime.runtimeKind, "framework");
  assertEquals(runtime.modelId, "anthropic/claude-sonnet-4-6");
  assertExists(capturedContext);
  assertEquals(capturedContext.projectId, "project-1");
  assertEquals(capturedContext.branchId, "branch-1");
  assertEquals(capturedContext.model, "anthropic/claude-sonnet-4-6");
  assertEquals(capturedContext.userId, "user-1");
  assertEquals(capturedContext.availableToolNames, ["sleep"]);
});
