import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import type { CreateSandboxBashTool } from "#veryfront/sandbox";
import type { AgentSystem } from "#veryfront/agent/types.ts";
import { buildChildRunResultSummary } from "../child-run/result-summary.ts";
import { UNCONFIRMED_AGENT_PROJECT_IDENTITY_MESSAGE } from "../project/context.ts";
import {
  createHostedConversationRunChunkMirrorFromCapability,
  createHostedRunEventWriterCapability,
  getActiveHostedRunEventWriterCapability,
  runWithHostedRunEventWriterCapability,
} from "./child-run-event-writer-token.ts";
import {
  createDefaultHostedInvokeAgentTool,
  type DefaultHostedInvokeAgentConfig,
  type DefaultHostedInvokeAgentContext,
  defaultHostedInvokeAgentInputSchema,
  defaultHostedInvokeAgentToolInternals,
  type DefaultHostedInvokeAgentToolOptions,
  type DefaultHostedInvokeAgentTraceAttributes,
  executeDefaultHostedInvokeAgentTool,
} from "./default-invoke-agent-tool.ts";

const createBashTool: CreateSandboxBashTool = () => Promise.resolve({ tools: {} });
const DURABLE_CONTEXT_FAILURE_TEXT =
  "invoke_agent failed: invoke_agent requires durable conversation context when durable child runs are enabled.";

function createTestOptions(input?: {
  context?: DefaultHostedInvokeAgentContext;
  traceAttributes?: DefaultHostedInvokeAgentTraceAttributes[];
  config?: Partial<DefaultHostedInvokeAgentConfig>;
  enableDurableInvokeAgent?: boolean;
  requireDurableInvokeAgent?: boolean;
  options?: Partial<DefaultHostedInvokeAgentToolOptions<DefaultHostedInvokeAgentContext>>;
}): DefaultHostedInvokeAgentToolOptions<DefaultHostedInvokeAgentContext> {
  const traceAttributes = input?.traceAttributes ?? [];

  return {
    context: input?.context ?? {
      authToken: "token-123",
      projectId: "project-123",
      branchId: null,
      model: "sonnet",
    },
    getConfig: () => ({
      apiUrl: "https://api.example.com",
      apiMcpUrl: "https://api.example.com/mcp",
      studioMcpUrl: "https://studio.example.com/mcp",
      enableDurableInvokeAgent: input?.enableDurableInvokeAgent ?? true,
      ...input?.config,
    }),
    logger: {
      debug: () => undefined,
      info: () => undefined,
      warn: () => undefined,
      error: () => undefined,
    },
    trace: (_operationName, operation) => operation(),
    setTraceAttributes: (attributes) => {
      traceAttributes.push(attributes);
    },
    createBashTool,
    resolveModelId: (model) => `resolved-${model}`,
    resolveProvider: () => "anthropic",
    requireDurableInvokeAgent: input?.requireDurableInvokeAgent,
    ...input?.options,
  };
}

it("defaultHostedInvokeAgentInputSchema accepts child-agent selection", () => {
  assertEquals(
    defaultHostedInvokeAgentInputSchema.parse({
      description: "inspect auth",
      prompt: "Inspect auth flow.",
      context: {},
      agent_id: "security-reviewer",
      result_mode: "structured",
    }),
    {
      description: "inspect auth",
      prompt: "Inspect auth flow.",
      context: {},
      agent_id: "security-reviewer",
      result_mode: "structured",
    },
  );
});

it("defaultHostedInvokeAgentInputSchema requires explicit child-agent selection", async () => {
  await assertRejects(
    async () =>
      defaultHostedInvokeAgentInputSchema.parse({
        description: "inspect auth",
        prompt: "Inspect auth flow.",
        context: {},
      }),
    Error,
    "agent_id",
  );
});

it("defaultHostedInvokeAgentInputSchema rejects blank child-agent selection", async () => {
  await assertRejects(
    async () =>
      defaultHostedInvokeAgentInputSchema.parse({
        description: "inspect auth",
        prompt: "Inspect auth flow.",
        context: {},
        agent_id: "   ",
      }),
    Error,
    "agent_id must not be blank",
  );
});

