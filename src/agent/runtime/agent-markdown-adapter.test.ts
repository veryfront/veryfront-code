import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
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
