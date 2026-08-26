import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { it } from "#veryfront/testing/bdd.ts";
import { registerSkill } from "#veryfront/skill/registry.ts";
import { createRuntimeAgentFromMarkdownDefinition } from "./agent-markdown-adapter.ts";
import { getEffectiveAgentSystem } from "./effective-agent-system.ts";

it("createRuntimeAgentFromMarkdownDefinition preserves provider-native tools", () => {
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

it("createRuntimeAgentFromMarkdownDefinition removes denied provider-native tools", () => {
  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition({
    id: "provider-locked",
    name: "Provider Locked",
    description: "Uses one provider tool",
    instructions: "Use only allowed provider tools.",
    providerTools: ["web_search", "web_fetch"],
    deniedTools: ["web_search"],
  });

  assertEquals(runtimeAgent.config.providerTools, ["web_fetch"]);
});

it("createRuntimeAgentFromMarkdownDefinition restores explicit tool denials", () => {
  toolRegistryInternal.clearAll();

  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition({
    id: "locked-down-md",
    name: "Locked Down",
    description: "No skill tools",
    instructions: "Do not use skill tools.",
    deniedTools: ["execute_skill_script", "load_skill", "load_skill_reference"],
  });

  assertEquals(runtimeAgent.config.tools, {
    execute_skill_script: false,
    load_skill: false,
    load_skill_reference: false,
  });
});

it("createRuntimeAgentFromMarkdownDefinition keeps denials for unrestricted selectors", () => {
  toolRegistryInternal.clearAll();

  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition({
    id: "unrestricted-locked-down-md",
    name: "Unrestricted Locked Down",
    description: "All visible tools except denied tools",
    instructions: "Do not use denied tools.",
    tools: true,
    deniedTools: ["load_skill", "web_search"],
  });

  const tools = runtimeAgent.config.tools;
  assertEquals(tools === true, false);
  assertEquals(tools && tools !== true ? tools.load_skill : undefined, false);
  assertEquals(tools && tools !== true ? tools.web_search : undefined, false);
});

it("createRuntimeAgentFromMarkdownDefinition disables skills when unrestricted tools fail closed", () => {
  toolRegistryInternal.clearAll();
  skillRegistryInternal.clearAll();
  registerSkill("project-skill", {
    id: "project-skill",
    metadata: { name: "project-skill", description: "Project skill" },
    rootPath: "/project/skills/project-skill",
  });

  try {
    const runtimeAgent = createRuntimeAgentFromMarkdownDefinition({
      id: "unrestricted-skill-locked-md",
      name: "Unrestricted Skill Locked",
      description: "Fails closed across tools and skills",
      instructions: "Do not use project capabilities.",
      tools: true,
      deniedTools: ["update_file"],
      skills: true,
    });

    assertEquals(runtimeAgent.config.skills, false);
    assertEquals(runtimeAgent.config.tools, { update_file: false });
  } finally {
    toolRegistryInternal.clearAll();
    skillRegistryInternal.clearAll();
  }
});

it("createRuntimeAgentFromMarkdownDefinition merges denials with positive tool selections", () => {
  toolRegistryInternal.clearAll();

  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition({
    id: "partially-locked-md",
    name: "Partially Locked",
    description: "Files only",
    instructions: "Use file tools, never skill scripts.",
    tools: ["get_file"],
    deniedTools: ["execute_skill_script"],
  });

  const tools = runtimeAgent.config.tools as Record<string, unknown> | undefined;
  assertEquals(tools?.get_file, true);
  assertEquals(
    tools?.execute_skill_script,
    false,
    "the denial survives next to the positive selector",
  );
});

it("createRuntimeAgentFromMarkdownDefinition binds scoped delegate tools", () => {
  toolRegistryInternal.clearAll();

  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition({
    id: "lead-delegation-test",
    name: "Lead",
    description: "Coordinates specialists",
    instructions: "Break the task down and delegate.",
    delegates: ["writer", "researcher"],
  });

  const tools = runtimeAgent.config.tools as Record<string, unknown> | undefined;
  // Delegates only: no skills are registered, so the skill tools are not
  // attached to an agent that never declared any.
  assertEquals(Object.keys(tools ?? {}).sort(), ["agent_researcher", "agent_writer"]);
  assertEquals(runtimeAgent.config.delegates, ["writer", "researcher"]);
});

it("createRuntimeAgentFromMarkdownDefinition keeps denied delegates disabled", () => {
  toolRegistryInternal.clearAll();

  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition({
    id: "locked-delegation-test",
    name: "Locked Delegation",
    description: "Coordinates one specialist",
    instructions: "Delegate only to authorized specialists.",
    delegates: ["writer", "researcher"],
    deniedTools: ["agent_writer"],
  });

  const tools = runtimeAgent.config.tools as Record<string, unknown> | undefined;
  assertEquals(runtimeAgent.config.delegates, ["researcher"]);
  assertEquals(tools?.agent_writer, false);
  assertEquals(typeof tools?.agent_researcher, "object");
});

it("createRuntimeAgentFromMarkdownDefinition suppresses delegates when all project tools fail closed", () => {
  toolRegistryInternal.clearAll();

  const runtimeAgent = createRuntimeAgentFromMarkdownDefinition({
    id: "fail-closed-delegation-test",
    name: "Fail Closed Delegation",
    description: "Does not delegate after a selector failure",
    instructions: "Do not use project tools.",
    tools: true,
    deniedTools: ["update_file"],
    delegates: ["writer"],
  });

  const tools = runtimeAgent.config.tools as Record<string, unknown> | undefined;
  assertEquals(runtimeAgent.config.delegates, []);
  assertEquals(tools?.update_file, false);
  assertEquals(tools?.agent_writer, undefined);
});

it("createRuntimeAgentFromMarkdownDefinition preserves delegates and MCP servers", () => {
  toolRegistryInternal.clearAll();

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

it("createRuntimeAgentFromMarkdownDefinition preserves explicit empty skills and hides skill tools", async () => {
  skillRegistryInternal.clearAll();
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

    assertEquals(runtimeAgent.config.tools, undefined);
    const system = getEffectiveAgentSystem(runtimeAgent);
    const prompt = typeof system === "function" ? await system() : system;
    assertEquals(prompt, [{
      role: "system",
      content: "Work alone.",
      providerOptions: {
        anthropic: {
          cacheControl: { type: "ephemeral" },
        },
      },
    }]);
  } finally {
    skillRegistryInternal.clearAll();
  }
});
