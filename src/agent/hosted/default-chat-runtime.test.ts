import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists, assertRejects } from "#veryfront/testing/assert.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { refreshEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { clearModelProviders, type ModelRuntime, registerModelProvider } from "#veryfront/provider";
import type {
  RemoteMCPToolSourceConfig,
  RemoteToolSource,
  ToolExecutionContext,
} from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { defineSchema } from "../../schemas/define.ts";
import {
  createDefaultHostedChatRuntime,
  type DefaultHostedChatRuntimeTaskContext,
} from "./default-chat-runtime.ts";

const unrestrictedSourceIntegrationPolicy = {
  schemaVersion: 1,
  mode: "unrestricted",
} as const;

function localTool(description: string) {
  return {
    description,
    inputSchema: defineSchema((v) => v.object({}))(),
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

function createTextStream() {
  return new ReadableStream<unknown>({
    start(controller) {
      controller.enqueue({ type: "text-delta", text: "done" });
      controller.enqueue({ type: "finish", finishReason: "stop" });
      controller.close();
    },
  });
}

function createMockModel(): ModelRuntime {
  return {
    provider: "anthropic",
    modelId: "anthropic/claude-sonnet-4-6",
    async doGenerate() {
      return {
        content: [{ type: "text", text: "done" }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
    async doStream() {
      return { stream: createTextStream() };
    },
  };
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) {
    deleteEnv(key);
    return;
  }
  setEnv(key, value);
}

Deno.test("createDefaultHostedChatRuntime builds a cloud-backed hosted runtime", async () => {
  let capturedContext: DefaultHostedChatRuntimeTaskContext | undefined;

  const runtime = await createDefaultHostedChatRuntime({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
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
      submittedFormInputResult: {
        values: { topic: "Support FAQ assistant" },
        inputRequestId: "input-request-1",
      },
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
  assertEquals(capturedContext.submittedFormInputResult, {
    values: { topic: "Support FAQ assistant" },
    inputRequestId: "input-request-1",
  });
  assertEquals(capturedContext.availableToolNames, ["sleep"]);
});

Deno.test("createDefaultHostedChatRuntime forwards hosted project slug to integration discovery", async () => {
  const previousApiBaseUrl = getEnv("VERYFRONT_API_BASE_URL");
  const previousApiToken = getEnv("VERYFRONT_API_TOKEN");
  const previousProjectSlug = getEnv("VERYFRONT_PROJECT_SLUG");
  const previousProxyMode = getEnv("PROXY_MODE");

  try {
    setEnv("VERYFRONT_API_BASE_URL", "https://api.test");
    setEnv("VERYFRONT_API_TOKEN", "environment-token");
    deleteEnv("VERYFRONT_PROJECT_SLUG");
    deleteEnv("PROXY_MODE");
    refreshEnvironmentConfig();
    clearModelProviders();
    registerModelProvider("anthropic", () => createMockModel());

    let authorizationHeader: string | null = null;
    let projectSlugHeader: string | null = null;

    const runtime = await createDefaultHostedChatRuntime({
      sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
      options: {
        projectId: "11111111-1111-4111-8111-111111111111",
        projectSlug: "authorized-project",
        authToken: "user-scoped-token",
        instructions: "Base instructions",
        model: "sonnet",
        allowedTools: ["github__list_repos"],
        conversationId: "conversation-1",
        userId: "user-1",
      },
      config: {
        apiUrl: "https://api.example.com",
        apiMcpUrl: "https://api.example.com/mcp",
      },
      buildLocalTools: () => ({}),
      createRemoteToolSource: emptyRemoteSource,
      preloadLatestConversationUserText: false,
    });

    await withMockFetch(
      async (input: string | URL | Request, init?: RequestInit) => {
        const request = input instanceof Request ? input : new Request(input, init);
        if (new URL(request.url).pathname === "/integrations/tools/list") {
          authorizationHeader = request.headers.get("Authorization");
          projectSlugHeader = request.headers.get("x-veryfront-project-slug");
          return Response.json({
            tools: [{
              name: "github__list_repos",
              description: "List repos",
              inputSchema: { type: "object", properties: {} },
            }],
          });
        }
        return Response.json({ ok: true });
      },
      async () => {
        const result = await runtime.agent.stream({
          messages: [],
          abortSignal: new AbortController().signal,
        });
        for await (const _chunk of result.toUIMessageStream()) {
          // Consume the stream so runtime tool discovery executes.
        }
      },
    );

    assertEquals(authorizationHeader, "Bearer user-scoped-token");
    assertEquals(projectSlugHeader, "authorized-project");
  } finally {
    await toolRegistry.clearAll();
    clearModelProviders();
    restoreEnv("VERYFRONT_API_BASE_URL", previousApiBaseUrl);
    restoreEnv("VERYFRONT_API_TOKEN", previousApiToken);
    restoreEnv("VERYFRONT_PROJECT_SLUG", previousProjectSlug);
    restoreEnv("PROXY_MODE", previousProxyMode);
    refreshEnvironmentConfig();
  }
});

Deno.test("createDefaultHostedChatRuntime keeps per-run host tools out of the global registry", async () => {
  try {
    const createRuntime = (description: string) =>
      createDefaultHostedChatRuntime({
        sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
        options: {
          projectId: "project-1",
          branchId: "branch-1",
          authToken: "token-1",
          instructions: "Base instructions",
          model: "sonnet",
          allowedTools: ["load_skill"],
          conversationId: "conversation-1",
          userId: "user-1",
        },
        config: {
          apiUrl: "https://api.example.com",
          apiMcpUrl: "https://api.example.com/mcp",
          studioMcpUrl: "https://studio.example.com/mcp",
        },
        buildLocalTools: () => ({ load_skill: localTool(description) }),
        createRemoteToolSource: emptyRemoteSource,
        preloadLatestConversationUserText: false,
      });

    await createRuntime("Load first skill catalog");
    await createRuntime("Load updated skill catalog");

    assertEquals(toolRegistry.getOwn("load_skill"), undefined);
  } finally {
    toolRegistry.clearAll();
  }
});

Deno.test("createDefaultHostedChatRuntime resolves configured owner tool selectors", async () => {
  let capturedContext: DefaultHostedChatRuntimeTaskContext | undefined;

  await createDefaultHostedChatRuntime({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    options: {
      projectId: "project-1",
      authToken: "token-1",
      instructions: "Base instructions",
      model: "openai/gpt-5.4-nano",
      agentId: "researcher",
      allowedTools: ["fetch-paper"],
    },
    config: {
      apiUrl: "https://api.example.com",
      apiMcpUrl: "https://api.example.com/mcp",
    },
    buildLocalTools: (taskContext) => {
      capturedContext = taskContext;
      return {
        "researcher--fetch-paper": {
          ...localTool("Fetch a paper"),
          id: "researcher--fetch-paper",
          ownerAgentId: "researcher",
          shortName: "fetch-paper",
        },
      };
    },
    createRemoteToolSource: emptyRemoteSource,
    preloadLatestConversationUserText: false,
  });

  assertExists(capturedContext);
  assertEquals(capturedContext.availableToolNames, ["researcher--fetch-paper"]);
});

Deno.test("createDefaultHostedChatRuntime awaits per-run tool setup and exposes its cleanup", async () => {
  let capturedContext: DefaultHostedChatRuntimeTaskContext | undefined;
  let cleanupCalls = 0;

  const runtime = await createDefaultHostedChatRuntime({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    options: {
      projectId: "project-1",
      authToken: "token-1",
      instructions: "Base instructions",
      model: "openai/gpt-5.4-nano",
      allowedTools: ["bash"],
    },
    config: {
      apiUrl: "https://api.example.com",
      apiMcpUrl: "https://api.example.com/mcp",
    },
    buildLocalTools: async (taskContext) => {
      capturedContext = taskContext;
      await Promise.resolve();
      return { bash: localTool("Run shell commands") };
    },
    cleanup: () => {
      cleanupCalls += 1;
      return Promise.resolve();
    },
    createRemoteToolSource: emptyRemoteSource,
    preloadLatestConversationUserText: false,
  });

  assertExists(capturedContext);
  assertEquals(capturedContext.availableToolNames, ["bash"]);
  await runtime.cleanup();
  assertEquals(cleanupCalls, 1);
});

Deno.test("createDefaultHostedChatRuntime cleans up after partial per-run tool setup failure", async () => {
  let cleanupCalls = 0;

  await assertRejects(
    () =>
      createDefaultHostedChatRuntime({
        sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
        options: {
          projectId: "project-1",
          authToken: "token-1",
          instructions: "Base instructions",
          model: "openai/gpt-5.4-nano",
          allowedTools: ["bash"],
        },
        config: {
          apiUrl: "https://api.example.com",
          apiMcpUrl: "https://api.example.com/mcp",
        },
        buildLocalTools: async () => {
          await Promise.resolve();
          throw new Error("sandbox tool setup failed");
        },
        cleanup: () => {
          cleanupCalls += 1;
          return Promise.resolve();
        },
        createRemoteToolSource: emptyRemoteSource,
        preloadLatestConversationUserText: false,
      }),
    Error,
    "sandbox tool setup failed",
  );

  assertEquals(cleanupCalls, 1);
});

Deno.test("createDefaultHostedChatRuntime preserves setup errors when cleanup also fails", async () => {
  await assertRejects(
    () =>
      createDefaultHostedChatRuntime({
        sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
        options: {
          projectId: "project-1",
          authToken: "token-1",
          instructions: "Base instructions",
          model: "openai/gpt-5.4-nano",
          allowedTools: ["bash"],
        },
        config: {
          apiUrl: "https://api.example.com",
          apiMcpUrl: "https://api.example.com/mcp",
        },
        buildLocalTools: async () => {
          await Promise.resolve();
          throw new Error("sandbox tool setup failed");
        },
        cleanup: () => Promise.reject(new Error("sandbox cleanup failed")),
        createRemoteToolSource: emptyRemoteSource,
        preloadLatestConversationUserText: false,
      }),
    Error,
    "sandbox tool setup failed",
  );
});
