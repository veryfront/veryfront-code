import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import type { CreateSandboxBashTool } from "#veryfront/sandbox";
import { buildChildRunResultSummary } from "../child-run/result-summary.ts";
import {
  createDefaultHostedInvokeAgentTool,
  type DefaultHostedInvokeAgentContext,
  defaultHostedInvokeAgentInputSchema,
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
      enableDurableInvokeAgent: true,
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
  };
}

Deno.test("defaultHostedInvokeAgentInputSchema accepts child-agent selection", () => {
  assertEquals(
    defaultHostedInvokeAgentInputSchema.parse({
      description: "inspect auth",
      prompt: "Inspect auth flow.",
      context: {},
      agent_id: "security-reviewer",
      result_mode: "full",
    }),
    {
      description: "inspect auth",
      prompt: "Inspect auth flow.",
      context: {},
      agent_id: "security-reviewer",
      result_mode: "full",
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

Deno.test("createDefaultHostedInvokeAgentTool adds child selection guidance and resolves agent_id", async () => {
  const traceAttributes: DefaultHostedInvokeAgentTraceAttributes[] = [];
  const invokeTool = createDefaultHostedInvokeAgentTool(
    createTestOptions({ traceAttributes }),
  );

  assertStringIncludes(invokeTool.description, "agent_id is required");
  assertStringIncludes(invokeTool.description, "result_mode defaults");

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
