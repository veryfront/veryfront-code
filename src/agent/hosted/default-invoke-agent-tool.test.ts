import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertStringIncludes } from "#veryfront/testing/assert.ts";
import type { CreateSandboxBashTool } from "#veryfront/sandbox";
import {
  createDefaultHostedInvokeAgentTool,
  type DefaultHostedInvokeAgentContext,
  defaultHostedInvokeAgentInputSchema,
  type DefaultHostedInvokeAgentToolOptions,
  type DefaultHostedInvokeAgentTraceAttributes,
  executeDefaultHostedInvokeAgentTool,
} from "./default-invoke-agent-tool.ts";

const createBashTool: CreateSandboxBashTool = () => Promise.resolve({ tools: {} });

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
      agent_id: "security-reviewer",
    }),
    {
      description: "inspect auth",
      prompt: "Inspect auth flow.",
      agent_id: "security-reviewer",
    },
  );
});

Deno.test("executeDefaultHostedInvokeAgentTool returns durable context failure before local execution", async () => {
  const traceAttributes: DefaultHostedInvokeAgentTraceAttributes[] = [];
  const result = await executeDefaultHostedInvokeAgentTool(
    createTestOptions({ traceAttributes }),
    {
      description: "inspect auth",
      prompt: "Inspect auth flow.",
      agent_id: undefined,
    },
    "security-reviewer",
    { toolCallId: "tool-call-1" },
  );

  assertEquals(result, {
    ok: false,
    status: "failed",
    text:
      "invoke_agent failed: invoke_agent requires durable conversation context when durable child runs are enabled.",
    summary: {
      text:
        "invoke_agent failed: invoke_agent requires durable conversation context when durable child runs are enabled.",
    },
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

  assertStringIncludes(invokeTool.description, "Use agent_id to target");

  const result = await invokeTool.execute(
    {
      description: "inspect auth",
      prompt: "Inspect auth flow.",
      agent_id: "custom-child",
    },
    { toolCallId: "tool-call-2" },
  );

  assertEquals(result, {
    ok: false,
    status: "failed",
    text:
      "invoke_agent failed: invoke_agent requires durable conversation context when durable child runs are enabled.",
    summary: {
      text:
        "invoke_agent failed: invoke_agent requires durable conversation context when durable child runs are enabled.",
    },
    terminalErrorCode: "DURABLE_INVOKE_CONTEXT_UNAVAILABLE",
    terminalErrorMessage:
      "invoke_agent requires durable conversation context when durable child runs are enabled.",
  });
  assertEquals(traceAttributes.at(-1)?.["child.agent.id"], "custom-child");
});
