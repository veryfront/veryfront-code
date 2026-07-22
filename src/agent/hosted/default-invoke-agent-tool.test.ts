import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import type { CreateSandboxBashTool } from "#veryfront/sandbox";
import { buildChildRunResultSummary } from "../child-run/result-summary.ts";
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

Deno.test("defaultHostedInvokeAgentInputSchema accepts child-agent selection", () => {
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

Deno.test("defaultHostedInvokeAgentInputSchema requires explicit child-agent selection", async () => {
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

Deno.test("defaultHostedInvokeAgentInputSchema rejects blank child-agent selection", async () => {
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

Deno.test("defaultHostedInvokeAgentInputSchema rejects invalid result mode", async () => {
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

Deno.test("fixed hosted delegates inherit project-agent settings without overriding explicit input", () => {
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

Deno.test("default hosted invoke resolves and runs configured child against the target project", async () => {
  const captured: {
    model?: string;
    temperature?: number;
    maxSteps?: number;
    forkToolNames?: readonly string[];
    system?: string;
    prompt?: string;
  } = {};

  const result = await executeDefaultHostedInvokeAgentTool(
    createTestOptions({
      enableDurableInvokeAgent: false,
      config: { mcpServers: [] },
      options: {
        resolveChildAgentExecutionConfig: (childAgentId, projectId) => {
          assertEquals(childAgentId, "extraction-agent");
          assertEquals(projectId, "target-project");
          return Promise.resolve({
            system: "Follow the extraction policy.",
            model: "configured-model",
            temperature: 0.35,
            maxSteps: 12,
            toolNames: ["lookup_job"],
            availableSkillIds: ["extraction"],
          });
        },
        buildGlobalTools: (context, childAgentId, childConfig) => {
          assertEquals(context.projectId, "target-project");
          assertEquals(childAgentId, "extraction-agent");
          assertEquals(childConfig?.toolNames, ["lookup_job"]);
          return {
            lookup_job: {
              description: "Lookup a job posting",
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
      project_id: "target-project",
    },
    "extraction-agent",
    { toolCallId: "tool-call-configured-child" },
  );

  assertEquals("success" in result && result.success, true);
  assertEquals(captured.model, "resolved-configured-model");
  assertEquals(captured.temperature, 0.35);
  assertEquals(captured.maxSteps, 12);
  assertEquals(captured.forkToolNames, ["lookup_job"]);
  assertEquals(captured.system?.includes("Follow the extraction policy."), true);
  assertEquals(captured.system?.includes("Available Skills"), true);
  assertEquals(captured.prompt?.includes("Extract the application."), true);
});

Deno.test("executeDefaultHostedInvokeAgentTool returns durable context failure before local execution", async () => {
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

Deno.test("fixed delegates require durable execution even when legacy durable delegation is disabled", async () => {
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

Deno.test("createDefaultHostedInvokeAgentTool adds child selection guidance and resolves agent_id", async () => {
  const traceAttributes: DefaultHostedInvokeAgentTraceAttributes[] = [];
  const invokeTool = createDefaultHostedInvokeAgentTool(
    createTestOptions({ traceAttributes }),
  );

  assertStringIncludes(invokeTool.description, "agent_id is required");
  assertStringIncludes(invokeTool.description, "result_mode defaults");
  assertStringIncludes(invokeTool.description, 'use "structured"');

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

Deno.test("createDefaultHostedInvokeAgentTool treats omitted context as empty structured context", async () => {
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
