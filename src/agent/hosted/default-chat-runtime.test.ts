import { getAvailableTools } from "#veryfront/agent/runtime/tool-helpers.ts";
import {
  hasTrustedPlatformPolicyToolDefinition,
  isLoadSkillToolName,
} from "#veryfront/agent/runtime/skill-policy-enforcement.ts";
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
import { useServedCatalogForTests } from "#veryfront/provider/veryfront-cloud/catalog-client.test-helpers.ts";
import { deleteEnv, getEnv, setEnv } from "#veryfront/compat/process.ts";
import { refreshEnvironmentConfig } from "#veryfront/config/environment-config.ts";
import { clearModelProviders, type ModelRuntime, registerModelProvider } from "#veryfront/provider";
import { getCurrentVeryfrontCloudContext } from "#veryfront/provider/veryfront-cloud/context.ts";
import type {
  RemoteMCPToolSourceConfig,
  RemoteToolSource,
  ToolDefinition,
  ToolExecutionContext,
} from "#veryfront/tool";
import { toolRegistry } from "#veryfront/tool";
import { createToolsFromHostDefinitions } from "#veryfront/tool/host-tools.ts";
import {
  hasTrustedHostToolProvenance,
  markTrustedHostToolProvenance,
  markTrustedHostToolSet,
} from "#veryfront/tool/host-tool-provenance.ts";
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
  createPreparedHostedRuntimeAgent,
  type DefaultHostedChatRuntimeTaskContext,
  scopeHostedRuntimeToolResults,
  scopeHostedRuntimeTools,
} from "./default-chat-runtime.ts";
import { prepareHostedChatRuntimeCreationOptions } from "./chat-preparation.ts";
import { buildVeryfrontCloudRuntimeInstructions } from "./cloud-runtime-system-messages.ts";
import { withPlatformHostToolAliases } from "../platform-host-tools.ts";
import { markRuntimeProviderSchemaHiddenTool } from "../runtime/local-tool.ts";
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

for (const trusted of [false, true]) {
  Deno.test(`hosted tool wrappers preserve platform provenance without granting it: ${trusted}`, async () => {
    const hostTools = {
      form_input: localTool("Form"),
      load_skill: localTool("Skill"),
    };
    if (trusted) {
      markTrustedHostToolProvenance(hostTools.form_input);
      markTrustedHostToolProvenance(hostTools.load_skill);
    }
    const tools = createToolsFromHostDefinitions(hostTools);
    const resultsScoped = scopeHostedRuntimeToolResults(tools);
    const fullyScoped = scopeHostedRuntimeTools({
      tools,
      taskContext: {
        authToken: "token",
        projectId: "project",
        branchId: null,
        model: "test/model",
      },
      cloudContext: {
        apiBaseUrl: "https://api.example.com",
        apiToken: "token",
        serviceLayer: "cloud",
      },
    });
    for (const scoped of [resultsScoped, fullyScoped]) {
      assertEquals(hasTrustedHostToolProvenance(scoped.form_input), trusted);
      assertEquals(hasTrustedHostToolProvenance(scoped.load_skill), trusted);
      const definitions = await getAvailableTools(scoped, {
        includeSkillTools: true,
        includeIntegrationTools: false,
        strictConfiguredToolsOnly: true,
      });
      assertEquals(definitions.length, 2);
      for (const definition of definitions) {
        assertEquals(hasTrustedPlatformPolicyToolDefinition(definition), trusted);
      }
    }
  });
}

