import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import {
  AGENT_DELEGATE_TOOL_PREFIX,
  buildAgentDelegateTools,
  isProviderSafeDelegateId,
} from "./agent-delegation.ts";
import type { Agent } from "../types.ts";

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
    tools[`${AGENT_DELEGATE_TOOL_PREFIX}writer`].id,
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

  const result = await tools[`${AGENT_DELEGATE_TOOL_PREFIX}writer`].execute({ input: "Draft it." });

  assertEquals(result, { text: "drafted copy", toolCalls: 0, status: "completed" });
});

Deno.test("delegate tool reports an error when the target agent is unavailable", async () => {
  const tools = buildAgentDelegateTools({
    delegates: ["writer"],
    resolveAgent: () => undefined,
  });

  const result = await tools[`${AGENT_DELEGATE_TOOL_PREFIX}writer`].execute({ input: "Draft it." });

  assertEquals(result, {
    text: 'Delegate agent "writer" is not available.',
    toolCalls: 0,
    status: "error",
  });
});