it("defaultHostedInvokeAgentInputSchema rejects invalid result mode", async () => {
  await assertRejects(
    async () =>
      defaultHostedInvokeAgentInputSchema.parse({
        description: "inspect auth",
        prompt: "Inspect auth flow.",
        context: {},
        agent_id: "security-reviewer",
        result_mode: "verbose",
      }),
    Error,
    "result_mode",
  );
});

it("fixed hosted delegates inherit project-agent settings without overriding explicit input", () => {
  const configured = defaultHostedInvokeAgentToolInternals.applyChildAgentExecutionConfig(
    {
      description: "extract application",
      prompt: "Extract the application.",
      context: {},
      agent_id: "extraction-agent",
      model: "requested-model",
    },
    {
      system: "Follow the extraction policy.",
      model: "configured-model",
      temperature: 0.25,
      maxSteps: 12,
      thinking: 800,
      toolNames: ["get_file", "load_skill"],
      mcpServers: [],
    },
  );

  assertEquals(configured, {
    description: "extract application",
    prompt: "Extract the application.",
    context: {},
    agent_id: "extraction-agent",
    model: "requested-model",
    temperature: 0.25,
    max_steps: 12,
    thinking: 800,
    tools: ["get_file", "load_skill"],
  });
});

it("fixed hosted delegates cannot re-enable denied tools through explicit input", () => {
  const configured = defaultHostedInvokeAgentToolInternals.applyChildAgentExecutionConfig(
    {
      description: "extract application",
      prompt: "Extract the application.",
      context: {},
      agent_id: "extraction-agent",
      tools: ["get_file", "load_skill", "web_search"],
    },
    {
      system: "Follow the extraction policy.",
      toolNames: ["get_file"],
      deniedToolNames: ["load_skill", "web_search"],
      mcpServers: [],
    },
  );

  assertEquals(
    configured.tools,
    ["get_file"],
    "explicit tool requests must be capped by the child's denial ceiling",
  );
});

it("fixed hosted delegates cannot override an empty fail-closed tool ceiling", () => {
  const configured = defaultHostedInvokeAgentToolInternals.applyChildAgentExecutionConfig(
    {
      description: "extract application",
      prompt: "Extract the application.",
      context: {},
      agent_id: "extraction-agent",
      tools: ["get_file", "create_file"],
    },
    {
      system: "Follow the extraction policy.",
      toolNames: [],
      deniedToolNames: ["update_file"],
      mcpServers: [],
    },
  );

  assertEquals(configured.tools, []);
});

it("fixed hosted delegates drop denied tools from assembled fork tool sources", () => {
  const echoTool = {
    description: "Echo",
    execute: () => ({ ok: true }),
  };
  const filtered = defaultHostedInvokeAgentToolInternals.withoutDeniedForkTools(
    {
      ok: true,
      forkTools: {
        get_file: echoTool,
        load_skill: echoTool,
        "researcher--fetch-paper": { ...echoTool, shortName: "fetch-paper" },
      },
    },
    ["load_skill", "fetch-paper"],
  );

  assert(filtered.ok);
  assertEquals(Object.keys(filtered.forkTools), ["get_file"]);
});

it("fixed hosted delegates keep every explicit input over project-agent settings", () => {
  const configured = defaultHostedInvokeAgentToolInternals.applyChildAgentExecutionConfig(
    {
      description: "extract application",
      prompt: "Extract the application.",
      context: {},
      agent_id: "extraction-agent",
      model: "requested-model",
      temperature: 0.9,
      max_steps: 3,
      thinking: 100,
      tools: ["get_file"],
    },
    {
      system: "Follow the extraction policy.",
      model: "configured-model",
      temperature: 0.25,
      maxSteps: 12,
      thinking: 800,
      toolNames: ["get_file", "load_skill"],
      mcpServers: [],
    },
  );

  assertEquals(
    configured.model,
    "requested-model",
    "explicit model must not be overridden by project-agent config",
  );
  assertEquals(
    configured.temperature,
    0.9,
    "explicit temperature must not be overridden by project-agent config",
  );
  assertEquals(
    configured.max_steps,
    3,
    "explicit max_steps must not be overridden by project-agent config",
  );
  assertEquals(
    configured.thinking,
    100,
    "explicit thinking must not be overridden by project-agent config",
  );
  assertEquals(
    configured.tools,
    ["get_file"],
    "explicit tools must not be overridden by project-agent config",
  );
});

