import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { toolRegistry } from "#veryfront/tool";
import { createRuntimeAgentFromMarkdownDefinition } from "./agent-markdown-adapter.ts";

Deno.test("createRuntimeAgentFromMarkdownDefinition preserves provider-native tools", () => {
  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition({
    id: "support",
    name: "Support",
    description: "Helps users",
    instructions: "Use the configured tools.",
    model: "anthropic/claude-sonnet-4-6",
    providerTools: ["web_search", "web_fetch"],
  });

  assertEquals(runtimeAgent.config.providerTools, ["web_search", "web_fetch"]);
});

Deno.test("createRuntimeAgentFromMarkdownDefinition binds delegate tools from delegates", () => {
  toolRegistry.clearAll();

  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition({
    id: "lead-delegation-test",
    name: "Lead",
    description: "Coordinates specialists",
    instructions: "Break the task down and delegate.",
    delegates: ["writer", "researcher"],
  });

  const tools = runtimeAgent.config.tools as Record<string, unknown> | undefined;
  assertEquals(
    Object.keys(tools ?? {}).sort(),
    ["agent_researcher", "agent_writer"],
  );
  assertEquals(toolRegistry.has("agent_researcher"), false);
  assertEquals(toolRegistry.has("agent_writer"), false);
});

Deno.test("createRuntimeAgentFromMarkdownDefinition binds no tools without delegates", () => {
  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition({
    id: "solo-delegation-test",
    name: "Solo",
    description: "Independent agent",
    instructions: "Work alone.",
  });

  assertEquals(runtimeAgent.config.tools, undefined);
});