for (const trusted of [false, true]) {
  Deno.test(`hosted scoped skill and form results affect live policy only with provenance: ${trusted}`, async () => {
    clearModelProviders();
    const toolNamesByCall: string[][] = [];
    let calls = 0;
    registerModelProvider("test", () => ({
      provider: "test",
      modelId: `test/wrapper-policy-${trusted}`,
      doGenerate: () => Promise.reject(new Error("unused")),
      doStream(options: unknown) {
        calls++;
        const tools = typeof options === "object" && options !== null && "tools" in options
          ? options.tools
          : undefined;
        toolNamesByCall.push(
          Array.isArray(tools)
            ? tools.flatMap((tool) =>
              typeof tool === "object" && tool !== null && "name" in tool &&
                typeof tool.name === "string"
                ? [tool.name]
                : []
            )
            : [],
        );
        return Promise.resolve({
          stream: new ReadableStream<unknown>({
            start(controller) {
              if (calls <= 2) {
                controller.enqueue({
                  type: "tool-call",
                  toolCallId: `policy-${calls}`,
                  toolName: calls === 1 ? "load_skill" : "form_input",
                  input: calls === 1 ? { skillId: "review" } : {},
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
      const loadSkill = {
        description: "Load a skill",
        inputSchema: defineSchema((v) => v.object({ skillId: v.string() }))(),
        execute: () => ({
          skillId: "review",
          instructions: "# Review",
          references: [],
          scripts: ["scripts/build.sh"],
        }),
      };
      const form = {
        ...localTool("Collect input"),
        execute: () => ({
          submitted: true,
          values: { approved: true },
          inputRequestId: "input-request",
        }),
      };
      if (trusted) {
        markTrustedHostToolProvenance(loadSkill);
        markTrustedHostToolProvenance(form);
      }
      const runtime = await createDefaultHostedChatRuntime({
        sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
        options: {
          projectId: "project",
          authToken: "token",
          instructions: "Review then collect input",
          model: `test/wrapper-policy-${trusted}`,
          allowedTools: ["load_skill", "form_input", "execute_skill_script"],
        },
        config: { apiUrl: "https://api.example.com", apiMcpUrl: "https://api.example.com/mcp" },
        buildLocalTools: () => ({
          load_skill: loadSkill,
          form_input: form,
          execute_skill_script: localTool("Run loaded script"),
        }),
        createRemoteToolSource: emptyRemoteSource,
        preloadLatestConversationUserText: false,
      });
      await withMockFetch(() => Promise.resolve(Response.json({ tools: [] })), async () => {
        const result = await runtime.agent.stream({
          messages: [],
          abortSignal: new AbortController().signal,
        });
        for await (
          const _chunk of result.toUIMessageStream()
        ) { /* Complete the three-step model run. */ }
      });
      assertEquals(calls, 3);
      assertEquals(toolNamesByCall[0]?.includes("execute_skill_script"), false);
      assertEquals(toolNamesByCall[1]?.includes("execute_skill_script"), trusted);
      assertEquals(toolNamesByCall[2]?.includes("form_input"), !trusted);
      assertEquals(toolNamesByCall[2]?.includes("load_skill"), !trusted);
    } finally {
      clearModelProviders();
    }
  });
}

it("default hosted runtime executes a trusted legacy loader alias after canonical-only stream exposure", async () => {
  clearModelProviders();
  let modelCallCount = 0;
  let platformLoadSkillExecutions = 0;
  const toolNamesByCall: string[][] = [];
  registerModelProvider("test", () => ({
    provider: "test",
    modelId: "test/default-loader-trusted-legacy-alias",
    doGenerate: () => Promise.reject(new Error("unused")),
    doStream(options: unknown) {
      modelCallCount += 1;
      const tools = typeof options === "object" && options !== null && "tools" in options
        ? options.tools
        : undefined;
      toolNamesByCall.push(
        Array.isArray(tools)
          ? tools.flatMap((tool) =>
            typeof tool === "object" && tool !== null && "name" in tool &&
              typeof tool.name === "string"
              ? [tool.name]
              : []
          )
          : [],
      );
      return Promise.resolve({
        stream: new ReadableStream<unknown>({
          start(controller) {
            if (modelCallCount === 1) {
              controller.enqueue({
                type: "tool-call",
                toolCallId: "call-legacy-loader",
                toolName: "load_skill",
                input: { skillId: "build" },
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
      sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
      options: {
        projectId: "project",
        authToken: "token",
        instructions: "Use the selected loader.",
        model: "test/default-loader-trusted-legacy-alias",
        allowedTools: ["load_skill", "veryfront__load_skill", "execute_skill_script"],
        toolLoading: "deferred",
      },
      config: { apiUrl: "https://api.example.com", apiMcpUrl: "https://api.example.com/mcp" },
      buildLocalTools: () =>
        withPlatformHostToolAliases(
          markTrustedHostToolSet({
            load_skill: {
              description: "Platform load skill",
              inputSchema: defineSchema((v) => v.object({ skillId: v.string() }))(),
              execute: () => {
                platformLoadSkillExecutions += 1;
                return {
                  skillId: "build",
                  instructions: "# Build",
                  references: [],
                  scripts: ["scripts/review.sh"],
                };
              },
            },
          }),
          { execute_skill_script: localTool("Run loaded script") },
        ),
      createRemoteToolSource: emptyRemoteSource,
      preloadLatestConversationUserText: false,
    });

    await withMockFetch(() => Promise.resolve(Response.json({ tools: [] })), async () => {
      const result = await runtime.agent.stream({
        messages: [],
        abortSignal: new AbortController().signal,
      });
      for await (const _chunk of result.toUIMessageStream()) {
        // Consume the two-step model run.
      }
    });

    assertEquals(modelCallCount, 2);
    assertEquals(toolNamesByCall[0], ["veryfront__load_skill"]);
    assertEquals(toolNamesByCall[0]?.includes("load_skill"), false);
    assertEquals(platformLoadSkillExecutions, 1);
  } finally {
    clearModelProviders();
  }
});

it("prepared hosted runtime generate accepts a trusted hidden legacy loader alias after canonical-only exposure", async () => {
  clearModelProviders();
  let modelCallCount = 0;
  let platformLoadSkillExecutions = 0;
  const toolNamesByCall: string[][] = [];
  registerModelProvider("test", () => ({
    provider: "test",
    modelId: "test/prepared-loader-trusted-legacy-alias-generate",
    doStream: () => Promise.reject(new Error("unused")),
    doGenerate(options: unknown) {
      modelCallCount += 1;
      const tools = typeof options === "object" && options !== null && "tools" in options
        ? options.tools
        : undefined;
      toolNamesByCall.push(
        Array.isArray(tools)
          ? tools.flatMap((tool) =>
            typeof tool === "object" && tool !== null && "name" in tool &&
              typeof tool.name === "string"
              ? [tool.name]
              : []
          )
          : [],
      );
      if (modelCallCount === 1) {
        return Promise.resolve({
          content: [{
            type: "tool-call",
            toolCallId: "call-legacy-loader",
            toolName: "load_skill",
            input: JSON.stringify({ skillId: "build" }),
          }],
          finishReason: "tool-calls",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        });
      }
      return Promise.resolve({
        content: [{ type: "text", text: "done" }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });
    },
  }));
  try {
    const runtimeTools = createToolsFromHostDefinitions(
      withPlatformHostToolAliases(
        markTrustedHostToolSet({
          load_skill: {
            description: "Platform load skill",
            inputSchema: defineSchema((v) => v.object({ skillId: v.string() }))(),
            execute: () => {
              platformLoadSkillExecutions += 1;
              return {
                skillId: "build",
                instructions: "# Build",
                references: [],
                scripts: [],
              };
            },
          },
        }),
      ),
    );
    if (runtimeTools.load_skill !== undefined) {
      markRuntimeProviderSchemaHiddenTool(runtimeTools.load_skill);
    }
    const runtime = createPreparedHostedRuntimeAgent({
      options: {
        projectId: "project",
        instructions: "Use the selected loader.",
        model: "test/prepared-loader-trusted-legacy-alias-generate",
        allowedTools: ["load_skill", "veryfront__load_skill"],
        toolLoading: "deferred",
      },
      taskContext: {
        projectId: "project",
        branchId: null,
      },
      toolAssembly: {
        sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
        runtimeTools,
        remoteToolSources: [],
        localToolNames: ["load_skill", "veryfront__load_skill"],
        remoteToolNames: [],
        providerToolNames: [],
        availableToolNames: ["load_skill", "veryfront__load_skill"],
        modelVisibleToolNames: ["veryfront__load_skill"],
        toolLoadingMode: "deferred",
        compatibleRemoteToolNames: [],
        systemInstructions: "Use the selected loader.",
      },
      modelId: "test/prepared-loader-trusted-legacy-alias-generate",
      sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    }, {});

    await withMockFetch(() => Promise.resolve(Response.json({ tools: [] })), async () => {
      await runtime.generate({ input: "Load the build skill" });
    });

    assertEquals(modelCallCount, 2);
    assertEquals(toolNamesByCall[0], ["veryfront__load_skill"]);
    assertEquals(toolNamesByCall[0]?.includes("load_skill"), false);
    assertEquals(platformLoadSkillExecutions, 1);
  } finally {
    clearModelProviders();
  }
});

it("default hosted runtime defers a project load_skill collision after full construction", async () => {
  clearModelProviders();
  let modelCallCount = 0;
  const toolNamesByCall: string[][] = [];
  let projectLoadSkillExecutions = 0;
  registerModelProvider("test", () => ({
    provider: "test",
    modelId: "test/default-loader-project-collision",
    doGenerate: () => Promise.reject(new Error("unused")),
    doStream(options: unknown) {
      modelCallCount += 1;
      const tools = typeof options === "object" && options !== null && "tools" in options
        ? options.tools
        : undefined;
      toolNamesByCall.push(
        Array.isArray(tools)
          ? tools.flatMap((tool) =>
            typeof tool === "object" && tool !== null && "name" in tool &&
              typeof tool.name === "string"
              ? [tool.name]
              : []
          )
          : [],
      );
      return Promise.resolve({
        stream: new ReadableStream<unknown>({
          start(controller) {
            if (modelCallCount === 1) {
              controller.enqueue({
                type: "tool-call",
                toolCallId: "find-project-loader",
                toolName: "tool_search",
                input: { query: "custom" },
              });
              controller.enqueue({
                type: "finish",
                finishReason: "tool-calls",
                usage: { inputTokens: 1, outputTokens: 1 },
              });
            } else if (modelCallCount === 2) {
              controller.enqueue({
                type: "tool-call",
                toolCallId: "call-project-loader",
                toolName: "load_skill",
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
      sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
      options: {
        projectId: "project",
        authToken: "token",
        instructions: "Use the selected loader.",
        model: "test/default-loader-project-collision",
        allowedTools: ["load_skill", "veryfront__load_skill", "sleep"],
        toolLoading: "deferred",
      },
      config: { apiUrl: "https://api.example.com", apiMcpUrl: "https://api.example.com/mcp" },
      buildLocalTools: () =>
        withPlatformHostToolAliases(
          markTrustedHostToolSet({ load_skill: localTool("Platform load skill") }),
          {
            load_skill: {
              description: "Project custom loader",
              inputSchema: defineSchema((v) => v.object({}))(),
              execute: () => {
                projectLoadSkillExecutions += 1;
                return { project: true };
              },
            },
            sleep: localTool("Sleep"),
          },
        ),
      createRemoteToolSource: emptyRemoteSource,
      preloadLatestConversationUserText: false,
    });

    await withMockFetch(() => Promise.resolve(Response.json({ tools: [] })), async () => {
      const result = await runtime.agent.stream({
        messages: [],
        abortSignal: new AbortController().signal,
      });
      for await (const _chunk of result.toUIMessageStream()) {
        // Consume the single model response.
      }
    });

    assertEquals(modelCallCount, 3);
    assertEquals(toolNamesByCall[0], ["tool_search", "veryfront__load_skill"]);
    assertEquals(toolNamesByCall[1], ["load_skill", "tool_search", "veryfront__load_skill"]);
    assertEquals(projectLoadSkillExecutions, 1);
  } finally {
    clearModelProviders();
  }
});

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

  const resultScoped = scopeHostedRuntimeToolResults(tools);
  for (const wrapped of [resultScoped, scoped]) {
    assertEquals(hasTrustedHostToolProvenance(wrapped.trusted_failure), true);
    assertEquals(hasTrustedHostToolProvenance(wrapped.project_failure), false);
  }

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

function promptFromRuntimeOptions(options: unknown): unknown {
  if (typeof options !== "object" || options === null || !("prompt" in options)) {
    return undefined;
  }
  return options.prompt;
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

it("honors authored eager tool loading in the default hosted runtime", async () => {
  let capturedContext: DefaultHostedChatRuntimeTaskContext | undefined;
  await createDefaultHostedChatRuntime({
    sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
    options: {
      projectId: "project-1",
      authToken: "token-1",
      instructions: "Use eager schemas.",
      model: "openai/gpt-5.4",
      toolLoading: "eager",
    },
    config: {
      apiUrl: "https://api.example.com",
      apiMcpUrl: "https://api.example.com/mcp",
    },
    buildLocalTools: (taskContext) => {
      capturedContext = taskContext;
      return {
        beta: localTool("Beta"),
        alpha: localTool("Alpha"),
      };
    },
    createRemoteToolSource: emptyRemoteSource,
    preloadLatestConversationUserText: false,
  });

  assertExists(capturedContext);
  assertEquals(capturedContext.availableToolNames, ["alpha", "beta"]);
});

it("forwards authored tool result context to default hosted model dispatch", async () => {
  clearModelProviders();
  let modelCallCount = 0;
  let secondPrompt: unknown;
  const largeResult = { payload: "x".repeat(200) };

  registerModelProvider("test", () => ({
    provider: "test",
    modelId: "test/hosted-tool-result-context",
    doGenerate: () => Promise.reject(new Error("unused")),
    doStream(options: unknown) {
      modelCallCount += 1;
      if (modelCallCount === 2) secondPrompt = promptFromRuntimeOptions(options);
      return Promise.resolve({
        stream: new ReadableStream<unknown>({
          start(controller) {
            if (modelCallCount === 1) {
              controller.enqueue({
                type: "tool-call",
                toolCallId: "large-result-call",
                toolName: "large_result",
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
      sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
      options: {
        projectId: "project-1",
        authToken: "token-1",
        instructions: "Use bounded tool results.",
        model: "test/hosted-tool-result-context",
        allowedTools: ["large_result"],
        toolResultContext: { maxInlineBytes: 32, previewBytes: 24 },
      },
      config: {
        apiUrl: "https://api.example.com",
        apiMcpUrl: "https://api.example.com/mcp",
      },
      buildLocalTools: () => ({
        large_result: {
          ...localTool("Return a large result"),
          execute: () => largeResult,
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
          // Consume the tool-call continuation so the second model prompt is built.
        }
      },
    );

    const promptJson = JSON.stringify(secondPrompt);
    assertStringIncludes(promptJson, "tool_result_reference");
    assertEquals(promptJson.includes(largeResult.payload), false);
  } finally {
    clearModelProviders();
  }
});

it("mirrors default research artifacts through the API source when knowledge is prepended", async () => {
  clearModelProviders();
  const executions: Array<{ name: string; path: unknown }> = [];
  let modelCallCount = 0;
  const reportContent = "# Synthetic report\n\nResearch findings.";
  const apiTools: ToolDefinition[] = ["create_file", "update_file"].map((name) => ({
    name,
    description: `${name} fixture`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        content: { type: "string" },
        project_reference: { type: "string" },
      },
      required: ["path", "content", "project_reference"],
    },
  }));

  registerModelProvider("test", () => ({
    provider: "test",
    modelId: "test/default-research-mirror-source",
    doGenerate: () => Promise.reject(new Error("unused")),
    doStream() {
      modelCallCount += 1;
      return Promise.resolve({
        stream: new ReadableStream<unknown>({
          start(controller) {
            if (modelCallCount === 1) {
              controller.enqueue({
                type: "tool-call",
                toolCallId: "create-report",
                toolName: "create_file",
                input: { path: "report.md", content: reportContent },
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
      sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
      options: {
        projectId: "project-1",
        authToken: "token-1",
        instructions: "Write the default research report.",
        model: "test/default-research-mirror-source",
        allowedTools: ["create_file", "update_file", "search_knowledge"],
        knowledge: true,
        runId: "run-1",
      },
      config: {
        apiUrl: "https://api.example.com",
        apiMcpUrl: "https://api.example.com/mcp",
      },
      createTaskContext: ({ options, modelId }) => ({
        authToken: options.authToken,
        runId: options.runId,
        projectId: options.projectId ?? "",
        branchId: options.branchId ?? null,
        model: modelId,
        defaultResearchArtifacts: {
          topicSlug: "synthetic-topic",
          topicRootPath: "/research/synthetic-topic",
          currentReportPath: "/research/synthetic-topic/report.md",
          runReportPath: "/research/synthetic-topic/runs/run-1.report.md",
          findingsPath: "/research/synthetic-topic/findings.md",
          sourcesPath: "/research/synthetic-topic/sources.md",
        },
      }),
      buildLocalTools: () => ({}),
      createRemoteToolSource: (config) => ({
        id: config.id ?? "api",
        listTools: () => Promise.resolve(apiTools),
        executeTool: (name, input) => {
          const path = typeof input === "object" && input !== null && "path" in input
            ? input.path
            : undefined;
          if (name === "create_file" || name === "update_file") {
            executions.push({ name, path });
          }
          return Promise.resolve({ path });
        },
      }),
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
          // Consume the original write and the mirror callback.
        }
      },
    );

    assertEquals(executions, [
      { name: "create_file", path: "research/synthetic-topic/report.md" },
      { name: "create_file", path: "research/synthetic-topic/runs/run-1.report.md" },
    ]);
  } finally {
    clearModelProviders();
  }
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
  using _catalog = useServedCatalogForTests();
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

it("keeps the hosted runtime usable when an optional agent identity is blank", async () => {
  for (const agentId of ["", "   "]) {
    const runtime = await createDefaultHostedChatRuntime({
      sourceIntegrationPolicy: denyAllSourceIntegrationPolicy,
      options: {
        projectId: "project-1",
        authToken: "fixture-token",
        instructions: "Respond briefly.",
        model: "openai/gpt-5.4",
        agentId,
      },
      config: { apiUrl: "https://api.example.com", apiMcpUrl: "https://api.example.com/mcp" },
      buildLocalTools: () => ({}),
      createRemoteToolSource: emptyRemoteSource,
      preloadLatestConversationUserText: false,
    });
    assertExists(runtime.agent);
    await runtime.cleanup();
  }
});

for (
  const identityCase of [
    { name: "default", expected: "veryfront", resolved: undefined },
    { name: "normalized task context", expected: "canonical-agent", resolved: "canonical-agent" },
    {
      name: "removed task context identity",
      expected: "veryfront-hosted-runtime",
      resolved: undefined,
    },
    { name: "blank task context identity", expected: "veryfront-hosted-runtime", resolved: "   " },
  ]
) {
  Deno.test(`createDefaultHostedChatRuntime forwards bound identity from ${identityCase.name}`, async () => {
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
              runId: "run-bound-default-chat",
              agentId: "veryfront",
              allowedTools: ["inspect_context"],
            },
            config: {
              apiUrl: "https://api.example.com",
              apiMcpUrl: "https://api.example.com/mcp",
            },
            ...(identityCase.name === "default" ? {} : {
              createTaskContext: ({ options, modelId }) => ({
                authToken: options.authToken,
                runId: options.runId,
                agentId: identityCase.resolved,
                projectId: options.projectId ?? "",
                projectSlug: options.projectSlug,
                branchId: options.branchId ?? null,
                model: modelId,
              }),
            }),
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
          assertEquals(capturedExecutionContext?.runId, "run-bound-default-chat");
          assertEquals(capturedExecutionContext?.agentId, identityCase.expected);
        } finally {
          clearModelProviders();
        }
      },
    );
  });
}

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
          load_skill: markTrustedHostToolProvenance(localTool("Load skill")),
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
          if (/\/ai\/(?:gateway|anthropic|v1)\//.test(new URL(request.url).pathname)) {
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
  using _catalog = useServedCatalogForTests();
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
  using _catalog = useServedCatalogForTests();
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
      model: "openai/gpt-5-nano",
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
          model: "openai/gpt-5-nano",
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
          model: "openai/gpt-5-nano",
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

for (const denySkillLoader of [false, true]) {
  it(`keeps ${denySkillLoader ? "denied" : "authorized"} live steering catalog after Array.prototype.some is replaced`, async () => {
    const originalSome = Array.prototype.some;
    const originalApply = Reflect.apply;
    Array.prototype.some = function (predicate, thisArg) {
      return predicate === isLoadSkillToolName
        ? denySkillLoader
        : originalApply(originalSome, this, [predicate, thisArg]);
    };
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
          ...(denySkillLoader ? { deniedTools: ["load_skill"] } : { allowedTools: ["load_skill"] }),
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
      assertEquals(systemPrompt.includes("<available_skills>"), !denySkillLoader);
      assertEquals(systemPrompt.includes('"skillId":"deploy"'), !denySkillLoader);
    } finally {
      Array.prototype.some = originalSome;
      clearModelProviders();
    }
  });
}

it("default hosted runtime executes a hidden trusted loader alias without exposing its schema", async () => {
  clearModelProviders();
  let modelCallCount = 0;
  const toolNamesByCall: string[][] = [];
  const toolOutputs: unknown[] = [];
  let platformLoaderExecutions = 0;
  registerModelProvider("test", () => ({
    provider: "test",
    modelId: "test/default-loader-hidden-alias",
    doGenerate: () => Promise.reject(new Error("unused")),
    doStream(options: unknown) {
      modelCallCount += 1;
      const prompt = typeof options === "object" && options !== null && "prompt" in options
        ? options.prompt
        : undefined;
      if (Array.isArray(prompt)) {
        for (const message of prompt) {
          if (
            typeof message !== "object" || message === null || !("role" in message) ||
            message.role !== "tool" || !("content" in message) || !Array.isArray(message.content)
          ) continue;
          for (const part of message.content) toolOutputs.push(part);
        }
      }
      const tools = typeof options === "object" && options !== null && "tools" in options
        ? options.tools
        : undefined;
      toolNamesByCall.push(
        Array.isArray(tools)
          ? tools.flatMap((tool) =>
            typeof tool === "object" && tool !== null && "name" in tool &&
              typeof tool.name === "string"
              ? [tool.name]
              : []
          )
          : [],
      );
      return Promise.resolve({
        stream: new ReadableStream<unknown>({
          start(controller) {
            if (modelCallCount === 1) {
              controller.enqueue({
                type: "tool-call",
                toolCallId: "call-legacy-loader",
                toolName: "load_skill",
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
      sourceIntegrationPolicy: unrestrictedSourceIntegrationPolicy,
      options: {
        projectId: "project",
        authToken: "token",
        instructions: "Use the selected loader.",
        model: "test/default-loader-hidden-alias",
        toolLoading: "deferred",
      },
      config: { apiUrl: "https://api.example.com", apiMcpUrl: "https://api.example.com/mcp" },
      buildLocalTools: () =>
        withPlatformHostToolAliases(
          markTrustedHostToolSet({
            load_skill: {
              description: "Platform load skill",
              inputSchema: defineSchema((v) => v.object({}))(),
              execute: () => {
                platformLoaderExecutions += 1;
                return { loaded: true };
              },
            },
          }),
          { sleep: localTool("Sleep") },
        ),
      createRemoteToolSource: emptyRemoteSource,
      preloadLatestConversationUserText: false,
    });

    await withMockFetch(() => Promise.resolve(Response.json({ tools: [] })), async () => {
      const result = await runtime.agent.stream({
        messages: [],
        abortSignal: new AbortController().signal,
      });
      for await (const _chunk of result.toUIMessageStream()) {
        // Consume both model responses.
      }
    });

    assertEquals(modelCallCount, 2);
    assertEquals(toolNamesByCall[0], ["tool_search", "veryfront__load_skill"]);
    assertEquals(toolNamesByCall[1], ["tool_search", "veryfront__load_skill"]);
    assertEquals(platformLoaderExecutions, 1);
    assertEquals(JSON.stringify(toolOutputs).includes("not available"), false);
  } finally {
    clearModelProviders();
  }
});
