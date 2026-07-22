import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { toolRegistry } from "#veryfront/tool";
import { registerSkill, skillRegistry } from "#veryfront/skill/registry.ts";
import { createRuntimeAgentFromMarkdownDefinition } from "./agent-markdown-adapter.ts";
import { getEffectiveAgentSystem } from "./effective-agent-system.ts";

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

Deno.test("createRuntimeAgentFromMarkdownDefinition binds scoped delegate tools", () => {
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
    [
      "agent_researcher",
      "agent_writer",
      "execute_skill_script",
      "load_skill",
      "load_skill_reference",
    ],
  );
  assertEquals(runtimeAgent.config.delegates, ["writer", "researcher"]);
});

Deno.test("createRuntimeAgentFromMarkdownDefinition preserves delegates and MCP servers", () => {
  toolRegistry.clearAll();

  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition({
    id: "project-orchestrator",
    name: "Project Orchestrator",
    description: "Coordinates project agents",
    instructions: "Use project tools.",
    delegates: ["worker-agent"],
    mcpServers: [{
      kind: "veryfront-api",
      toolPolicy: { allow: ["get_file", "list_files"] },
    }],
    tools: ["get_file", "list_files"],
  });

  const tools = runtimeAgent.config.tools as Record<string, unknown> | undefined;
  assertEquals(typeof tools?.["agent_worker-agent"], "object");
  assertEquals(tools?.get_file, true);
  assertEquals(tools?.list_files, true);
  assertEquals(runtimeAgent.config.delegates, ["worker-agent"]);
  assertEquals(runtimeAgent.config.mcpServers, [{
    kind: "veryfront-api",
    toolPolicy: { allow: ["get_file", "list_files"] },
  }]);
});

Deno.test("createRuntimeAgentFromMarkdownDefinition preserves an empty catalog and binds skill tools", async () => {
  skillRegistry.clearAll();
  registerSkill("global-howto", {
    id: "global-howto",
    metadata: { name: "global-howto", description: "Follow the project guide" },
    rootPath: "/project/skills/global-howto",
  });
  try {
    const runtimeAgent = createRuntimeAgentFromMarkdownDefinition({
      id: "solo-delegation-test",
      name: "Solo",
      description: "Independent agent",
      instructions: "Work alone.",
      skills: [],
    });

    assertEquals(runtimeAgent.config.tools, {
      load_skill: true,
      load_skill_reference: true,
      execute_skill_script: true,
    });
    const system = getEffectiveAgentSystem(runtimeAgent);
    const prompt = typeof system === "function" ? await system() : system;
    assertEquals(prompt, "Work alone.");
  } finally {
    skillRegistry.clearAll();
  }
});
