import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import {
  AGENT_DELEGATE_TOOL_PREFIX,
  buildAgentDelegateTools,
  createInvokeAgentTool,
  isProviderSafeDelegateId,
} from "./agent-delegation.ts";
import type { Agent } from "../types.ts";
import {
  getRuntimeSourceIntegrationPolicy,
  SOURCE_INTEGRATION_POLICY_CONTEXT_KEY,
} from "./runtime-tool-config.ts";
import { runWithExactSourceIntegrationPolicy } from "#veryfront/integrations/source-policy-context.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import { getAvailableTools } from "./tool-helpers.ts";
import { parseInvokeAgentStreamValue } from "#veryfront/chat/invoke-agent-stream.ts";

it("buildAgentDelegateTools exposes one tool per delegate, excluding self and dupes", () => {
  const tools = buildAgentDelegateTools({
    delegates: ["writer", "researcher", "writer", "lead", "  "],
    selfId: "lead",
    resolveAgent: () => undefined,
  });

  assertEquals(Object.keys(tools).sort(), [
    `${AGENT_DELEGATE_TOOL_PREFIX}researcher`,
    `${AGENT_DELEGATE_TOOL_PREFIX}writer`,
  ]);
  assertEquals(
    tools[`${AGENT_DELEGATE_TOOL_PREFIX}writer`]!.id,
    `${AGENT_DELEGATE_TOOL_PREFIX}writer`,
  );
});

it("buildAgentDelegateTools returns no tools when there are no delegates", () => {
  assertEquals(buildAgentDelegateTools({ delegates: [], resolveAgent: () => undefined }), {});
});

it("buildAgentDelegateTools skips ids that produce provider-unsafe tool names", () => {
  const tools = buildAgentDelegateTools({
    delegates: ["data.fetcher", "writer", "über-agent"],
    resolveAgent: () => undefined,
  });

  assertEquals(Object.keys(tools), [`${AGENT_DELEGATE_TOOL_PREFIX}writer`]);
});

it("isProviderSafeDelegateId accepts safe ids and rejects unsafe ones", () => {
  assertEquals(isProviderSafeDelegateId("writer"), true);
  assertEquals(isProviderSafeDelegateId("writer-2_b"), true);
  assertEquals(isProviderSafeDelegateId("data.fetcher"), false);
  assertEquals(isProviderSafeDelegateId("a".repeat(64)), false);
});

it("delegate tool runs the resolved specialist agent and returns its result", async () => {
  const writer = {
    id: "writer",
    config: {},
    stream: (input: { onFinish?: (response: unknown) => void }) => {
      input.onFinish?.({ text: "drafted copy", toolCalls: [], status: "completed" });
      return Promise.resolve({ toDataStreamResponse: () => new Response("") });
    },
  } as unknown as Agent;

  const tools = buildAgentDelegateTools({
    delegates: ["writer"],
    resolveAgent: (id) => (id === "writer" ? writer : undefined),
  });

  const result = await tools[`${AGENT_DELEGATE_TOOL_PREFIX}writer`]!.execute({
    input: "Draft it.",
  });

  assertEquals(result, { text: "drafted copy", toolCalls: 0, status: "completed" });
});

it("delegate tool keeps host execution fixed to its declared target", async () => {
  const writer = {
    id: "writer",
    config: {},
  } as unknown as Agent;
  const calls: unknown[] = [];
  const tools = buildAgentDelegateTools({
    delegates: ["writer"],
    resolveAgent: () => writer,
    executeDelegate: (input) => {
      calls.push(input);
      return Promise.resolve({ status: "completed" });
    },
  });

  const result = await tools[`${AGENT_DELEGATE_TOOL_PREFIX}writer`]!.execute({
    input: "Draft it.",
  });

  assertEquals(result, { status: "completed" });
  assertEquals(calls, [{
    delegateId: "writer",
    agent: writer,
    toolInput: { input: "Draft it." },
    context: undefined,
  }]);
});

