import { runWithVeryfrontCloudContext } from "#veryfront/provider/veryfront-cloud/context.ts";
import { toolRegistryInternal } from "#veryfront/tool/registry.ts";
import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import "#veryfront/schemas/_test-setup.ts";
import {
  assertEquals,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { type RemoteToolSource, tool, toolRegistry } from "#veryfront/tool";
import { defineSchema } from "#veryfront/schemas/index.ts";
import { VeryfrontError } from "#veryfront/errors";
import { getEffectiveAgentSystem } from "./runtime/effective-agent-system.ts";
import { getAvailableTools } from "./runtime/tool-helpers.ts";
import { agentRegistry } from "./composition/index.ts";
import { agent, createEphemeralAgentWithRuntimeOptions } from "./factory.ts";
import { resolveSkillToolDisposition } from "./skill-tool-disposition.ts";
import { isSkillInfrastructureToolId } from "#veryfront/skill/types.ts";
import type { AgentConfig, AgentResponse } from "./types.ts";
import { flattenSystemInstructions } from "./runtime/tool-inventory.ts";
import { registerSkill } from "#veryfront/skill/registry.ts";
import { reset as resetExtensionContracts, tryResolve } from "#veryfront/extensions/contracts.ts";
import { createSkillTestAdapter } from "#veryfront/skill/testing.ts";
import type { ModelRuntime, ModelRuntimeCallOptions } from "#veryfront/provider/types.ts";
import { scriptedModel } from "./runtime/model-runtime.test-helpers.ts";
import { DEFAULT_MAX_BODY_SIZE_BYTES } from "#veryfront/utils/constants/index.ts";

function createSkill(id: string, description: string) {
  return {
    id,
    metadata: { name: id, description },
    rootPath: `/test/skills/${id}`,
  };
}

async function resolveSystemText(system: AgentConfig["system"]): Promise<string> {
  const resolved = typeof system === "function" ? await system() : system;
  return typeof resolved === "string" ? resolved : flattenSystemInstructions(resolved);
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
  it("requires an explicit catalog when framework construction preserves tool authority", () => {
    for (
      const config of [
        { id: "strict-catalog", tools: true as const },
        { id: "strict-catalog", tools: {}, delegates: ["another-agent"] },
      ]
    ) {
      assertThrows(
        () =>
          createEphemeralAgentWithRuntimeOptions({ ...config, system: "Synthetic" }, {
            preserveToolCatalog: true,
          }),
        TypeError,
        "explicit tool catalog",
      );
    }
  });

  beforeEach(() => {
    agentRegistry.clearAll();
    skillRegistryInternal.clearAll();
    toolRegistryInternal.clearAll();
  });

  it("ignores another agent's owned search_knowledge tool for tools true knowledge agents", () => {
    toolRegistryInternal.register("search_knowledge", {
      ...tool({
        id: "search_knowledge",
        description: "Foreign owned knowledge search",
        inputSchema: defineSchema((v) => v.object({}))(),
        execute: () => ({ ok: true }),
      }),
      ownerAgentId: "other-agent",
    });

    const assistant = agent({
      id: "knowledge-owner",
      system: "Use scoped knowledge.",
      tools: true,
      knowledge: true,
      skills: [],
    });

    assertEquals(assistant.id, "knowledge-owner");
  });

  it("rejects visible registered search_knowledge tools for tools true knowledge agents", () => {
    for (
      const [registeredOwner, expectedAgentId] of [
        [undefined, "global-collision-agent"],
        ["own-collision-agent", "own-collision-agent"],
      ] as const
    ) {
      toolRegistryInternal.clearAll();
      toolRegistryInternal.register("search_knowledge", {
        ...tool({
          id: "search_knowledge",
          description: `Visible knowledge search ${expectedAgentId}`,
          inputSchema: defineSchema((v) => v.object({}))(),
          execute: () => ({ ok: true }),
        }),
        ...(registeredOwner === undefined ? {} : { ownerAgentId: registeredOwner }),
      });

      assertThrows(
        () =>
          agent({
            id: expectedAgentId,
            system: "Use scoped knowledge.",
            tools: true,
            knowledge: true,
            skills: [],
          }),
        Error,
        "registered search_knowledge tool conflicts with the agent knowledge scope",
      );
    }
  });

  it("exposes one eager framework knowledge schema for tools true agents", async () => {
    const model = scriptedModel([{ text: "done" }], {
      modelId: "hosted/eager-knowledge-catalog",
      only: "generate",
    });
    const assistant = agent({
      id: "eager-knowledge-catalog-agent",
      model: "hosted/eager-knowledge-catalog",
      system: "Use scoped knowledge.",
      tools: true,
      toolLoading: "eager",
      knowledge: true,
      skills: [],
      resolveModelTransport: async () => ({ model }),
    });

    await assistant.generate({ input: "List available knowledge tools" });

    const names = model.toolNames(0);
    assertEquals(names.filter((name) => name === "search_knowledge").length, 1);
  });

  it("loads one deferred framework knowledge schema for tools true agents", async () => {
    const model = scriptedModel([
      {
        toolCalls: [{
          id: "load-knowledge",
          name: "tool_search",
          input: { query: "search_knowledge" },
        }],
      },
      { text: "done" },
    ], {
      modelId: "hosted/deferred-knowledge-catalog",
      only: "generate",
    });
    const assistant = agent({
      id: "deferred-knowledge-catalog-agent",
      model: "hosted/deferred-knowledge-catalog",
      system: "Use scoped knowledge.",
      tools: true,
      toolLoading: "deferred",
      knowledge: true,
      skills: [],
      maxSteps: 3,
      resolveModelTransport: async () => ({ model }),
    });

    await assistant.generate({ input: "Load the knowledge tool" });

    assertEquals(model.toolNames(0).filter((name) => name === "search_knowledge").length, 0);
    assertEquals(model.toolNames(1).filter((name) => name === "search_knowledge").length, 1);
  });

  it("keeps tools true knowledge scoped when search_knowledge registers later", async () => {
    let modelCalls = 0;
    let unscopedCalls = 0;
    const assistant = agent({
      id: "late-registry-knowledge-agent",
      model: "hosted/late-knowledge",
      system: "Use scoped knowledge.",
      tools: true,
      knowledge: { "knowledge/public/**": true },
      skills: [],
      resolveModelTransport: async () => ({
        model: {
          provider: "hosted",
          modelId: "hosted/late-knowledge",
          async doGenerate() {
            modelCalls++;
            if (modelCalls === 1) {
              return {
                content: [{
                  type: "tool-call",
                  toolCallId: "search-late-knowledge",
                  toolName: "search_knowledge",
                  input: JSON.stringify({ query: "support", limit: 1 }),
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
            throw new Error("Unexpected stream");
          },
        },
      }),
    });

    toolRegistryInternal.register("search_knowledge", {
      ...tool({
        id: "search_knowledge",
        description: "Late unscoped knowledge search",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
        execute: () => {
          unscopedCalls++;
          return { unscoped: true };
        },
      }),
    });

    const response = await assistant.generate({ input: "Search support knowledge" });

    assertEquals(response.toolCalls[0]?.status, "error");
    assertEquals(unscopedCalls, 0);
    assertEquals(JSON.stringify(response.toolCalls).includes("unscoped"), false);
  });

  it("rejects late sibling remote search_knowledge collisions before dispatch", async () => {
    let siblingListCalls = 0;
    let siblingExecuted = false;
    const siblingSource: RemoteToolSource = {
      id: "late-sibling-knowledge",
      listTools: () => {
        siblingListCalls++;
        return Promise.resolve(
          siblingListCalls >= 3
            ? [{
              name: "search_knowledge",
              description: "Late sibling knowledge search",
              parameters: { type: "object", properties: {} },
            }]
            : [],
        );
      },
      executeTool: () => {
        siblingExecuted = true;
        return Promise.resolve({ unscoped: true });
      },
    };
    const model = scriptedModel([
      {
        toolCalls: [{
          id: "late-sibling-search",
          name: "search_knowledge",
          input: { query: "support", limit: 1 },
        }],
      },
      { text: "done" },
    ], {
      modelId: "hosted/late-sibling-knowledge",
      only: "generate",
    });
    const config: AgentConfig & { __vfRemoteToolSources: RemoteToolSource[] } = {
      id: "late-sibling-knowledge-agent",
      model: "hosted/late-sibling-knowledge",
      system: "Use scoped knowledge.",
      tools: true,
      toolLoading: "eager",
      knowledge: true,
      skills: [],
      maxSteps: 2,
      __vfRemoteToolSources: [siblingSource],
      resolveModelTransport: async () => ({ model }),
    };
    const assistant = agent(config);

    const response = await assistant.generate({ input: "Search support knowledge" });

    assertEquals(response.toolCalls[0]?.status, "error");
    assertStringIncludes(
      response.toolCalls[0]?.error ?? "",
      'Remote tool "search_knowledge" conflicts with the agent knowledge scope',
    );
    assertEquals(siblingExecuted, false);
  });

  it("keeps streamed tools true knowledge scoped when search_knowledge registers later", async () => {
    let modelCalls = 0;
    let unscopedCalls = 0;
    const assistant = agent({
      id: "late-registry-stream-knowledge-agent",
      model: "hosted/late-stream-knowledge",
      system: "Use scoped knowledge.",
      tools: true,
      knowledge: { "knowledge/public/**": true },
      skills: [],
      resolveModelTransport: async () => ({
        model: {
          provider: "hosted",
          modelId: "hosted/late-stream-knowledge",
          async doGenerate() {
            throw new Error("Unexpected generate");
          },
          async doStream() {
            modelCalls++;
            return {
              stream: new ReadableStream<unknown>({
                start(controller) {
                  if (modelCalls === 1) {
                    controller.enqueue({
                      type: "tool-call",
                      toolCallId: "search-late-stream-knowledge",
                      toolName: "search_knowledge",
                      input: { query: "support", limit: 1 },
                    });
                    controller.enqueue({
                      type: "finish",
                      finishReason: "tool-calls",
                      usage: { inputTokens: 1, outputTokens: 1 },
                    });
                  } else {
                    controller.enqueue({ type: "text-delta", id: "text-1", delta: "done" });
                    controller.enqueue({
                      type: "finish",
                      finishReason: "stop",
                      usage: { inputTokens: 1, outputTokens: 1 },
                    });
                  }
                  controller.close();
                },
              }),
            };
          },
        },
      }),
    });

    toolRegistryInternal.register("search_knowledge", {
      ...tool({
        id: "search_knowledge",
        description: "Late unscoped knowledge search",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
        execute: () => {
          unscopedCalls++;
          return { unscoped: true };
        },
      }),
    });

    const response = await assistant.stream({ input: "Search support knowledge" });
    const body = await response.toDataStreamResponse().text();

    assertEquals(unscopedCalls, 0);
    assertEquals(body.includes("unscoped"), false);
  });

  it("replaces explicit boolean knowledge bindings with the scoped framework tool", async () => {
    let unscopedCalls = 0;
    toolRegistryInternal.register("search_knowledge", {
      ...tool({
        id: "search_knowledge",
        description: "Unscoped registry knowledge search",
        inputSchema: defineSchema((v) => v.object({ query: v.string() }))(),
        execute: () => {
          unscopedCalls++;
          return { unscoped: true };
        },
      }),
    });

    const assistant = agent({
      id: "map-scoped-knowledge",
      system: "Use scoped knowledge.",
      tools: { search_knowledge: true },
      knowledge: {
        "knowledge/public/**": true,
        "knowledge/private/**": false,
      },
      skills: [],
    });

    if (!assistant.config.tools || assistant.config.tools === true) {
      throw new Error("Expected a concrete scoped knowledge tool map");
    }

    const scopedKnowledgeTool = assistant.config.tools.search_knowledge;
    if (!scopedKnowledgeTool || typeof scopedKnowledgeTool !== "object") {
      throw new Error("Expected scoped search_knowledge tool");
    }
    assertEquals(scopedKnowledgeTool === toolRegistry.get("search_knowledge"), false);
    const definitions = await getAvailableTools(assistant.config.tools);
    assertEquals(definitions.map((definition) => definition.name), ["search_knowledge"]);
    const result = await scopedKnowledgeTool.execute({ query: "policy", limit: 1 });
    assertEquals(unscopedCalls, 0);
    assertEquals(JSON.stringify(result).includes("unscoped"), false);
  });

  it("preserves knowledge denials and rejects concrete search_knowledge collisions", () => {
    const denied = agent({
      id: "denied-scoped-knowledge",
      system: "Do not search knowledge.",
      tools: { search_knowledge: false },
      knowledge: true,
      skills: [],
    });
    assertEquals(denied.config.tools, { search_knowledge: false });

    const customKnowledgeTool = tool({
      id: "search_knowledge",
      description: "Custom knowledge search",
      inputSchema: defineSchema((v) => v.object({}))(),
      execute: () => ({ ok: true }),
    });

    assertThrows(
      () =>
        agent({
          id: "custom-knowledge-collision",
          system: "Use scoped knowledge.",
          tools: { search_knowledge: customKnowledgeTool },
          knowledge: true,
          skills: [],
        }),
      Error,
      "custom search_knowledge tool conflicts with the agent knowledge scope",
    );
  });

  it("rejects empty explicit identities and preserves valid or generated identities", () => {
    for (const id of ["", "   ", "\t\n"]) {
      assertThrows(() => agent({ id, system: "Synthetic" }), Error, "Agent id cannot be empty");
    }
    assertEquals(agent({ id: "bound-agent", system: "Synthetic" }).id, "bound-agent");
    assertEquals(typeof agent({ system: "Synthetic" }).id, "string");
  });

  it("bootstraps schema validation before registering universal skill tools", () => {
    resetExtensionContracts();
    registerSkill("support-triage", createSkill("support-triage", "Triage support requests"));

    const assistant = agent({ id: "schema-bootstrap", system: "Stay helpful." });

    assertEquals(typeof tryResolve<{ object: unknown }>("SchemaValidator")?.object, "function");
    assertEquals(Object.keys(assistant.config.tools ?? {}).sort(), [
      "execute_skill_script",
      "load_skill",
      "load_skill_reference",
    ]);
  });

  it("does not attach skill tools to an agent that never mentioned skills", () => {
    // Undeclared `skills` means "every visible skill". With no skills
    // registered that is nothing, so the three skill tools were being sent on
    // every request to answer "no such skill" and nothing else.
    const assistant = agent({ id: "no-skills-anywhere", system: "Stay helpful." });

    assertEquals(assistant.config.tools, undefined);
  });

  it("honours a skill tool configured as `true` rather than dropping it", () => {
    // `load_skill: true` asks for the framework's own tool by name. That is as
    // explicit a request for the skill infrastructure as passing a concrete
    // tool, so it must not be read as "nothing declared skills".
    const assistant = agent({
      id: "boolean-skill-tool",
      system: "Stay helpful.",
      tools: { load_skill: true },
    });

    assertEquals(Object.keys(assistant.config.tools ?? {}).sort(), [
      "execute_skill_script",
      "load_skill",
      "load_skill_reference",
    ]);
  });

  it("applies the same rule to a `tools: true` agent, per step", async () => {
    // A concrete tool map is resolved once at construction; `tools: true` draws
    // from the registry on every step. Both must agree, or a bare agent keeps
    // load_skill on one path and loses it on the other.
    const assistant = agent({ id: "everything-agent", system: "Stay helpful.", tools: true });

    const withoutSkills = await getAvailableTools(assistant.config.tools, {
      includeSkillTools:
        resolveSkillToolDisposition(assistant.config, "everything-agent") === "inject",
    });
    assertEquals(withoutSkills.filter((t) => isSkillInfrastructureToolId(t.name)), []);

    // Asking per step also means this path sees skills registered after the
    // agent was constructed.
    registerSkill("late-arrival", createSkill("late-arrival", "Registered after the agent"));
    const withSkills = await getAvailableTools(assistant.config.tools, {
      includeSkillTools:
        resolveSkillToolDisposition(assistant.config, "everything-agent") === "inject",
    });
    assertEquals(
      withSkills.filter((t) => isSkillInfrastructureToolId(t.name)).map((t) => t.name).sort(),
      ["execute_skill_script", "load_skill", "load_skill_reference"],
    );
  });

  it("keeps skill tools for an agent that opted in before any skill registered", () => {
    // `skills: true` is intent, not inference: the author may be registering
    // skills later, and stripping the tools would silently break them.
    const optedIn = agent({ id: "opted-in-early", system: "Stay helpful.", skills: true });

    assertEquals(Object.keys(optedIn.config.tools ?? {}).sort(), [
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
    const prompt = await resolveSystemText(effectiveSystem);
    assertStringIncludes(
      prompt,
      '- {"skillId":"support-triage","description":"Triage incoming support requests"}',
    );
    assertEquals(prompt.includes("researcher--cite"), false);

    const explicitlyEmpty = agent({
      id: "no-advertised-skills",
      system: "Do not advertise skills.",
      skills: [],
    });
    assertEquals(explicitlyEmpty.config.tools, undefined);
    const explicitlyEmptySystem = getEffectiveAgentSystem(explicitlyEmpty);
    const explicitlyEmptyPrompt = await resolveSystemText(explicitlyEmptySystem);
    assertEquals(explicitlyEmptyPrompt.includes("<available_skills>"), false);
  });

  it("preserves pre-rendered generated skill catalogs when no selector replaces them", async () => {
    const hostedSystem = [{
      role: "system" as const,
      content:
        'Base\n\n<available_skills>\n- {"skillId":"deploy","description":"Deploy the project"}\n</available_skills>',
    }];
    const assistant = agent(
      {
        id: "hosted-pre-rendered-skills",
        system: hostedSystem,
        __vfPreassembledSkillContext: true,
      } as AgentConfig & { __vfPreassembledSkillContext: boolean },
    );

    const effectiveSystem = getEffectiveAgentSystem(assistant);
    const prompt = await resolveSystemText(effectiveSystem);

    assertStringIncludes(prompt, "Deploy the project");
    assertStringIncludes(prompt, "<available_skills>");
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
      (await resolveSystemText(noneSystem)).includes(
        "available_skills",
      ),
      false,
    );

    const allowlisted = agent({
      id: "writer",
      system: "Use selected skills.",
      skills: ["draft", "global-plan"],
    });
    const allowlistedSystem = getEffectiveAgentSystem(allowlisted);
    const prompt = await resolveSystemText(allowlistedSystem);

    assertStringIncludes(prompt, '- {"skillId":"writer--draft","description":"Draft copy"}');
    assertStringIncludes(prompt, '- {"skillId":"global-plan","description":"Plan the work"}');
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
        async readFileBytesWithinLimit(path, byteLimit) {
          selectedReads++;
          return await selectedAdapter.readFileBytesWithinLimit!(path, byteLimit);
        },
      },
    });
    registerSkill("excluded", {
      ...createSkill("excluded", "Excluded skill"),
      fsAdapter: {
        ...excludedAdapter,
        async readFileBytesWithinLimit(path, byteLimit) {
          excludedReads++;
          return await excludedAdapter.readFileBytesWithinLimit!(path, byteLimit);
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
        async readFileBytesWithinLimit(path, byteLimit) {
          excludedReads++;
          return await excludedAdapter.readFileBytesWithinLimit!(path, byteLimit);
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

    assertEquals(assistant.config.tools, {
      load_skill: false,
      load_skill_reference: false,
      execute_skill_script: false,
    });
    assertEquals(assistant.config.skills, false);
  });

  it("treats empty and exclusion-only skill maps as explicit none selectors", () => {
    const skillSelectors: AgentConfig["skills"][] = [{}, { "support-*": false }];
    for (const skills of skillSelectors) {
      const assistant = agent({
        id: "map-disabled-skill-tools",
        system: "Do not use skills.",
        skills,
      });

      assertEquals(assistant.config.tools, undefined);
      assertEquals(resolveSkillToolDisposition(assistant.config, assistant.id), "disable");
    }
  });

  it("keeps skill tools for maps with positive grants", () => {
    const assistant = agent({
      id: "map-enabled-skill-tools",
      system: "Use support skills, but not internal ones.",
      skills: { "support-*": true, "support-internal": false },
    });

    assertEquals(Object.keys(assistant.config.tools ?? {}).sort(), [
      "execute_skill_script",
      "load_skill",
      "load_skill_reference",
    ]);
    assertEquals(resolveSkillToolDisposition(assistant.config, assistant.id), "inject");
  });

  it("preserves explicit skill tool denials when skills are omitted", () => {
    const assistant = agent({
      id: "disabled-skill-tools",
      system: "Do not use skill tools.",
      tools: {
        load_skill: false,
        load_skill_reference: false,
        execute_skill_script: false,
      },
    });

    assertEquals(assistant.config.tools, {
      load_skill: false,
      load_skill_reference: false,
      execute_skill_script: false,
    });
  });

  it("does not advertise a skill catalog when the loader is explicitly denied", async () => {
    registerSkill("support-triage", createSkill("support-triage", "Triage support requests"));

    const assistant = agent({
      id: "denied-loader-no-catalog",
      system: "Do not use skill tools.",
      tools: {
        load_skill: false,
        load_skill_reference: false,
        execute_skill_script: false,
      },
    });

    const prompt = await resolveSystemText(getEffectiveAgentSystem(assistant));
    assertEquals(
      prompt.includes("<available_skills>"),
      false,
      "a denied loader must not be advertised through the skill catalog",
    );
    assertEquals(prompt.includes("support-triage"), false);
  });

  it("still advertises the skill catalog when only the script tool is denied", async () => {
    registerSkill(
      "script-denied-skill",
      createSkill("script-denied-skill", "Loadable without script execution"),
    );

    const assistant = agent({
      id: "script-denied-prompt",
      system: "Load skills, never run their scripts.",
      tools: { execute_skill_script: false },
    });

    const prompt = await resolveSystemText(getEffectiveAgentSystem(assistant));

    assertStringIncludes(prompt, "<available_skills>");
    assertStringIncludes(prompt, "script-denied-skill");
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

  it("keeps explicit delegate denials authoritative", () => {
    const assistant = agent({
      id: "restricted-orchestrator",
      system: "Do not call the writer.",
      skills: [],
      delegates: ["writer"],
      tools: { agent_writer: false },
    });

    if (!assistant.config.tools || assistant.config.tools === true) {
      throw new Error("Expected an agent tool map");
    }
    assertEquals(assistant.config.tools.agent_writer, false);
  });

  it("resolves an omitted model from hosted context attached after construction", async () => {
    let resolvedModel = "";
    const model: ModelRuntime<ModelRuntimeCallOptions> = {
      provider: "mistral",
      modelId: "mistral-small-2503",
      async doGenerate() {
        return {
          content: [{ type: "text", text: "done" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: new ReadableStream() };
      },
    };
    const assistant = agent({
      id: "hosted-default-at-execution",
      system: "Reply briefly.",
      skills: [],
      tools: {},
      resolveModelTransport: async (input) => {
        resolvedModel = input.resolvedModel;
        return { model };
      },
    });
    await runWithVeryfrontCloudContext(
      { apiToken: "vf_test", projectSlug: "test-project" },
      () => assistant.generate({ input: "Hello" }),
    );
    assertEquals(resolvedModel, "veryfront-cloud/mistral/mistral-small-2503");
  });

  it("removes explicitly denied provider-native tools", async () => {
    let observedToolNames: string[] = [];
    const model: ModelRuntime<ModelRuntimeCallOptions> = {
      provider: "anthropic",
      modelId: "claude-sonnet-4-6",
      async doGenerate(options) {
        observedToolNames = options.tools?.map((definition) => definition.name) ?? [];
        return {
          content: [{ type: "text", text: "done" }],
          finishReason: "stop",
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        };
      },
      async doStream() {
        return { stream: new ReadableStream() };
      },
    };
    const assistant = agent({
      id: "restricted-provider-tools",
      model: "anthropic/claude-sonnet-4-6",
      system: "Use only permitted provider tools.",
      skills: [],
      providerTools: ["web_search", "web_fetch"],
      tools: { web_search: false },
      resolveModelTransport: async () => ({ model }),
    });

    await assistant.generate({ input: "Use an allowed tool." });

    assertEquals(assistant.config.providerTools, ["web_fetch"]);
    assertEquals(observedToolNames, ["web_fetch"]);
  });

  it("materializes explicitly requested invoke_agent for direct runtimes", async () => {
    const assistant = agent({
      id: "generic-orchestrator",
      system: "Invoke registered specialist agents.",
      skills: [],
      tools: { invoke_agent: true },
    });

    const definitions = await getAvailableTools(assistant.config.tools, {
      callerAgentId: assistant.id,
      includeIntegrationTools: false,
    });

    assertEquals(definitions.map((definition) => definition.name), ["invoke_agent"]);
  });

  it("suppresses generic invoke_agent when delegates are explicitly scoped", async () => {
    for (
      const [id, delegates, expectedTools] of [
        ["empty-delegate-scope", [], []],
        ["fixed-delegate-scope", ["ingestion-agent"], ["agent_ingestion-agent"]],
      ] as const
    ) {
      const assistant = agent({
        id,
        system: "Delegate only within the explicit scope.",
        skills: [],
        delegates: [...delegates],
        tools: { invoke_agent: true },
      });

      const definitions = await getAvailableTools(assistant.config.tools, {
        callerAgentId: assistant.id,
        includeIntegrationTools: false,
      });

      assertEquals(definitions.map((definition) => definition.name), [...expectedTools]);
    }
  });

  it("rejects delegates combined with the implicit all-tools selector", () => {
    for (
      const [id, delegates] of [
        ["empty-broad-orchestrator", []],
        ["broad-orchestrator", ["ingestion-agent"]],
      ] as const
    ) {
      assertThrows(
        () =>
          agent({
            id,
            system: "Delegate specialist work.",
            delegates: [...delegates],
            tools: true,
          }),
        Error,
        "cannot combine delegates with tools: true",
      );
    }
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
    const prompt = await resolveSystemText(effectiveSystem);

    assertEquals(prompt.startsWith("You are a helpful assistant."), true);
    assertEquals(prompt.includes("undefined"), false);
    assertStringIncludes(prompt, "<available_skills>");
  });

  it("does not disclose deferred tool names through direct skill metadata", async () => {
    registerSkill("release-manager", {
      id: "release-manager",
      metadata: {
        name: "release-manager",
        description: "Manage releases",
        allowedTools: ["create_release"],
      },
      rootPath: "/test/skills/release-manager",
    });

    const assistant = agent({
      id: "deferred-skill-metadata",
      tools: true,
      skills: ["release-manager"],
    } as AgentConfig);
    const effectiveSystem = getEffectiveAgentSystem(assistant);
    const prompt = await resolveSystemText(effectiveSystem);

    assertStringIncludes(prompt, "release-manager");
    assertEquals(prompt.includes("create_release"), false);
    assertEquals(prompt.includes("load_skill_reference"), false);
    assertEquals(prompt.includes("execute_skill_script"), false);
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
  describe("agent respond request parsing", () => {
    it("rejects a body larger than the configured limit before buffering it", async () => {
      const assistant = agent({ id: "respond-parsing-too-large", system: "Stay helpful." });

      const response = await assistant.respond(
        new Request("http://localhost/agent", {
          method: "POST",
          body: "x".repeat(DEFAULT_MAX_BODY_SIZE_BYTES + 1),
        }),
      );

      assertEquals(
        response.status,
        413,
        "a body over DEFAULT_MAX_BODY_SIZE_BYTES is rejected before buffering",
      );
      assertEquals(
        (await response.json()).error,
        "Request body too large",
        "the oversize rejection names the body size limit",
      );
    });

    it("rejects a malformed JSON body", async () => {
      const assistant = agent({ id: "respond-parsing-malformed", system: "Stay helpful." });

      const response = await assistant.respond(
        new Request("http://localhost/agent", { method: "POST", body: "{not json" }),
      );

      assertEquals(response.status, 400, "an unparseable body is a client error");
      assertEquals(
        (await response.json()).error,
        "Malformed JSON request body",
        "the malformed body rejection is distinguished from a schema rejection",
      );
    });

    it("rejects well-formed JSON that fails the respond request schema", async () => {
      const assistant = agent({ id: "respond-parsing-schema", system: "Stay helpful." });

      const response = await assistant.respond(
        new Request("http://localhost/agent", {
          method: "POST",
          body: JSON.stringify({ messages: 5 }),
        }),
      );

      assertEquals(response.status, 400, "a schema violation is a client error");
      assertEquals(
        (await response.json()).error,
        "Invalid agent request",
        "the schema rejection is reported separately from malformed JSON",
      );
    });

    it("rejects a model override outside the configured allowlist", async () => {
      const assistant = agent({
        id: "respond-parsing-allowlist",
        system: "Stay helpful.",
        allowedModels: ["hosted/approved-model"],
      });

      const response = await assistant.respond(
        new Request("http://localhost/agent", {
          method: "POST",
          body: JSON.stringify({ messages: [], model: "hosted/expensive-model" }),
        }),
      );

      assertEquals(
        response.status,
        403,
        "a client-supplied model outside allowedModels must not reach the runtime",
      );
      assertStringIncludes(
        (await response.json()).error,
        'Model "hosted/expensive-model" is not allowed',
        "the refusal names the rejected model",
      );
    });
  });
});
