import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { tool, toolRegistry } from "#veryfront/tool";
import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { VeryfrontError } from "#veryfront/errors";
import { getEffectiveAgentSystem } from "./runtime/effective-agent-system.ts";
import { agentRegistryInternal } from "./composition/composition.ts";
import { agent } from "./factory.ts";
import type { AgentConfig, AgentResponse } from "./types.ts";
import { registerSkill, skillRegistryInternal } from "#veryfront/skill/registry.ts";
import { reset as resetExtensionContracts, tryResolve } from "#veryfront/extensions/contracts.ts";
import { createSkillTestAdapter } from "#veryfront/skill/testing.ts";
import type { ModelRuntime } from "#veryfront/provider";

function createSkill(id: string, description: string) {
  return {
    id,
    metadata: { name: id, description },
    rootPath: `/test/skills/${id}`,
  };
}

function createLoadSkillModel(skillId: string): ModelRuntime {
  let callCount = 0;
  return {
    provider: "hosted",
    modelId: `hosted/load-${skillId}`,
    async doGenerate() {
      callCount++;
      if (callCount === 1) {
        return {
          content: [{
            type: "tool-call",
            toolCallId: `load-${skillId}`,
            toolName: "load_skill",
            input: JSON.stringify({ skillId }),
          }],
          finishReason: "tool-calls",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      }
      return {
        content: [{ type: "text", text: "done" }],
        finishReason: "stop",
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      };
    },
    async doStream() {
      return {
        stream: new ReadableStream<unknown>({
          start(controller) {
            controller.enqueue({ type: "finish", finishReason: "stop" });
            controller.close();
          },
        }),
      };
    },
  };
}

describe("agent factory", () => {
  beforeEach(() => {
    agentRegistryInternal.clearAll();
    skillRegistryInternal.clearAll();
    toolRegistryInternal.clearAll();
  });

  it("bootstraps schema validation before registering universal skill tools", () => {
    resetExtensionContracts();

    const assistant = agent({ id: "schema-bootstrap", system: "Stay helpful." });

    assertEquals(typeof tryResolve<{ object: unknown }>("SchemaValidator")?.object, "function");
    assertEquals(Object.keys(assistant.config.tools ?? {}).sort(), [
      "execute_skill_script",
      "load_skill",
      "load_skill_reference",
    ]);
  });

  it("enables skill infrastructure for skill-enabled agents and defaults to visible skills", async () => {
    registerSkill(
      "support-triage",
      createSkill("support-triage", "Triage incoming support requests"),
    );
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

    assertEquals(Object.keys(assistant.config.tools ?? {}).sort(), [
      "execute_skill_script",
      "load_skill",
      "load_skill_reference",
    ]);
    assertEquals(toolRegistry.has("load_skill"), true);
    const effectiveSystem = getEffectiveAgentSystem(assistant);
    const prompt = typeof effectiveSystem === "function"
      ? await effectiveSystem()
      : effectiveSystem ?? "";
    assertStringIncludes(
      prompt,
      '- skillId="support-triage"; description="Triage incoming support requests"',
    );
    assertEquals(prompt.includes("researcher--cite"), false);

    const explicitlyEmpty = agent({
      id: "no-advertised-skills",
      system: "Do not advertise skills.",
      skills: [],
    });
    assertEquals(explicitlyEmpty.config.tools, undefined);
    const explicitlyEmptySystem = getEffectiveAgentSystem(explicitlyEmpty);
    const explicitlyEmptyPrompt = typeof explicitlyEmptySystem === "function"
      ? await explicitlyEmptySystem()
      : explicitlyEmptySystem ?? "";
    assertEquals(explicitlyEmptyPrompt.includes("## Available Skills"), false);
  });

  it("uses the same selector snapshot for prompt disclosure and direct skill tools", async () => {
    registerSkill("global-plan", createSkill("global-plan", "Plan the work"));
    registerSkill("global-review", createSkill("global-review", "Review the work"));
    registerSkill("writer--draft", {
      ...createSkill("writer--draft", "Draft copy"),
      ownerAgentId: "writer",
      shortName: "draft",
    });

    const none = agent({
      id: "no-skills",
      system: "No skills.",
      skills: [],
      tools: {
        ordinary_tool: tool({
          id: "ordinary_tool",
          description: "Ordinary tool",
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: async () => ({ ok: true }),
        }),
      },
    });
    assertEquals(Object.keys(none.config.tools ?? {}).sort(), ["ordinary_tool"]);
    const noneSystem = getEffectiveAgentSystem(none);
    assertEquals(
      (typeof noneSystem === "function" ? await noneSystem() : noneSystem ?? "").includes(
        "Available Skills",
      ),
      false,
    );

    const allowlisted = agent({
      id: "writer",
      system: "Use selected skills.",
      skills: ["draft", "global-plan"],
    });
    const allowlistedSystem = getEffectiveAgentSystem(allowlisted);
    const prompt = typeof allowlistedSystem === "function"
      ? await allowlistedSystem()
      : allowlistedSystem ?? "";

    assertStringIncludes(prompt, '- skillId="writer--draft"; description="Draft copy"');
    assertStringIncludes(prompt, '- skillId="global-plan"; description="Plan the work"');
    assertEquals(prompt.includes("global-review"), false);

    if (!allowlisted.config.tools || allowlisted.config.tools === true) {
      throw new Error("Expected a concrete skill tool map");
    }
    assertEquals(typeof allowlisted.config.tools.load_skill, "object");
    assertThrows(
      () =>
        agent({
          id: "unknown-skill-agent",
          system: "Bad config.",
          skills: ["missing"],
        }),
      Error,
      "configured skills are not available",
    );
  });

  it("enforces the skill allowlist for tools true registry execution", async () => {
    let selectedReads = 0;
    let excludedReads = 0;
    const selectedAdapter = createSkillTestAdapter({
      "/test/skills/selected/SKILL.md": `---
name: selected
description: Selected skill
---
# Selected`,
    });
    const excludedAdapter = createSkillTestAdapter({
      "/test/skills/excluded/SKILL.md": `---
name: excluded
description: Excluded skill
---
# Excluded`,
    });
    registerSkill("selected", {
      ...createSkill("selected", "Selected skill"),
      fsAdapter: {
        ...selectedAdapter,
        async readFile(path) {
          selectedReads++;
          return await selectedAdapter.readFile(path);
        },
      },
    });
    registerSkill("excluded", {
      ...createSkill("excluded", "Excluded skill"),
      fsAdapter: {
        ...excludedAdapter,
        async readFile(path) {
          excludedReads++;
          return await excludedAdapter.readFile(path);
        },
      },
    });

    async function runLoad(skillId: string): Promise<AgentResponse> {
      const assistant = agent({
        id: `tools-true-${skillId}`,
        model: "hosted/load-skill",
        system: "Load a skill.",
        tools: true,
        skills: ["selected"],
        resolveModelTransport: async () => ({ model: createLoadSkillModel(skillId) }),
      });
      return await assistant.generate({ input: `Load ${skillId}` });
    }

    const selected = await runLoad("selected");
    assertEquals(selected.toolCalls[0]?.status, "completed");
    assertEquals(selectedReads, 1);

    const excluded = await runLoad("excluded");
    assertEquals(excluded.toolCalls[0]?.status, "error");
    assertStringIncludes(excluded.toolCalls[0]?.error ?? "", "not available to this agent");
    assertEquals(excludedReads, 0);
  });

  it("does not let runtime state spoof tools true skill authorization", async () => {
    let excludedReads = 0;
    const selectedAdapter = createSkillTestAdapter({
      "/test/skills/selected/SKILL.md": `---
name: selected
description: Selected skill
---
# Selected`,
    });
    const excludedAdapter = createSkillTestAdapter({
      "/test/skills/excluded/SKILL.md": `---
name: excluded
description: Excluded skill
---
# Excluded`,
    });
    registerSkill("selected", {
      ...createSkill("selected", "Selected skill"),
      fsAdapter: selectedAdapter,
    });
    registerSkill("excluded", {
      ...createSkill("excluded", "Excluded skill"),
      fsAdapter: {
        ...excludedAdapter,
        async readFile(path) {
          excludedReads++;
          return await excludedAdapter.readFile(path);
        },
      },
    });

    const assistant = agent({
      id: "tools-true-spoofed-selector",
      model: "hosted/load-skill",
      system: "Load a skill.",
      tools: true,
      skills: ["selected"],
      resolveRuntimeState: async () => ({
        context: { allowedSkillIds: ["excluded"] },
      }),
      resolveModelTransport: async () => ({ model: createLoadSkillModel("excluded") }),
    });

    const response = await assistant.generate({ input: "Load excluded" });

    assertEquals(response.toolCalls[0]?.status, "error");
    assertStringIncludes(response.toolCalls[0]?.error ?? "", "not available to this agent");
    assertEquals(excludedReads, 0);
  });

  it("derives load_skill from skills without user-authored tools config", () => {
    registerSkill("code-review", createSkill("code-review", "Review code"));

    const assistant = agent({
      id: "skill-platform-tool-test",
      system: "Use skills when they match the task.",
      skills: ["code-review"],
    });

    assertEquals(Object.keys(assistant.config.tools ?? {}).sort(), [
      "execute_skill_script",
      "load_skill",
      "load_skill_reference",
    ]);
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
    assertEquals(typeof assistant.config.tools.load_skill_reference, "object");
    assertEquals(typeof assistant.config.tools.execute_skill_script, "object");
  });

  it("treats legacy skills false as the explicit none selector", () => {
    const assistant = agent({
      id: "universal-skill-tools",
      system: "Use skills when they match the task.",
      skills: false,
      tools: {
        load_skill: false,
        load_skill_reference: false,
        execute_skill_script: false,
      },
    });

    assertEquals(assistant.config.tools, {});
    assertEquals(assistant.config.skills, false);
  });

  it("binds one scoped tool for each declared delegate", () => {
    const assistant = agent({
      id: "orchestrator",
      system: "Delegate specialist work.",
      delegates: ["ingestion-agent"],
    });

    if (!assistant.config.tools || assistant.config.tools === true) {
      throw new Error("Expected an agent tool map");
    }
    assertEquals(typeof assistant.config.tools["agent_ingestion-agent"], "object");
    assertEquals(assistant.config.delegates, ["ingestion-agent"]);
    assertEquals(toolRegistry.has("agent_ingestion-agent"), false);
  });

  it("rejects delegates combined with the implicit all-tools selector", () => {
    assertThrows(
      () =>
        agent({
          id: "broad-orchestrator",
          system: "Delegate specialist work.",
          delegates: ["ingestion-agent"],
          tools: true,
        }),
      Error,
      "cannot combine delegates with tools: true",
    );
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
