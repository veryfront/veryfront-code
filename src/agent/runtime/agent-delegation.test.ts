import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { AGENT_DELEGATE_TOOL_PREFIX, buildAgentDelegateTools } from "./agent-delegation.ts";

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