it("default hosted invoke resolves and runs configured child against the target project", async () => {
  const captured: {
    model?: string;
    temperature?: number;
    maxSteps?: number;
    forkToolNames?: readonly string[];
    system?: AgentSystem;
    prompt?: string;
  } = {};

  const result = await executeDefaultHostedInvokeAgentTool(
    createTestOptions({
      enableDurableInvokeAgent: false,
      config: { mcpServers: [] },
      options: {
        resolveProjectReference: ({ projectReference }) => {
          assertEquals(projectReference, "target-project");
          return Promise.resolve({ projectId: "target-project-id", slug: "target-project" });
        },
        resolveChildAgentExecutionConfig: (childAgentId, projectId) => {
          assertEquals(childAgentId, "extraction-agent");
          assertEquals(projectId, "target-project-id");
          return Promise.resolve({
            system: [{
              role: "system",
              content: "Follow the extraction policy.",
              providerOptions: {
                anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
              },
            }],
            model: "configured-model",
            temperature: 0.35,
            maxSteps: 12,
            toolNames: ["create_file"],
            deniedToolNames: ["update_file"],
            availableSkillIds: ["extraction"],
          });
        },
        buildGlobalTools: (context, childAgentId, childConfig) => {
          assertEquals(context.projectId, "target-project-id");
          assertEquals(childAgentId, "extraction-agent");
          assertEquals(childConfig?.toolNames, ["create_file"]);
          assertEquals(childConfig?.deniedToolNames, ["update_file"]);
          return {
            create_file: {
              description: "Create a file",
              inputSchema: {},
              execute: () => ({ ok: true }),
            },
            update_file: {
              description: "Update a file",
              inputSchema: {},
              execute: () => ({ ok: true }),
            },
            unrelated_tool: {
              description: "Should be filtered out",
              inputSchema: {},
              execute: () => ({ ok: true }),
            },
          };
        },
        createAgentServiceSandboxTools: () =>
          Promise.resolve({
            tools: {},
            sandbox: {} as never,
            closeSandbox: () => Promise.resolve(),
          }),
        startRuntime: (input) => {
          captured.model = input.forkModel;
          captured.temperature = input.temperature;
          captured.maxSteps = input.maxSteps;
          captured.forkToolNames = input.forkToolNames;
          captured.system = input.buildInstructions();
          captured.prompt = input.prompt;
          return {
            forkStreamAbortController: new AbortController(),
            childRunMonitorAbortController: null,
            childRunMonitorPromise: Promise.resolve(),
            forkToolNames: [...(input.forkToolNames ?? [])],
            streamResult: {
              fullStream: (async function* () {
                yield { type: "text-delta", text: "Configured child ran." } as const;
              })(),
              steps: Promise.resolve([
                {
                  text: "Configured child ran.",
                  finishReason: "stop",
                  messages: [],
                  toolCalls: [],
                  toolResults: [],
                },
              ]),
              totalUsage: Promise.resolve(undefined),
            },
          };
        },
      },
    }),
    {
      description: "extract application",
      prompt: "Extract the application.",
      context: {},
      agent_id: "extraction-agent",
      project_reference: "target-project",
    },
    "extraction-agent",
    { toolCallId: "tool-call-configured-child" },
  );

  assertEquals("success" in result && result.success, true);
  assertEquals(captured.model, "resolved-configured-model");
  assertEquals(captured.temperature, 0.35);
  assertEquals(captured.maxSteps, 12);
  assertEquals(captured.forkToolNames, ["create_file"]);
  assert(Array.isArray(captured.system));
  assertEquals(captured.system[0], {
    role: "system",
    content: "Follow the extraction policy.",
    providerOptions: {
      anthropic: { cacheControl: { type: "ephemeral", ttl: "1h" } },
    },
  });
  assertStringIncludes(captured.system.at(-1)?.content ?? "", "Available Skills");
  assertEquals(captured.prompt?.includes("Extract the application."), true);
});

