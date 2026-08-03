import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  AGENT_DELEGATE_TOOL_PREFIX,
  buildAgentDelegateTools,
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

Deno.test("buildAgentDelegateTools exposes one tool per delegate, excluding self and dupes", () => {
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

Deno.test("buildAgentDelegateTools returns no tools when there are no delegates", () => {
  assertEquals(buildAgentDelegateTools({ delegates: [], resolveAgent: () => undefined }), {});
});

Deno.test("buildAgentDelegateTools skips ids that produce provider-unsafe tool names", () => {
  const tools = buildAgentDelegateTools({
    delegates: ["data.fetcher", "writer", "über-agent"],
    resolveAgent: () => undefined,
  });

  assertEquals(Object.keys(tools), [`${AGENT_DELEGATE_TOOL_PREFIX}writer`]);
});

Deno.test("isProviderSafeDelegateId accepts safe ids and rejects unsafe ones", () => {
  assertEquals(isProviderSafeDelegateId("writer"), true);
  assertEquals(isProviderSafeDelegateId("writer-2_b"), true);
  assertEquals(isProviderSafeDelegateId("data.fetcher"), false);
  assertEquals(isProviderSafeDelegateId("a".repeat(64)), false);
});

Deno.test("delegate tool runs the resolved specialist agent and returns its result", async () => {
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

Deno.test("delegate tool keeps host execution fixed to its declared target", async () => {
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

Deno.test("delegate tool reports an error when the target agent is unavailable", async () => {
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

Deno.test("delegate agent execution inherits the exact project source restriction", async () => {
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

Deno.test("delegate agent execution preserves an explicit process-boundary restriction", async () => {
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