it("delegate tool reports an error when the target agent is unavailable", async () => {
  const tools = buildAgentDelegateTools({
    delegates: ["writer"],
    resolveAgent: () => undefined,
  });

  const result = await tools[`${AGENT_DELEGATE_TOOL_PREFIX}writer`]!.execute({
    input: "Draft it.",
  });

  assertEquals(result, {
    text: 'Delegate agent "writer" is not available.',
    toolCalls: 0,
    status: "error",
  });
});

describe("invoke_agent", () => {
  it("resolves and runs a registered project agent", async () => {
    let streamedInput: string | undefined;
    const writer = {
      id: "writer",
      config: {},
      stream: (input: { input?: string; onFinish?: (response: unknown) => void }) => {
        streamedInput = input.input;
        input.onFinish?.({ text: "drafted copy", toolCalls: [], status: "completed" });
        return Promise.resolve({ toDataStreamResponse: () => new Response("") });
      },
    } as unknown as Agent;
    const invokeAgent = createInvokeAgentTool({
      selfId: "orchestrator",
      resolveAgent: (id) => id === "writer" ? writer : undefined,
    });

    const result = await invokeAgent.execute({
      agent_id: "writer",
      description: "Draft support reply",
      prompt: "Draft a concise reply.",
      context: { case_id: "500-test" },
    });

    assertEquals(
      streamedInput,
      'Draft a concise reply.\n\n<structured_context>\n{"case_id":"500-test"}\n</structured_context>',
    );
    assertEquals(result, { text: "drafted copy", toolCalls: 0, status: "completed" });
  });

  it("publishes child stream events to the parent tool call", async () => {
    const writer = {
      id: "writer",
      config: {},
      stream: (input: { onFinish?: (response: unknown) => void }) => {
        input.onFinish?.({ text: "hi", toolCalls: [], status: "completed" });
        return Promise.resolve({
          toDataStreamResponse: () =>
            new Response(
              'data: {"type":"text-delta","id":"child-1","delta":"hi"}\n\n',
              { headers: { "Content-Type": "text/event-stream" } },
            ),
        });
      },
    } as unknown as Agent;
    const published: unknown[] = [];
    const invokeAgent = createInvokeAgentTool({
      selfId: "orchestrator",
      resolveAgent: (id) => id === "writer" ? writer : undefined,
    });

    await invokeAgent.execute({
      agent_id: "writer",
      description: "Draft reply",
      prompt: "Draft it.",
    }, {
      toolCallId: "call-1",
      publishDataEvent: (event) => {
        published.push(event.value);
      },
    });

    assertEquals(
      published.length >= 1,
      true,
      "invoke_agent must publish child stream events to the parent tool call",
    );
    const parsed = parseInvokeAgentStreamValue(published[0]);
    assertEquals(
      parsed?.toolCallId,
      "call-1",
      "published child events must carry the parent toolCallId",
    );
    assertEquals(parsed?.agentId, "writer", "published child events must name the invoked agent");
  });

  it("reports an error when the invoked agent id is unknown", async () => {
    const invokeAgent = createInvokeAgentTool({
      selfId: "orchestrator",
      resolveAgent: () => undefined,
    });

    const result = await invokeAgent.execute({
      agent_id: "ghost",
      description: "Draft reply",
      prompt: "Draft it.",
    });

    assertEquals(
      result,
      { text: 'Agent "ghost" is not available.', toolCalls: 0, status: "error" },
      "an unresolvable agent_id must return a recoverable error result, not throw",
    );
  });

  it("rejects self-invocation", async () => {
    const invokeAgent = createInvokeAgentTool({
      selfId: "orchestrator",
      resolveAgent: () => ({ id: "orchestrator" } as unknown as Agent),
    });

    const result = await invokeAgent.execute({
      agent_id: "orchestrator",
      description: "Loop forever",
      prompt: "Invoke yourself.",
      context: {},
    });

    assertEquals(result, {
      text: 'Agent "orchestrator" cannot invoke itself.',
      toolCalls: 0,
      status: "error",
    });
  });

  it("accepts omitted optional context", async () => {
    let streamedInput: string | undefined;
    const writer = {
      id: "writer",
      config: {},
      stream: (input: { input?: string; onFinish?: (response: unknown) => void }) => {
        streamedInput = input.input;
        input.onFinish?.({ text: "done", toolCalls: [], status: "completed" });
        return Promise.resolve({ toDataStreamResponse: () => new Response("") });
      },
    } as unknown as Agent;
    const invokeAgent = createInvokeAgentTool({ resolveAgent: () => writer });

    await invokeAgent.execute({
      agent_id: "writer",
      description: "Draft reply",
      prompt: "Draft it.",
    });

    assertEquals(streamedInput, "Draft it.");
  });

  it("forwards the parent abort signal to the invoked agent", async () => {
    let streamedAbortSignal: AbortSignal | undefined;
    const writer = {
      id: "writer",
      config: {},
      stream: (input: {
        abortSignal?: AbortSignal;
        onFinish?: (response: unknown) => void;
      }) => {
        streamedAbortSignal = input.abortSignal;
        input.onFinish?.({ text: "done", toolCalls: [], status: "completed" });
        return Promise.resolve({ toDataStreamResponse: () => new Response("") });
      },
    } as unknown as Agent;
    const invokeAgent = createInvokeAgentTool({ resolveAgent: () => writer });
    const abortController = new AbortController();

    await invokeAgent.execute({
      agent_id: "writer",
      description: "Draft reply",
      prompt: "Draft it.",
    }, { abortSignal: abortController.signal });

    assertEquals(streamedAbortSignal, abortController.signal);
  });
});