describe("default hosted invoke agent", () => {
  it("runs a generic local child with inherited assembled tools", async () => {
    const context: DefaultHostedInvokeAgentContext = {
      authToken: "token-123",
      projectId: "project-123",
      branchId: null,
      model: "sonnet",
    };
    let capturedForkToolNames: readonly string[] | undefined;

    const result = await executeDefaultHostedInvokeAgentTool(
      createTestOptions({
        context,
        enableDurableInvokeAgent: false,
        config: { mcpServers: [] },
        options: {
          resolveChildAgentExecutionConfig: (childAgentId, projectId) => {
            assertEquals(childAgentId, "generic-agent");
            assertEquals(projectId, "project-123");
            return Promise.resolve(undefined);
          },
          buildGlobalTools: (toolContext, childAgentId, childConfig) => {
            assertEquals(toolContext.projectId, "project-123");
            assertEquals(toolContext.veryfrontInvocationContext, {
              tool_call_id: "tool-call-generic-child",
              delegation_depth: 1,
            });
            assertEquals(childAgentId, "generic-agent");
            assertEquals(childConfig, undefined);
            return {
              lookup_job: {
                description: "Lookup a job posting",
                inputSchema: {},
                execute: () => ({ ok: true }),
              },
            };
          },
          createAgentServiceSandboxTools: () =>
            Promise.resolve({
              tools: {},
              sandbox: {} as never,
              closeSandbox: () => Promise.resolve(),
            }),
          startRuntime: (input) => {
            capturedForkToolNames = input.forkToolNames;
            return {
              forkStreamAbortController: new AbortController(),
              childRunMonitorAbortController: null,
              childRunMonitorPromise: Promise.resolve(),
              forkToolNames: [...(input.forkToolNames ?? [])],
              streamResult: {
                fullStream: (async function* () {
                  yield { type: "text-delta", text: "Generic child ran." } as const;
                })(),
                steps: Promise.resolve([
                  {
                    text: "Generic child ran.",
                    finishReason: "stop",
                    messages: [],
                    toolCalls: [],
                    toolResults: [],
                  },
                ]),
                totalUsage: Promise.resolve(undefined),
              },
            };
          },
        },
      }),
      {
        description: "inspect application",
        prompt: "Inspect the application.",
        agent_id: "generic-agent",
      },
      "generic-agent",
      { toolCallId: "tool-call-generic-child" },
    );

    assertEquals("success" in result && result.success, true);
    assertEquals(capturedForkToolNames, ["lookup_job", "sleep"]);
  });
});

it("default hosted invoke rejects unconfirmed project identities before child setup", async () => {
  const context: DefaultHostedInvokeAgentContext = {
    authToken: "token-123",
    projectId: "project-123",
    projectSlug: "current-project",
    branchId: "branch-123",
    model: "sonnet",
  };
  const downstreamCalls: string[] = [];

  await assertRejects(
    () =>
      executeDefaultHostedInvokeAgentTool(
        createTestOptions({
          context,
          enableDurableInvokeAgent: false,
          options: {
            resolveProjectReference: () =>
              Promise.resolve({ projectId: " noncanonical-project-id " }),
            resolveChildAgentExecutionConfig: () => {
              downstreamCalls.push("resolve-child-config");
              return Promise.resolve(undefined);
            },
            buildGlobalTools: () => {
              downstreamCalls.push("build-tools");
              return {};
            },
            startRuntime: () => {
              downstreamCalls.push("start-runtime");
              throw new Error("unexpected runtime start");
            },
          },
        }),
        {
          description: "inspect target",
          prompt: "Inspect the target project.",
          context: {},
          agent_id: "security-reviewer",
          project_reference: "target-project",
        },
        "security-reviewer",
        { toolCallId: "tool-call-invalid-target" },
      ),
    TypeError,
    UNCONFIRMED_AGENT_PROJECT_IDENTITY_MESSAGE,
  );

  assertEquals(downstreamCalls, []);
  assertEquals(context, {
    authToken: "token-123",
    projectId: "project-123",
    projectSlug: "current-project",
    branchId: "branch-123",
    model: "sonnet",
  });
});

