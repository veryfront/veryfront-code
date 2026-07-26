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
import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import { defineSchema } from "../../schemas/define.ts";
import { executeRemoteIntegrationTool } from "#veryfront/integrations/remote-tools.ts";
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
    setEnv("VERYFRONT_PROJECT_SLUG", "environment-project");
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
        return new Response(
          [
            'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":1}}}\n\n',
            'event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":"done"}}\n\n',
            'event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n',
            'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":1}}\n\n',
            'event: message_stop\ndata: {"type":"message_stop"}\n\n',
          ].join(""),
          { headers: { "content-type": "text/event-stream" } },
        );
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
    await toolRegistryInternal.clearAll();
    clearModelProviders();
    restoreEnv("VERYFRONT_API_BASE_URL", previousApiBaseUrl);
    restoreEnv("VERYFRONT_API_TOKEN", previousApiToken);
    restoreEnv("VERYFRONT_PROJECT_SLUG", previousProjectSlug);
    restoreEnv("PROXY_MODE", previousProxyMode);
    refreshEnvironmentConfig();
  }
});

Deno.test(
  "createDefaultHostedChatRuntime binds sibling tool calls to a newly opened project",
  async () => {
    const previousApiBaseUrl = getEnv("VERYFRONT_API_BASE_URL");
    const previousApiToken = getEnv("VERYFRONT_API_TOKEN");
    const previousProjectSlug = getEnv("VERYFRONT_PROJECT_SLUG");
    const previousProxyMode = getEnv("PROXY_MODE");

    try {
      setEnv("VERYFRONT_API_BASE_URL", "https://api.test");
      setEnv("VERYFRONT_API_TOKEN", "environment-token");
      setEnv("VERYFRONT_PROJECT_SLUG", "environment-project");
      deleteEnv("PROXY_MODE");
      refreshEnvironmentConfig();
      clearModelProviders();

      let modelCallCount = 0;
      const observedToolNames: string[][] = [];
      const model: ModelRuntime = {
        provider: "anthropic",
        modelId: "anthropic/claude-sonnet-4-6",
        async doGenerate() {
          return {
            content: [{ type: "text", text: "unused" }],
            finishReason: "stop",
            usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          };
        },
        async doStream(options) {
          modelCallCount += 1;
          const rawTools = (options as { tools?: unknown }).tools;
          observedToolNames.push(
            Array.isArray(rawTools)
              ? rawTools.map((entry) =>
                (entry as { name?: string; id?: string }).name ??
                  (entry as { name?: string; id?: string }).id ?? ""
              )
              : Object.keys((rawTools as Record<string, unknown> | undefined) ?? {}),
          );
          if (modelCallCount === 1) {
            return {
              stream: new ReadableStream<unknown>({
                start(controller) {
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: "open-project-1",
                    toolName: "studio_open_project",
                    input: JSON.stringify({ project_reference: "project-two" }),
                  });
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: "list-repos-1",
                    toolName: "github__list_repos",
                    input: "{}",
                  });
                  controller.enqueue({
                    type: "finish",
                    finishReason: "tool-calls",
                    usage: { inputTokens: 1, outputTokens: 1 },
                  });
                  controller.close();
                },
              }),
            };
          }

          return {
            stream: new ReadableStream<unknown>({
              start(controller) {
                controller.enqueue({ type: "text-delta", text: "done" });
                controller.enqueue({
                  type: "finish",
                  finishReason: "stop",
                  usage: { inputTokens: 1, outputTokens: 1 },
                });
                controller.close();
              },
            }),
          };
        },
      };
      registerModelProvider("veryfront-cloud", () => model);

      const studioExecutionContexts: ToolExecutionContext[] = [];
      const integrationExecutionContexts: ToolExecutionContext[] = [];
      const streamErrors: string[] = [];
      let integrationCallAuthorization: string | null = null;
      let integrationCallProjectSlug: string | null = null;

      await withMockFetch(
        async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          const path = new URL(request.url).pathname;
          if (path === "/integrations/tools/list") {
            return Response.json({
              tools: [{
                name: "github__list_repos",
                description: "List repositories",
                inputSchema: { type: "object", properties: {} },
              }],
            });
          }
          if (path === "/integrations/tools/call") {
            integrationCallAuthorization = request.headers.get("Authorization");
            integrationCallProjectSlug = request.headers.get("x-veryfront-project-slug");
            return Response.json({ ok: true });
          }
          return Response.json({ ok: true });
        },
        async () => {
          const runtime = await createDefaultHostedChatRuntime({
            sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
            options: {
              projectId: "11111111-1111-4111-8111-111111111111",
              projectSlug: "project-one",
              authToken: "project-one-token",
              instructions: "Open the requested project, then list its repositories.",
              model: "sonnet",
              allowedTools: ["studio_open_project", "github__list_repos"],
              conversationId: "conversation-1",
              userId: "user-1",
              maxSteps: 2,
              clientProfile: {
                id: "veryfront-studio",
                type: "web",
                trusted: true,
                capabilities: ["ui_panels"],
              },
            },
            config: {
              apiUrl: "https://api.example.com",
              apiMcpUrl: "https://api.example.com/mcp",
              studioMcpUrl: "https://studio.example.com/mcp",
            },
            buildLocalTools: () => ({}),
            createRemoteToolSource: (config) => ({
              id: config.id ?? "source",
              listTools: () =>
                Promise.resolve(
                  config.id === "studio-mcp"
                    ? [{
                      name: "studio_open_project",
                      description: "Open a Studio project",
                      parameters: {
                        type: "object",
                        properties: {
                          project_reference: { type: "string" },
                        },
                        required: ["project_reference"],
                      },
                    }]
                    : config.id === "veryfront-mcp"
                    ? [{
                      name: "github__list_repos",
                      description: "List repositories",
                      parameters: { type: "object", properties: {} },
                    }]
                    : [],
                ),
              executeTool: (toolName, args, context) => {
                if (toolName === "github__list_repos") {
                  integrationExecutionContexts.push({ ...(context ?? {}) });
                  return executeRemoteIntegrationTool(
                    toolName,
                    args as Record<string, unknown>,
                    context,
                  );
                }
                if (toolName !== "studio_open_project") {
                  return Promise.resolve({ ok: true });
                }
                studioExecutionContexts.push({ ...(context ?? {}) });
                return Promise.resolve({
                  success: true,
                  project_id: "22222222-2222-4222-8222-222222222222",
                  slug: "project-two",
                });
              },
            }),
            onStudioProjectSwitch: ({ projectId, projectSlug, taskContext }) => {
              taskContext.projectId = projectId;
              taskContext.projectSlug = projectSlug;
              taskContext.authToken = "project-two-token";
              return true;
            },
            projectScopedRemoteToolOptions: {
              projectNavigationToolNames: ["studio_open_project"],
            },
            preloadLatestConversationUserText: false,
          });

          const result = await runtime.agent.stream({
            messages: [{
              id: "user-1",
              role: "user",
              parts: [{ type: "text", text: "Open project two and list its repositories." }],
              timestamp: 1,
            }],
            abortSignal: new AbortController().signal,
          });
          for await (
            const _chunk of result.toUIMessageStream({
              onError: (error) => {
                streamErrors.push(error instanceof Error ? error.message : String(error));
                return "runtime error";
              },
            })
          ) {
            // Consume the stream so both sibling tool calls execute.
          }
        },
      );

      assertEquals(streamErrors, []);
      assertEquals(observedToolNames[0]?.includes("studio_open_project"), true);
      assertEquals(observedToolNames[0]?.includes("github__list_repos"), true);
      assertEquals(studioExecutionContexts.length, 1);
      assertEquals(studioExecutionContexts[0]?.authToken, "project-one-token");
      assertEquals(studioExecutionContexts[0]?.projectId, "11111111-1111-4111-8111-111111111111");
      assertEquals(studioExecutionContexts[0]?.projectSlug, "project-one");
      assertEquals(integrationExecutionContexts.length, 1);
      assertEquals(integrationExecutionContexts[0]?.authToken, "project-two-token");
      assertEquals(
        integrationExecutionContexts[0]?.projectId,
        "22222222-2222-4222-8222-222222222222",
      );
      assertEquals(integrationExecutionContexts[0]?.projectSlug, "project-two");
      assertEquals(integrationCallAuthorization, "Bearer project-two-token");
      assertEquals(integrationCallProjectSlug, "project-two");
    } finally {
      await toolRegistryInternal.clearAll();
      clearModelProviders();
      restoreEnv("VERYFRONT_API_BASE_URL", previousApiBaseUrl);
      restoreEnv("VERYFRONT_API_TOKEN", previousApiToken);
      restoreEnv("VERYFRONT_PROJECT_SLUG", previousProjectSlug);
      restoreEnv("PROXY_MODE", previousProxyMode);
      refreshEnvironmentConfig();
    }
  },
);

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
    toolRegistryInternal.clearAll();
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
