import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { tool, toolRegistry } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { VeryfrontError } from "#veryfront/errors";
import { getEffectiveAgentSystem } from "./runtime/effective-agent-system.ts";
import { agentRegistry } from "./composition/index.ts";
import { agent } from "./factory.ts";
import type { AgentConfig } from "./types.ts";
import { registerSkill, skillRegistry } from "#veryfront/skill/registry.ts";
import { reset as resetExtensionContracts, tryResolve } from "#veryfront/extensions/contracts.ts";

describe("agent factory", () => {
  beforeEach(() => {
    agentRegistry.clearAll();
    skillRegistry.clearAll();
    toolRegistry.clearAll();
  });

  it("bootstraps schema validation before registering universal skill tools", () => {
    resetExtensionContracts();

    const assistant = agent({ id: "schema-bootstrap", system: "Stay helpful." });

    assertEquals(typeof tryResolve<{ object: unknown }>("SchemaValidator")?.object, "function");
    assertEquals(assistant.config.tools, {
      load_skill: true,
      load_skill_reference: true,
      execute_skill_script: true,
    });
  });

  it("enables skill infrastructure for every agent and defaults to visible skills", async () => {
    registerSkill("support-triage", {
      id: "support-triage",
      metadata: {
        name: "support-triage",
        description: "Triage incoming support requests",
      },
      rootPath: "/test/skills/support-triage",
    });
    registerSkill("researcher--cite", {
      id: "researcher--cite",
      metadata: { name: "cite", description: "Cite primary sources" },
      rootPath: "/test/skills/researcher--cite",
      ownerAgentId: "researcher",
      shortName: "cite",
    });

    const assistant = agent({
      id: "custom-agent",
      system: "You are a custom agent.",
    });

    assertEquals(assistant.config.tools, {
      load_skill: true,
      load_skill_reference: true,
      execute_skill_script: true,
    });
    assertEquals(toolRegistry.has("load_skill"), true);
    const effectiveSystem = getEffectiveAgentSystem(assistant);
    const prompt = typeof effectiveSystem === "function"
      ? await effectiveSystem()
      : effectiveSystem ?? "";
    assertStringIncludes(
      prompt,
      "**support-triage**: Triage incoming support requests",
    );
    assertEquals(prompt.includes("researcher--cite"), false);

    const explicitlyEmpty = agent({
      id: "no-advertised-skills",
      system: "Do not advertise skills.",
      skills: [],
    });
    assertEquals(explicitlyEmpty.config.tools, {
      load_skill: true,
      load_skill_reference: true,
      execute_skill_script: true,
    });
    const explicitlyEmptySystem = getEffectiveAgentSystem(explicitlyEmpty);
    const explicitlyEmptyPrompt = typeof explicitlyEmptySystem === "function"
      ? await explicitlyEmptySystem()
      : explicitlyEmptySystem ?? "";
    assertEquals(explicitlyEmptyPrompt.includes("## Available Skills"), false);
  });

  it("derives load_skill from skills without user-authored tools config", () => {
    const assistant = agent({
      id: "skill-platform-tool-test",
      system: "Use skills when they match the task.",
      skills: ["code-review"],
    });

    assertEquals(assistant.config.tools, {
      load_skill: true,
      load_skill_reference: true,
      execute_skill_script: true,
    });
    assertEquals(toolRegistry.has("load_skill"), true);
    assertEquals(toolRegistry.has("load-skill"), false);
  });

  it("preserves a concrete per-run load_skill tool", () => {
    const runtimeLoadSkill = tool({
      id: "load_skill",
      description: "Load a skill with request-scoped context.",
      inputSchema: defineSchema((v) => v.object({ skillId: v.string() }))(),
      execute: ({ skillId }) => Promise.resolve({ skillId }),
    });

    const assistant = agent({
      id: "hosted-skill-tool",
      system: "Use request-scoped skills.",
      tools: { load_skill: runtimeLoadSkill },
    });

    if (!assistant.config.tools || assistant.config.tools === true) {
      throw new Error("Expected an agent tool map");
    }
    assertStrictEquals(assistant.config.tools.load_skill, runtimeLoadSkill);
    assertEquals(assistant.config.tools.load_skill_reference, true);
    assertEquals(assistant.config.tools.execute_skill_script, true);
  });

  it("uses the default system prompt before an available skill catalog", async () => {
    registerSkill("support-triage", {
      id: "support-triage",
      metadata: {
        name: "support-triage",
        description: "Triage incoming support requests",
      },
      rootPath: "/test/skills/support-triage",
    });

    const assistant = agent({ id: "default-system-with-skills" } as AgentConfig);
    const effectiveSystem = getEffectiveAgentSystem(assistant);
    const prompt = typeof effectiveSystem === "function"
      ? await effectiveSystem()
      : effectiveSystem ?? "";

    assertEquals(prompt.startsWith("You are a helpful assistant."), true);
    assertEquals(prompt.includes("undefined"), false);
    assertStringIncludes(prompt, "## Available Skills");
  });

  it("rejects inline local tools in the reserved integration namespace", () => {
    const localIntegrationShadow = tool({
      id: "gmail__list_emails",
      description: "Local integration shadow",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: async () => [],
    });

    assertThrows(
      () =>
        agent({
          id: "integration-shadow-agent",
          model: "auto",
          system: "Test.",
          tools: { gmail__list_emails: localIntegrationShadow },
        }),
      VeryfrontError,
      "reserved integration tool namespace",
    );
  });
});