it("executeDefaultHostedInvokeAgentTool returns durable context failure before local execution", async () => {
  const traceAttributes: DefaultHostedInvokeAgentTraceAttributes[] = [];
  const result = await executeDefaultHostedInvokeAgentTool(
    createTestOptions({ traceAttributes }),
    {
      description: "inspect auth",
      prompt: "Inspect auth flow.",
      context: {},
      agent_id: "security-reviewer",
    },
    "security-reviewer",
    { toolCallId: "tool-call-1" },
  );

  assertEquals(result, {
    ok: false,
    status: "failed",
    text: DURABLE_CONTEXT_FAILURE_TEXT,
    summary: buildChildRunResultSummary(DURABLE_CONTEXT_FAILURE_TEXT),
    terminalErrorCode: "DURABLE_INVOKE_CONTEXT_UNAVAILABLE",
    terminalErrorMessage:
      "invoke_agent requires durable conversation context when durable child runs are enabled.",
  });
  assertEquals(traceAttributes.at(-1)?.["child.agent.id"], "security-reviewer");
  assertEquals(traceAttributes.at(-1)?.["tool.name"], "invoke_agent");
  assertEquals(traceAttributes.at(-1)?.["tool.call.id"], "tool-call-1");
});

it("fixed delegates require durable execution even when legacy durable delegation is disabled", async () => {
  const result = await executeDefaultHostedInvokeAgentTool(
    createTestOptions({
      enableDurableInvokeAgent: false,
      requireDurableInvokeAgent: true,
    }),
    {
      description: "extract application",
      prompt: "Extract the application.",
      context: {},
      agent_id: "extraction-agent",
    },
    "extraction-agent",
    { toolCallId: "tool-call-fixed-delegate" },
  );

  assertEquals(result, {
    ok: false,
    status: "failed",
    text: DURABLE_CONTEXT_FAILURE_TEXT,
    summary: buildChildRunResultSummary(DURABLE_CONTEXT_FAILURE_TEXT),
    terminalErrorCode: "DURABLE_INVOKE_CONTEXT_UNAVAILABLE",
    terminalErrorMessage:
      "invoke_agent requires durable conversation context when durable child runs are enabled.",
  });
});

it("createDefaultHostedInvokeAgentTool adds child selection guidance and resolves agent_id", async () => {
  const traceAttributes: DefaultHostedInvokeAgentTraceAttributes[] = [];
  const invokeTool = createDefaultHostedInvokeAgentTool(
    createTestOptions({ traceAttributes }),
  );

  assertStringIncludes(invokeTool.description, "agent_id is required");
  assertStringIncludes(invokeTool.description, "result_mode defaults");
  assertStringIncludes(
    invokeTool.description,
    '"structured" extracts contract ids from a bounded 128,000-character head-and-tail window',
  );

  const result = await invokeTool.execute(
    {
      description: "inspect auth",
      prompt: "Inspect auth flow.",
      context: {},
      agent_id: "custom-child",
    },
    { toolCallId: "tool-call-2" },
  );

  assertEquals(result, {
    ok: false,
    status: "failed",
    text: DURABLE_CONTEXT_FAILURE_TEXT,
    summary: buildChildRunResultSummary(DURABLE_CONTEXT_FAILURE_TEXT),
    terminalErrorCode: "DURABLE_INVOKE_CONTEXT_UNAVAILABLE",
    terminalErrorMessage:
      "invoke_agent requires durable conversation context when durable child runs are enabled.",
  });
  assertEquals(traceAttributes.at(-1)?.["child.agent.id"], "custom-child");
});

it("createDefaultHostedInvokeAgentTool treats omitted context as empty structured context", async () => {
  const traceAttributes: DefaultHostedInvokeAgentTraceAttributes[] = [];
  const invokeTool = createDefaultHostedInvokeAgentTool(
    createTestOptions({ traceAttributes }),
  );

  const result = await invokeTool.execute(
    {
      description: "load invoices",
      prompt: "Load the current supplier invoice working list.",
      agent_id: "ingest-invoice-agent",
      max_steps: 10,
    } as never,
    { toolCallId: "tool-call-missing-context" },
  );

  assertEquals(result, {
    ok: false,
    status: "failed",
    text: DURABLE_CONTEXT_FAILURE_TEXT,
    summary: buildChildRunResultSummary(DURABLE_CONTEXT_FAILURE_TEXT),
    terminalErrorCode: "DURABLE_INVOKE_CONTEXT_UNAVAILABLE",
    terminalErrorMessage:
      "invoke_agent requires durable conversation context when durable child runs are enabled.",
  });
  assertEquals(traceAttributes.at(-1)?.["child.agent.id"], "ingest-invoice-agent");
  assertEquals(traceAttributes.at(-1)?.["tool.call.id"], "tool-call-missing-context");
});

