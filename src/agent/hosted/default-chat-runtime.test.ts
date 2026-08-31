import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertExists,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { refreshEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { clearModelProviders, type ModelRuntime, registerModelProvider } from "#veryfront/provider";
import { getCurrentVeryfrontCloudContext } from "#veryfront/provider/veryfront-cloud/context.ts";
import type {
  RemoteMCPToolSourceConfig,
  RemoteToolSource,
  ToolExecutionContext,
} from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool";
import { createToolsFromHostDefinitions } from "#veryfront/tool/host-tools.ts";
import { markTrustedHostToolProvenance } from "#veryfront/tool/host-tool-provenance.ts";
import { INVALID_ARGUMENT } from "#veryfront/errors";
import { registerSkill, skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { withMockFetch } from "#veryfront/testing/mock-fetch.ts";
import {
  getCurrentRequestContext as getCurrentProjectRequestContext,
  runWithRequestContext as runWithProjectRequestContext,
} from "#veryfront/platform/adapters/fs/veryfront/request-context.ts";
import { defineSchema } from "../../schemas/define.ts";
import {
  createDefaultHostedChatRuntime,
  type DefaultHostedChatRuntimeTaskContext,
  scopeHostedRuntimeTools,
} from "./default-chat-runtime.ts";
import { prepareHostedChatRuntimeCreationOptions } from "./chat-preparation.ts";
import { buildVeryfrontCloudRuntimeInstructions } from "./cloud-runtime-system-messages.ts";
import {
  createHostedRunEventWriterCapability,
  getActiveHostedRunEventWriterCapability,
  runWithHostedRunEventWriterCapability,
} from "./child-run-event-writer-token.ts";
import { agentRegistry, getAgent } from "../composition/index.ts";

const unrestrictedSourceIntegrationPolicy = {
  schemaVersion: 1,
  mode: "unrestricted",
} as const;
const denyAllSourceIntegrationPolicy = {
  schemaVersion: 1,
  mode: "allowlist",
  integrations: {},
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

Deno.test("scopeHostedRuntimeTools preserves trusted errors and sanitizes project errors", async () => {
  const trustedError = INVALID_ARGUMENT.create({ detail: "Correct the trusted tool input" });
  const tools = createToolsFromHostDefinitions({
    trusted_failure: markTrustedHostToolProvenance({
      description: "Trusted framework failure",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => {
        throw trustedError;
      },
    }),
    project_failure: {
      description: "Project failure",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => {
        throw INVALID_ARGUMENT.create({ detail: "Project-controlled detail" });
      },
    },
  });
  const scoped = scopeHostedRuntimeTools({
    tools,
    taskContext: {
      authToken: "visitor-token",
      projectId: "project-1",
      projectSlug: "project-slug-1",
      branchId: null,
      model: "test/tool-errors",
    },
    cloudContext: {
      apiBaseUrl: "https://api.example.com",
      apiToken: "visitor-token",
      projectSlug: "project-slug-1",
      serviceLayer: "cloud",
    },
  });

  let caughtTrustedError: unknown;
  try {
    await scoped.trusted_failure?.execute({});
  } catch (error) {
    caughtTrustedError = error;
  }
  assertStrictEquals(caughtTrustedError, trustedError);
  await assertRejects(
    async () => await scoped.project_failure?.execute({}),
    TypeError,
    "Hosted project tool execution failed",
  );
});

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

it("caps eager hosted tools when tool_search is denied", async () => {
  let capturedContext: DefaultHostedChatRuntimeTaskContext | undefined;
  await createDefaultHostedChatRuntime({
    sourceIntegrationPolicy: denyAllSourceIntegrationPolicy,
    options: {
      projectId: "project-1",
      authToken: "token-1",
      instructions: "Use only authorized tools.",
      model: "openai/gpt-5.4",
      deniedTools: ["tool_search"],
    },
    config: {
      apiUrl: "https://api.example.com",
      apiMcpUrl: "https://api.example.com/mcp",
    },
    buildLocalTools: (taskContext) => {
      capturedContext = taskContext;
      return Object.fromEntries(
        Array.from({ length: 129 }, (_, index) => [
          `local_tool_${String(index).padStart(3, "0")}`,
          localTool(`Local tool ${index}`),
        ]),
      );
    },
    createRemoteToolSource: emptyRemoteSource,
    preloadLatestConversationUserText: false,
  });

  assertExists(capturedContext);
  assertEquals(capturedContext.availableToolNames?.length, 128);
  assertEquals(capturedContext.availableToolNames?.includes("tool_search"), false);
});

it("preserves layered cache metadata through hosted provider dispatch", async () => {
  clearModelProviders();
  let capturedPrompt: unknown;
  registerModelProvider("test", () => ({
    provider: "test",
    modelId: "test/layered-system",
    doGenerate: () => Promise.reject(new Error("unused")),
    doStream(options: unknown) {
      capturedPrompt = (options as { prompt?: unknown }).prompt;
      return Promise.resolve({ stream: createTextStream() });
    },
  }));

  try {
    const staticMessage = {
      role: "system" as const,
      content: "Shared prompt",
      providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
    };
    const dynamicMessage = {
      role: "system" as const,
      content: '<project_context>\nproject_reference: "project-1"\n</project_context>',
    };
    const runtime = await createDefaultHostedChatRuntime({
      sourceIntegrationPolicy: denyAllSourceIntegrationPolicy,
      options: {
        projectId: "project-1",
        authToken: "token-1",
        instructions: [staticMessage, dynamicMessage],
        model: "test/layered-system",
        allowedTools: [],
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
      () => Promise.resolve(Response.json({ tools: [] })),
      async () => {
        const result = await runtime.agent.stream({
          messages: [],
          abortSignal: new AbortController().signal,
        });
        for await (const _chunk of result.toUIMessageStream()) {
          // Consume the stream so provider dispatch completes.
        }
      },
    );

    const prompt = capturedPrompt as Array<Record<string, unknown>>;
    assertEquals(prompt[0], staticMessage);
    assertEquals(prompt[1], dynamicMessage);
  } finally {
    clearModelProviders();
  }
});

it("assembles registry skill context when live steering is absent", async () => {
  clearModelProviders();
  skillRegistryInternal.clearAll();
  let capturedPrompt: unknown;
  registerSkill("deploy", {
    id: "deploy",
    metadata: { name: "Deploy", description: "Deploy the project" },
    rootPath: "/test/skills/deploy",
  });
  registerModelProvider("test", () => ({
    provider: "test",
    modelId: "test/plain-hosted-system",
    doGenerate: () => Promise.reject(new Error("unused")),
    doStream(options: unknown) {
      capturedPrompt = (options as { prompt?: unknown }).prompt;
      return Promise.resolve({ stream: createTextStream() });
    },
  }));

  try {
    const runtime = await createDefaultHostedChatRuntime({
      sourceIntegrationPolicy: denyAllSourceIntegrationPolicy,
      options: {
        projectId: "project-1",
        authToken: "token-1",
        instructions: "Plain hosted instructions",
        model: "test/plain-hosted-system",
        allowedTools: ["load_skill"],
      },
      config: {
        apiUrl: "https://api.example.com",
        apiMcpUrl: "https://api.example.com/mcp",
      },
      buildLocalTools: () => ({ load_skill: localTool("Load a skill") }),
      createRemoteToolSource: emptyRemoteSource,
      preloadLatestConversationUserText: false,
    });

    await withMockFetch(
      () => Promise.resolve(Response.json({ tools: [] })),
      async () => {
        const result = await runtime.agent.stream({
          messages: [],
          abortSignal: new AbortController().signal,
        });
        for await (const _chunk of result.toUIMessageStream()) {
          // Consume the stream so provider dispatch completes.
        }
      },
    );

    const systemPrompt = (capturedPrompt as Array<{ role?: string; content?: unknown }>)
      .filter((message) => message.role === "system" && typeof message.content === "string")
      .map((message) => message.content)
      .join("\n\n");
    assertStringIncludes(systemPrompt, "<available_skills>");
    assertStringIncludes(systemPrompt, '"skillId":"deploy"');
  } finally {
    skillRegistryInternal.clearAll();
    clearModelProviders();
  }
});

it("hides live steering skills in final rendering when load_skill is denied", async () => {
  clearModelProviders();
  let capturedPrompt: unknown;
  registerModelProvider("test", () => ({
    provider: "test",
    modelId: "test/denied-skill-loader",
    doGenerate: () => Promise.reject(new Error("unused")),
    doStream(options: unknown) {
      capturedPrompt = (options as { prompt?: unknown }).prompt;
      return Promise.resolve({ stream: createTextStream() });
    },
  }));

  try {
    const runtime = await createDefaultHostedChatRuntime({
      sourceIntegrationPolicy: denyAllSourceIntegrationPolicy,
      options: {
        projectId: "project-1",
        authToken: "token-1",
        instructions: "Plain hosted instructions",
        model: "test/denied-skill-loader",
        deniedTools: ["load_skill"],
        liveProjectSteering: {
          agent: {
            id: "agent-1",
            name: "Agent",
            description: "Agent description",
            instructions: "Plain hosted instructions",
            tools: true,
          },
          initialSkills: [{
            id: "deploy",
            name: "Deploy",
            description: "Deploy the project",
            instructions: "Use the deployment checklist.",
            allowedTools: [],
          }],
        },
      },
      config: {
        apiUrl: "https://api.example.com",
        apiMcpUrl: "https://api.example.com/mcp",
      },
      buildLocalTools: () => ({ load_skill: localTool("Load a skill") }),
      createRemoteToolSource: emptyRemoteSource,
      preloadLatestConversationUserText: false,
    });

    await withMockFetch(
      () => Promise.resolve(Response.json({ tools: [] })),
      async () => {
        const result = await runtime.agent.stream({
          messages: [],
          abortSignal: new AbortController().signal,
        });
        for await (const _chunk of result.toUIMessageStream()) {
          // Consume the stream so provider dispatch completes.
        }
      },
    );

    const systemPrompt = (capturedPrompt as Array<{ role?: string; content?: unknown }>)
      .filter((message) => message.role === "system" && typeof message.content === "string")
      .map((message) => message.content)
      .join("\n\n");
    assertEquals(systemPrompt.includes("<available_skills>"), false);
    assertEquals(systemPrompt.includes('"skillId":"deploy"'), false);
  } finally {
    clearModelProviders();
  }
});

it("applies refreshed structured system messages in hosted chat", async () => {
  clearModelProviders();
  let capturedPrompt: unknown;
  let taskContext: DefaultHostedChatRuntimeTaskContext | undefined;
  registerModelProvider("test", () => ({
    provider: "test",
    modelId: "test/refreshed-layered-system",
    doGenerate: () => Promise.reject(new Error("unused")),
    doStream(options: unknown) {
      capturedPrompt = (options as { prompt?: unknown }).prompt;
      return Promise.resolve({ stream: createTextStream() });
    },
  }));

  try {
    const runtime = await createDefaultHostedChatRuntime({
      sourceIntegrationPolicy: denyAllSourceIntegrationPolicy,
      options: {
        projectId: "project-1",
        authToken: "token-1",
        instructions: [{ role: "system", content: "Original structured prompt" }],
        model: "test/refreshed-layered-system",
        allowedTools: [],
        liveProjectSteering: {
          agent: {
            id: "agent-1",
            name: "Agent",
            description: "Agent description",
            instructions: "Original structured prompt",
            tools: true,
          },
          environmentContext: "Editor context",
          initialProjectInstructions: "Original structured prompt",
          initialSkills: [],
        },
      },
      config: {
        apiUrl: "https://api.example.com",
        apiMcpUrl: "https://api.example.com/mcp",
      },
      createTaskContext: (input) => {
        taskContext = {
          authToken: input.options.authToken,
          projectId: input.options.projectId ?? "",
          branchId: input.options.branchId ?? null,
          model: input.modelId,
          steeringRevision: 0,
        };
        return taskContext;
      },
      refreshSystem: () => [{ role: "system", content: "Refreshed structured prompt" }],
      buildLocalTools: () => ({}),
      createRemoteToolSource: emptyRemoteSource,
      preloadLatestConversationUserText: false,
    });
    assertExists(taskContext);
    taskContext.steeringRevision = 1;

    await withMockFetch(
      () => Promise.resolve(Response.json({ tools: [] })),
      async () => {
        const result = await runtime.agent.stream({
          messages: [],
          abortSignal: new AbortController().signal,
        });
        for await (const _chunk of result.toUIMessageStream()) {
          // Consume the stream so provider dispatch completes.
        }
      },
    );

    const systemContents = (capturedPrompt as Array<{ role?: string; content?: unknown }>)
      .filter((message) => message.role === "system")
      .map((message) => message.content);
    assertEquals(systemContents[0], "Refreshed structured prompt");
    assertEquals(systemContents.includes("Original structured prompt"), false);
  } finally {
    clearModelProviders();
  }
});

Deno.test("createDefaultHostedChatRuntime builds a cloud-backed hosted runtime", async () => {
  let capturedContext: DefaultHostedChatRuntimeTaskContext | undefined;
  let capturedCapability: unknown;
  const runEventWriterCapability = createHostedRunEventWriterCapability({
    apiUrl: "https://api.example.com",
    runId: "run-1",
    runEventAppendToken: "root-writer-token",
  });

  const runtime = await runWithHostedRunEventWriterCapability(
    runEventWriterCapability,
    () =>
      createDefaultHostedChatRuntime({
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
          capturedCapability = getActiveHostedRunEventWriterCapability();
          return { sleep: localTool("Sleep") };
        },
        createRemoteToolSource: emptyRemoteSource,
        preloadLatestConversationUserText: false,
      }),
  );

  assertEquals(runtime.runtimeKind, "framework");
  assertEquals(runtime.modelId, "anthropic/claude-sonnet-4-6");
  assertExists(capturedContext);
  assertEquals(capturedContext.projectId, "project-1");
  assertEquals(capturedContext.branchId, "branch-1");
  assertEquals(capturedContext.model, "anthropic/claude-sonnet-4-6");
  assertEquals("runEventAppendToken" in capturedContext, false);
  assertEquals("runEventWriterCapability" in capturedContext, false);
  assertEquals(JSON.stringify(capturedContext).includes("root-writer-token"), false);
  assertEquals(capturedCapability, runEventWriterCapability);
  assertEquals(capturedContext.userId, "user-1");
  assertEquals(capturedContext.submittedFormInputResult, {
    values: { topic: "Support FAQ assistant" },
    inputRequestId: "input-request-1",
  });
  assertEquals(capturedContext.availableToolNames, ["sleep"]);
});

Deno.test("createDefaultHostedChatRuntime forwards project identity to tool execution", async () => {
  await runWithProjectRequestContext(
    {
      projectId: "project-1",
      projectSlug: "project-slug-1",
      token: "token-1",
    },
    async () => {
      clearModelProviders();
      let modelCallCount = 0;
      let capturedExecutionContext: ToolExecutionContext | undefined;

      registerModelProvider("test", () => ({
        provider: "test",
        modelId: "test/hosted-context",
        doGenerate: () => Promise.reject(new Error("unused")),
        doStream() {
          modelCallCount += 1;
          return Promise.resolve({
            stream: new ReadableStream<unknown>({
              start(controller) {
                if (modelCallCount === 1) {
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: "inspect-context-1",
                    toolName: "inspect_context",
                    input: {},
                  });
                  controller.enqueue({
                    type: "finish",
                    finishReason: "tool-calls",
                    usage: { inputTokens: 1, outputTokens: 1 },
                  });
                } else {
                  controller.enqueue({ type: "text-delta", text: "done" });
                  controller.enqueue({
                    type: "finish",
                    finishReason: "stop",
                    usage: { inputTokens: 1, outputTokens: 1 },
                  });
                }
                controller.close();
              },
            }),
          });
        },
      }));

      try {
        const runtime = await createDefaultHostedChatRuntime({
          sourceIntegrationPolicy: denyAllSourceIntegrationPolicy,
          options: {
            projectId: "project-1",
            projectSlug: "project-slug-1",
            authToken: "token-1",
            instructions: "Inspect the runtime context.",
            model: "test/hosted-context",
            allowedTools: ["inspect_context"],
          },
          config: {
            apiUrl: "https://api.example.com",
            apiMcpUrl: "https://api.example.com/mcp",
          },
          buildLocalTools: () => ({
            inspect_context: {
              ...localTool("Inspect the runtime context"),
              execute: (_input: unknown, context?: ToolExecutionContext) => {
                capturedExecutionContext = context;
                return { ok: true };
              },
            },
          }),
          createRemoteToolSource: emptyRemoteSource,
          preloadLatestConversationUserText: false,
        });

        await withMockFetch(
          () => Promise.resolve(Response.json({ tools: [] })),
          async () => {
            const result = await runtime.agent.stream({
              messages: [],
              abortSignal: new AbortController().signal,
            });
            for await (const _chunk of result.toUIMessageStream()) {
              // Consume the complete tool-call round trip.
            }
          },
        );

        assertEquals(capturedExecutionContext?.projectId, "project-1");
        assertEquals(capturedExecutionContext?.projectSlug, "project-slug-1");
      } finally {
        clearModelProviders();
      }
    },
  );
});

Deno.test("createDefaultHostedChatRuntime keeps hosted credentials out of project tools", async () => {
  clearModelProviders();
  let modelCallCount = 0;
  let providerFactoryToken: string | undefined;
  let validatorCloudToken: string | undefined;
  let validatorFilesystemToken: string | undefined;
  let toolCloudToken: string | undefined;
  let toolFilesystemToken: string | undefined;
  let receiverPreserved = false;
  let lazyResultReads = 0;
  let thrownMessageReads = 0;
  let thrownCoercionReads = 0;
  let thrownValueLeakedToken: string | undefined;

  registerModelProvider("test", () => {
    providerFactoryToken = getCurrentVeryfrontCloudContext()?.apiToken;
    return {
      provider: "test",
      modelId: "test/hosted-credential-boundary",
      doGenerate: () => Promise.reject(new Error("unused")),
      doStream() {
        modelCallCount += 1;
        return Promise.resolve({
          stream: new ReadableStream<unknown>({
            start(controller) {
              if (modelCallCount === 1) {
                for (const mode of ["result", "message", "coercion"]) {
                  controller.enqueue({
                    type: "tool-call",
                    toolCallId: `inspect-credentials-${mode}`,
                    toolName: "inspect_credentials",
                    input: { mode },
                  });
                }
                controller.enqueue({
                  type: "finish",
                  finishReason: "tool-calls",
                  usage: { inputTokens: 1, outputTokens: 1 },
                });
              } else {
                controller.enqueue({ type: "text-delta", text: "done" });
                controller.enqueue({
                  type: "finish",
                  finishReason: "stop",
                  usage: { inputTokens: 1, outputTokens: 1 },
                });
              }
              controller.close();
            },
          }),
        });
      },
    };
  });

  try {
    const runtime = await createDefaultHostedChatRuntime({
      sourceIntegrationPolicy: denyAllSourceIntegrationPolicy,
      options: {
        projectId: "project-1",
        projectSlug: "project-slug-1",
        authToken: "visitor-token",
        instructions: "Inspect the runtime credentials.",
        model: "test/hosted-credential-boundary",
        allowedTools: ["inspect_credentials"],
      },
      config: {
        apiUrl: "https://api.example.com",
        apiMcpUrl: "https://api.example.com/mcp",
      },
      buildLocalTools: () => ({
        inspect_credentials: {
          receiverMarker: "host-tool-definition",
          description: "Inspect ambient credentials",
          inputSchema: {
            parse: (value: unknown) => {
              validatorCloudToken = getCurrentVeryfrontCloudContext()?.apiToken;
              validatorFilesystemToken = getCurrentProjectRequestContext()?.token;
              return value;
            },
          },
          inputSchemaJson: {
            type: "object" as const,
            properties: {},
            additionalProperties: false,
          },
          execute(this: { receiverMarker?: string }, input: unknown) {
            receiverPreserved = this.receiverMarker === "host-tool-definition";
            toolCloudToken = getCurrentVeryfrontCloudContext()?.apiToken;
            toolFilesystemToken = getCurrentProjectRequestContext()?.token;
            const mode = (input as { mode?: unknown }).mode;
            if (mode === "message") {
              const failure = {};
              Object.defineProperty(failure, "message", {
                get: () => {
                  thrownMessageReads += 1;
                  thrownValueLeakedToken = getCurrentVeryfrontCloudContext()?.apiToken;
                  return "project failure";
                },
              });
              throw failure;
            }
            if (mode === "coercion") {
              throw {
                toString: () => {
                  thrownCoercionReads += 1;
                  thrownValueLeakedToken = getCurrentVeryfrontCloudContext()?.apiToken;
                  return "project failure";
                },
              };
            }
            const result = {
              toJSON: () => {
                lazyResultReads += 1;
                return { token: getCurrentVeryfrontCloudContext()?.apiToken };
              },
            } as { token?: string; toJSON: () => unknown };
            Object.defineProperty(result, "token", {
              enumerable: true,
              get: () => {
                lazyResultReads += 1;
                return getCurrentVeryfrontCloudContext()?.apiToken;
              },
            });
            return result;
          },
        },
      }),
      createRemoteToolSource: emptyRemoteSource,
      preloadLatestConversationUserText: false,
    });

    await withMockFetch(
      () => Promise.resolve(Response.json({ tools: [] })),
      async () => {
        const result = await runtime.agent.stream({
          messages: [],
          abortSignal: new AbortController().signal,
        });
        for await (const _chunk of result.toUIMessageStream()) {
          // Consume the complete tool-call round trip.
        }
      },
    );

    assertEquals(providerFactoryToken, "visitor-token");
    assertEquals(validatorCloudToken, undefined);
    assertEquals(validatorFilesystemToken, "");
    assertEquals(toolCloudToken, undefined);
    assertEquals(toolFilesystemToken, "");
    assertEquals(receiverPreserved, true);
    assertEquals(lazyResultReads, 0);
    assertEquals(thrownMessageReads, 0);
    assertEquals(thrownCoercionReads, 0);
    assertEquals(thrownValueLeakedToken, undefined);
  } finally {
    clearModelProviders();
  }
});

Deno.test("hosted first provider call filters skill tools for every tool selector", async () => {
  try {
    // Use the standards-reserved public documentation address so the outbound
    // guard can validate the destination before handing the request to the
    // deterministic test transport.
    const testApiOrigin = "https://93.184.216.34";
    const providerCappedToolNames = Array.from(
      { length: 129 },
      (_, index) => `provider_cap_tool_${String(index).padStart(3, "0")}`,
    );
    const cases: Array<{
      tools: true | string[] | undefined;
      allowedTools: string[];
      hostToolAllow?: string[];
      localToolNames?: string[];
      model?: string;
      sourceIntegrationPolicy?: {
        schemaVersion: 1;
        mode: "allowlist";
        integrations: Record<string, { allowedToolIds: string[] }>;
      };
      expectedPresent: string[];
      expectedAbsent: string[];
    }> = [
      {
        tools: true,
        allowedTools: ["bash"],
        expectedPresent: ["load_skill"],
        expectedAbsent: ["bash"],
      },
      {
        tools: undefined,
        allowedTools: ["bash"],
        expectedPresent: ["load_skill"],
        expectedAbsent: ["bash"],
      },
      {
        tools: ["create_release"],
        allowedTools: ["create_release", "delete_project"],
        expectedPresent: ["create_release", "load_skill"],
        expectedAbsent: ["delete_project"],
      },
      {
        tools: ["bash"],
        allowedTools: ["bash"],
        hostToolAllow: ["load_skill"],
        expectedPresent: ["load_skill"],
        expectedAbsent: ["bash"],
      },
      {
        tools: ["confluence__create_page"],
        allowedTools: ["confluence__create_page"],
        sourceIntegrationPolicy: {
          schemaVersion: 1,
          mode: "allowlist",
          integrations: { confluence: { allowedToolIds: ["search_content"] } },
        },
        expectedPresent: ["load_skill"],
        expectedAbsent: ["confluence__create_page"],
      },
      {
        tools: providerCappedToolNames,
        allowedTools: ["provider_cap_tool_128"],
        localToolNames: providerCappedToolNames,
        model: "openai/gpt-4.1",
        expectedPresent: ["load_skill"],
        expectedAbsent: ["provider_cap_tool_128"],
      },
    ];

    for (const testCase of cases) {
      let capturedProviderBody: unknown;
      const prepared = await prepareHostedChatRuntimeCreationOptions({
        request: {
          agentId: undefined,
          userId: "user-1",
          authToken: "token-1",
          messages: [],
          validatedContext: { projectId: "project-1", branchId: null },
          projectId: "project-1",
          conversationId: undefined,
          parentRunId: undefined,
          upstreamParentConversationId: undefined,
          upstreamParentRunId: undefined,
          spawnedFromToolCallId: undefined,
          model: testCase.model ?? "anthropic/claude-sonnet-4-6",
          allowDelegation: undefined,
          forwardedProps: undefined,
          runtimeOverrides: undefined,
          durableRootRun: undefined,
          persistLatestUserMessageBeforeDurableRun: false,
        },
        agentConfig: {
          id: "agent-1",
          name: "Agent",
          description: "Hosted agent",
          instructions: "Base instructions",
          ...(testCase.tools === undefined ? {} : { tools: testCase.tools }),
          skills: true,
        },
        projectId: "project-1",
        authToken: "token-1",
        resolveModelId: (modelId) => modelId,
        fetchSteering: () =>
          Promise.resolve({
            instructions: "Project instructions",
            skills: [{
              id: "deploy",
              name: "Deploy",
              description: "Deploy the project",
              instructions: "Deploy the project safely.",
              allowedTools: testCase.allowedTools,
            }],
          }),
        buildInstructions: buildVeryfrontCloudRuntimeInstructions,
        ...(testCase.hostToolAllow === undefined
          ? {}
          : { hostToolPolicy: { allow: testCase.hostToolAllow } }),
      });
      const runtime = await createDefaultHostedChatRuntime({
        sourceIntegrationPolicy: testCase.sourceIntegrationPolicy ??
          unrestrictedSourceIntegrationPolicy,
        ...(testCase.hostToolAllow === undefined
          ? {}
          : { hostToolPolicy: { allow: testCase.hostToolAllow } }),
        options: { ...prepared.creationOptions, userId: "user-1" },
        config: {
          apiUrl: testApiOrigin,
          apiMcpUrl: `${testApiOrigin}/mcp`,
        },
        buildLocalTools: () => ({
          ...Object.fromEntries(
            (testCase.localToolNames ?? []).map((toolName) => [
              toolName,
              localTool(`Run ${toolName}`),
            ]),
          ),
          bash: localTool("Run shell commands"),
          create_release: localTool("Create a release"),
          delete_project: localTool("Delete a project"),
          load_skill: localTool("Load skill"),
        }),
        createRemoteToolSource: testCase.sourceIntegrationPolicy === undefined
          ? emptyRemoteSource
          : (config) => ({
            id: config.id ?? "source",
            listTools: () =>
              Promise.resolve([{
                name: "confluence__create_page",
                description: "Create a Confluence page",
                parameters: { type: "object", properties: {} },
              }]),
            executeTool: () => Promise.resolve({ ok: true }),
          }),
        preloadLatestConversationUserText: false,
      });

      await withMockFetch(
        async (input: string | URL | Request, init?: RequestInit) => {
          const request = input instanceof Request ? input : new Request(input, init);
          if (new URL(request.url).pathname.includes("/ai/gateway/")) {
            capturedProviderBody = await request.clone().json();
          }
          return Response.json({ content: [], stop_reason: "end_turn", usage: {} });
        },
        async () => {
          const stream = await runtime.agent.stream({
            messages: [],
            abortSignal: new AbortController().signal,
          });
          for await (const _chunk of stream.toUIMessageStream()) {
            // Consume the first provider turn.
          }
        },
      );

      assertExists(capturedProviderBody);
      const providerBody = JSON.stringify(capturedProviderBody);
      assertEquals(providerBody.includes("Deploy the project"), true);
      for (const toolName of testCase.expectedPresent) {
        assertEquals(providerBody.includes(toolName), true);
      }
      for (const toolName of testCase.expectedAbsent) {
        assertEquals(providerBody.includes(toolName), false);
      }
      await runtime.cleanup();
    }
  } finally {
    await toolRegistryInternal.clearAll();
  }
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
    await toolRegistryInternal.clearAll();
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
    assertEquals(getAgent("veryfront-hosted-runtime"), undefined);
  } finally {
    toolRegistryInternal.clearAll();
    agentRegistry.delete("veryfront-hosted-runtime");
  }
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