it("delegate agent execution inherits the exact project source restriction", async () => {
  let observedPolicy: ReturnType<typeof getRuntimeSourceIntegrationPolicy>;
  let observedToolNames: string[] | undefined;
  const writer = {
    id: "writer",
    config: {},
    stream: async (input: { onFinish?: (response: unknown) => void }) => {
      observedPolicy = getRuntimeSourceIntegrationPolicy({
        model: "auto",
        system: "writer",
      });
      observedToolNames = (await getAvailableTools(
        { gmail__delete_email: true },
        {
          includeIntegrationTools: false,
          sourceIntegrationPolicy: observedPolicy,
        },
      )).map((definition) => definition.name);
      input.onFinish?.({ text: "drafted copy", toolCalls: [], status: "completed" });
      return { toDataStreamResponse: () => new Response("") };
    },
  } as unknown as Agent;
  const tools = buildAgentDelegateTools({
    delegates: ["writer"],
    resolveAgent: () => writer,
  });
  const policy = normalizeSourceIntegrationPolicy({
    allow: { gmail: { allowedTools: ["list_emails"] } },
  });

  await runWithExactSourceIntegrationPolicy(
    policy,
    () => tools.agent_writer!.execute({ input: "Draft it." }),
  );

  assertEquals(observedPolicy, policy);
  assertEquals(observedToolNames, []);
});

it("delegate agent execution preserves an explicit process-boundary restriction", async () => {
  let observedPolicy: ReturnType<typeof getRuntimeSourceIntegrationPolicy>;
  let observedDuringStreamConsumption: ReturnType<typeof getRuntimeSourceIntegrationPolicy>;
  const writer = {
    id: "writer",
    config: {},
    stream: async (input: { onFinish?: (response: unknown) => void }) => {
      observedPolicy = getRuntimeSourceIntegrationPolicy({
        model: "auto",
        system: "writer",
      });
      input.onFinish?.({ text: "drafted copy", toolCalls: [], status: "completed" });
      return {
        toDataStreamResponse: () => {
          observedDuringStreamConsumption = getRuntimeSourceIntegrationPolicy({
            model: "auto",
            system: "writer",
          });
          return new Response("");
        },
      };
    },
  } as unknown as Agent;
  const tools = buildAgentDelegateTools({
    delegates: ["writer"],
    resolveAgent: () => writer,
  });
  const policy = normalizeSourceIntegrationPolicy({
    allow: { gmail: { allowedTools: ["list_emails"] } },
  });

  await tools.agent_writer!.execute(
    { input: "Draft it." },
    { [SOURCE_INTEGRATION_POLICY_CONTEXT_KEY]: policy },
  );

  assertEquals(observedPolicy, policy);
  assertEquals(observedDuringStreamConsumption, policy);
});