it("created invoke tools preserve distinct writer capabilities across concurrent execution", async () => {
  const originalFetch = globalThis.fetch;
  const tokenRequests: Array<{ authorization: string | null; url: string }> = [];
  const mirrorRequests: Array<{ authorization: string | null; url: string }> = [];
  const createBarrier = () => {
    let arrivals = 0;
    let release: (() => void) | undefined;
    const released = new Promise<void>((resolve) => {
      release = resolve;
    });
    return () => {
      arrivals += 1;
      if (arrivals === 2) {
        release?.();
      }
      return released;
    };
  };
  const waitForSiblingChildExchange = createBarrier();
  const waitForSiblingGrandchildExchange = createBarrier();

  try {
    globalThis.fetch = (() => {
      throw new Error("capability-backed mirrors must not use the mutable global fetch");
    }) as typeof fetch;

    const createSiblingCapability = (label: "a" | "b") => {
      let exchangeIndex = 0;
      return createHostedRunEventWriterCapability({
        apiUrl: `https://writer-${label}.example.test`,
        runId: `run_root_${label}`,
        runEventAppendToken: `root-${label}-writer-token`,
        fetch: async (input, init) => {
          const request = new Request(input, init);
          if (request.url.endsWith("/events")) {
            mirrorRequests.push({
              authorization: request.headers.get("Authorization"),
              url: request.url,
            });
            const url = new URL(request.url);
            const pathParts = url.pathname.split("/");
            const conversationId = pathParts[pathParts.indexOf("conversations") + 1];
            const runId = pathParts[pathParts.indexOf("runs") + 1];
            return Response.json({
              latestEventId: 1,
              latestExternalEventSequence: 1,
              appendedCount: 1,
              run: {
                runId,
                conversationId,
                latestEventId: 1,
                latestExternalEventSequence: 1,
              },
            });
          }
          tokenRequests.push({
            authorization: request.headers.get("Authorization"),
            url: request.url,
          });
          const isChildExchange = exchangeIndex === 0;
          exchangeIndex += 1;
          await (isChildExchange
            ? waitForSiblingChildExchange()
            : waitForSiblingGrandchildExchange());
          return Response.json(
            {
              run_event_token: isChildExchange
                ? `child-${label}-writer-token`
                : `grandchild-${label}-writer-token`,
            },
            { headers: { "Cache-Control": "no-store" } },
          );
        },
      });
    };
    const createSiblingTool = (label: "a" | "b", conversationId: string) => {
      const capability = createSiblingCapability(label);
      let executeOrdinaryTool: (() => void) | undefined;
      let executeNestedDelegation: (() => Promise<void>) | undefined;
      return runWithHostedRunEventWriterCapability(
        capability,
        () =>
          createDefaultHostedInvokeAgentTool(
            createTestOptions({
              enableDurableInvokeAgent: false,
              config: {
                apiUrl: `https://runtime-${label}.example.test`,
                mcpServers: [],
              },
              options: {
                resolveChildAgentExecutionConfig: () => {
                  assertEquals(getActiveHostedRunEventWriterCapability(), undefined);
                  return Promise.resolve(undefined);
                },
                buildGlobalTools: () => {
                  const assembledCapability = getActiveHostedRunEventWriterCapability();
                  if (!assembledCapability) {
                    throw new Error("Expected writer authority while assembling nested tools");
                  }
                  executeOrdinaryTool = () => {
                    assertEquals(getActiveHostedRunEventWriterCapability(), undefined);
                  };
                  executeNestedDelegation = async () => {
                    const childCapability = await assembledCapability
                      .mintChildRunEventWriterCapability(`run_child_${label}`);
                    await runWithHostedRunEventWriterCapability(childCapability, async () => {
                      const activeChildCapability = getActiveHostedRunEventWriterCapability();
                      const mirror = createHostedConversationRunChunkMirrorFromCapability(
                        activeChildCapability,
                        {
                          expectedRunId: `run_child_${label}`,
                          conversationId,
                          latestEventId: 0,
                          latestExternalEventSequence: 0,
                        },
                      );
                      if (!mirror || !activeChildCapability) {
                        throw new Error("Expected the child writer capability and mirror");
                      }
                      await mirror.appendEvents([
                        { type: "TEXT_MESSAGE_CONTENT", delta: `child ${label}` },
                      ]);
                      await mirror.flush();
                      mirror.dispose();
                      await activeChildCapability.mintChildRunEventWriterCapability(
                        `run_grandchild_${label}`,
                      );
                    });
                  };
                  return {};
                },
                createAgentServiceSandboxTools: () =>
                  Promise.resolve({
                    tools: {},
                    sandbox: {} as never,
                    closeSandbox: () => Promise.resolve(),
                  }),
                startRuntime: async () => {
                  assertEquals(getActiveHostedRunEventWriterCapability(), undefined);
                  if (!executeOrdinaryTool || !executeNestedDelegation) {
                    throw new Error("Expected the assembled tool closures");
                  }
                  executeOrdinaryTool();
                  await executeNestedDelegation();

                  return {
                    forkStreamAbortController: new AbortController(),
                    childRunMonitorAbortController: null,
                    childRunMonitorPromise: Promise.resolve(),
                    forkToolNames: [],
                    streamResult: {
                      fullStream: (async function* () {
                        yield { type: "text-delta", text: `child ${label} complete` } as const;
                      })(),
                      steps: Promise.resolve([
                        {
                          text: `child ${label} complete`,
                          finishReason: "stop",
                          messages: [],
                          toolCalls: [],
                          toolResults: [],
                        },
                      ]),
                      totalUsage: Promise.resolve(undefined),
                    },
                  };
                },
              },
            }),
          ),
      );
    };

    const toolA = createSiblingTool("a", "11111111-1111-4111-8111-111111111111");
    const toolB = createSiblingTool("b", "22222222-2222-4222-8222-222222222222");
    assertEquals(getActiveHostedRunEventWriterCapability(), undefined);

    await Promise.all([
      toolA.execute(
        { description: "child a", prompt: "Run child a", context: {}, agent_id: "child-a" },
        { toolCallId: "tool-call-a" },
      ),
      toolB.execute(
        { description: "child b", prompt: "Run child b", context: {}, agent_id: "child-b" },
        { toolCallId: "tool-call-b" },
      ),
    ]);

    assertEquals(getActiveHostedRunEventWriterCapability(), undefined);
    assertEquals(
      tokenRequests.toSorted((left, right) => left.url.localeCompare(right.url)),
      [
        {
          authorization: "Bearer child-a-writer-token",
          url:
            "https://writer-a.example.test/runs/run_child_a/children/run_grandchild_a/event-writer-token",
        },
        {
          authorization: "Bearer root-a-writer-token",
          url:
            "https://writer-a.example.test/runs/run_root_a/children/run_child_a/event-writer-token",
        },
        {
          authorization: "Bearer child-b-writer-token",
          url:
            "https://writer-b.example.test/runs/run_child_b/children/run_grandchild_b/event-writer-token",
        },
        {
          authorization: "Bearer root-b-writer-token",
          url:
            "https://writer-b.example.test/runs/run_root_b/children/run_child_b/event-writer-token",
        },
      ],
    );
    assertEquals(
      mirrorRequests.toSorted((left, right) => left.url.localeCompare(right.url)),
      [
        {
          authorization: "Bearer child-a-writer-token",
          url:
            "https://writer-a.example.test/conversations/11111111-1111-4111-8111-111111111111/runs/run_child_a/events",
        },
        {
          authorization: "Bearer child-b-writer-token",
          url:
            "https://writer-b.example.test/conversations/22222222-2222-4222-8222-222222222222/runs/run_child_b/events",
        },
      ],
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});
