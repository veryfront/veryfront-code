import { assertEquals, assertRejects, assertStringIncludes } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { normalizeSourceIntegrationPolicy } from "#veryfront/integrations/source-policy.ts";
import type { RemoteToolSource } from "#veryfront/tool";
import type { DefaultHostedChatRuntimeSystemRefreshInput } from "./default-chat-runtime.ts";
import {
  createDefaultHostedProjectSteeringRefresh,
  fetchDefaultHostedProjectSteering,
} from "./default-project-steering-refresh.ts";
import type { RuntimeAgentMarkdownDefinition } from "../runtime/agent-definition.ts";
import type { RuntimeSkillDefinition } from "../runtime/skill-metadata.ts";

function createAgent(): RuntimeAgentMarkdownDefinition {
  return {
    id: "agent-1",
    name: "Agent",
    description: "Agent description",
    instructions: "Base instructions",
    tools: true,
  };
}

function createSkill(id: string): RuntimeSkillDefinition {
  return {
    id,
    name: id,
    description: `${id} skill`,
    instructions: `${id} instructions`,
    allowedTools: [],
  };
}

function createRefreshInput(
  overrides: Partial<DefaultHostedChatRuntimeSystemRefreshInput> = {},
): DefaultHostedChatRuntimeSystemRefreshInput {
  return {
    taskContext: {
      authToken: "auth-token",
      projectId: "project-1",
      branchId: "branch-1",
      model: "openai/gpt-test",
      availableSkillIds: ["build"],
    },
    liveProjectSteering: {
      agent: createAgent(),
      environmentContext: "Editor context",
      initialProjectInstructions: "Initial instructions",
      initialSkills: [createSkill("initial")],
    },
    toolAssembly: {
      sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
      runtimeTools: {},
      remoteToolSources: [],
      localToolNames: ["form_input", "load_skill", "sleep"],
      remoteToolNames: [],
      providerToolNames: [],
      availableToolNames: [],
      toolLoadingMode: "deferred",
      compatibleRemoteToolNames: [],
      systemInstructions: "",
    },
    ...overrides,
  };
}

describe("agent/default-hosted-project-steering-refresh", () => {
  it("fetches project steering in parallel for an active project", async () => {
    const lookups: Array<{ projectId: string; authToken: string; branchId?: string | null }> = [];
    const traceOperations: string[] = [];

    const steering = await fetchDefaultHostedProjectSteering({
      projectId: "project-1",
      authToken: "auth-token",
      branchId: "branch-1",
      fetchProjectInstructions: (lookup) => {
        lookups.push(lookup);
        return Promise.resolve("Fresh instructions");
      },
      fetchSkills: (lookup) => {
        lookups.push(lookup);
        return Promise.resolve([createSkill("build")]);
      },
      trace: async (operationName, operation) => {
        traceOperations.push(operationName);
        return await operation();
      },
      traceOperationName: "test.fetchProjectSteering",
    });

    assertEquals(traceOperations, ["test.fetchProjectSteering"]);
    assertEquals(lookups, [
      { projectId: "project-1", authToken: "auth-token", branchId: "branch-1" },
      { projectId: "project-1", authToken: "auth-token", branchId: "branch-1" },
    ]);
    assertEquals(steering, {
      instructions: "Fresh instructions",
      skills: [createSkill("build")],
    });
  });

  it("returns empty steering without fetching when no project is active", async () => {
    let fetchCount = 0;

    const steering = await fetchDefaultHostedProjectSteering({
      projectId: null,
      authToken: "auth-token",
      fetchProjectInstructions: () => {
        fetchCount++;
        return Promise.resolve("Fresh instructions");
      },
      fetchSkills: () => {
        fetchCount++;
        return Promise.resolve([createSkill("build")]);
      },
    });

    assertEquals(fetchCount, 0);
    assertEquals(steering, { instructions: "", skills: [] });
  });

  it("refreshes instructions, filters visible skills, and records available tools", async () => {
    const lookups: Array<{ projectId: string; authToken: string; branchId?: string | null }> = [];
    const refresh = createDefaultHostedProjectSteeringRefresh({
      fetchProjectInstructions: (lookup) => {
        lookups.push(lookup);
        return Promise.resolve("Fresh instructions");
      },
      fetchSkills: (lookup) => {
        lookups.push(lookup);
        return Promise.resolve([createSkill("build"), createSkill("hidden")]);
      },
      buildInstructions: (input) => [
        {
          role: "system",
          content: `${input.instructions}:${
            input.skills.map((skill) => skill.id).join(",")
          }:${input.environmentContext}`,
        },
      ],
    });
    const input = createRefreshInput();
    input.liveProjectSteering.agent.skills = ["build"];
    input.taskContext.availableSkillIds = ["build", "hidden"];

    const system = await refresh(input);

    assertEquals(lookups, [
      { projectId: "project-1", authToken: "auth-token", branchId: "branch-1" },
      { projectId: "project-1", authToken: "auth-token", branchId: "branch-1" },
    ]);
    assertEquals(input.taskContext.availableToolNames, ["load_skill", "tool_search"]);
    assertEquals(
      system.includes("Fresh instructions:build:Editor context"),
      true,
    );
    assertEquals(system.includes("Current run tool inventory:"), true);
  });

  it("keeps source-denied integration tools out of refreshed inventory", async () => {
    const remoteToolSource: RemoteToolSource = {
      id: "api",
      listTools: () =>
        Promise.resolve([
          {
            name: "confluence__search_content",
            description: "Search Confluence",
            parameters: { type: "object", properties: {} },
          },
          {
            name: "gmail__list_emails",
            description: "List Gmail emails",
            parameters: { type: "object", properties: {} },
          },
        ]),
      executeTool: () => Promise.resolve({ ok: true }),
    };
    const refresh = createDefaultHostedProjectSteeringRefresh({
      fetchProjectInstructions: () => Promise.resolve("Fresh instructions"),
      fetchSkills: () => Promise.resolve([]),
      buildInstructions: (input) => input.instructions,
    });
    const input = createRefreshInput({
      toolAssembly: {
        sourceIntegrationPolicy: normalizeSourceIntegrationPolicy({
          allow: { confluence: {} },
        }),
        runtimeTools: {},
        remoteToolSources: [remoteToolSource],
        localToolNames: ["sleep"],
        remoteToolNames: ["confluence__search_content"],
        providerToolNames: [],
        availableToolNames: ["confluence__search_content", "sleep"],
        toolLoadingMode: "deferred",
        compatibleRemoteToolNames: ["confluence__search_content"],
        systemInstructions: "",
      },
    });

    const system = await refresh(input);

    assertEquals(input.taskContext.availableToolNames, ["tool_search"]);
    assertEquals(system.includes("confluence__search_content"), false);
    assertEquals(system.includes("gmail__list_emails"), false);
    assertEquals(input.toolAssembly.compatibleRemoteToolNames, [
      "confluence__search_content",
    ]);
  });

  it("keeps an explicitly empty advertised skill catalog during refresh", async () => {
    const refresh = createDefaultHostedProjectSteeringRefresh({
      fetchProjectInstructions: () => Promise.resolve("Fresh instructions"),
      fetchSkills: () => Promise.resolve([createSkill("other-agent--private")]),
      buildInstructions: (input) =>
        `${input.instructions}:${input.skills.map((skill) => skill.id).join(",")}`,
    });

    const input = createRefreshInput();
    input.liveProjectSteering.agent.skills = [];
    input.taskContext.availableSkillIds = ["other-agent--private"];
    const system = await refresh(input);

    assertEquals(system.includes("Fresh instructions:other-agent--private"), false);
    assertEquals(system.includes("Fresh instructions:"), true);
  });

  it("refreshes omitted selectors dynamically but does not broaden explicit allowlists", async () => {
    const refresh = createDefaultHostedProjectSteeringRefresh({
      fetchProjectInstructions: () => Promise.resolve("Fresh instructions"),
      fetchSkills: () => Promise.resolve([createSkill("build"), createSkill("new-skill")]),
      buildInstructions: (input) =>
        `${input.instructions}:${input.skills.map((skill) => skill.id).join(",")}`,
    });

    const dynamicInput = createRefreshInput();
    dynamicInput.taskContext.skillSelectorPolicy = { kind: "all-visible", source: "omitted" };
    dynamicInput.taskContext.availableSkillIds = ["build"];

    const dynamicSystem = await refresh(dynamicInput);

    assertStringIncludes(dynamicSystem, "Fresh instructions:build,new-skill");
    assertEquals(dynamicInput.taskContext.availableSkillIds, ["build", "new-skill"]);

    const explicitInput = createRefreshInput();
    explicitInput.liveProjectSteering.agent.skills = ["build"];
    explicitInput.taskContext.skillSelectorPolicy = { kind: "allowlist", entries: ["build"] };
    explicitInput.taskContext.availableSkillIds = ["build"];

    const explicitSystem = await refresh(explicitInput);

    assertStringIncludes(explicitSystem, "Fresh instructions:build");
    assertEquals(explicitSystem.includes("new-skill"), false);
    assertEquals(explicitInput.taskContext.availableSkillIds, ["build"]);
  });

  it("rejects deleted explicit skill selections during refresh without narrowing state", async () => {
    const refresh = createDefaultHostedProjectSteeringRefresh({
      fetchProjectInstructions: () => Promise.resolve("Fresh instructions"),
      fetchSkills: () => Promise.resolve([createSkill("new-skill")]),
      buildInstructions: (input) =>
        `${input.instructions}:${input.skills.map((skill) => skill.id).join(",")}`,
    });
    const input = createRefreshInput();
    input.liveProjectSteering.agent.skills = ["build"];
    input.taskContext.skillSelectorPolicy = { kind: "allowlist", entries: ["build"] };
    input.taskContext.availableSkillIds = ["build"];

    const error = await assertRejects(
      () => refresh(input),
      Error,
      "configured skills are not available",
    );

    assertEquals(String(error).includes("build"), false);
    assertEquals(input.taskContext.availableSkillIds, ["build"]);
    assertEquals(input.taskContext.skillSelectorPolicy, {
      kind: "allowlist",
      entries: ["build"],
    });
  });

  it("keeps deferred provider-native tools out of refreshed model inventory", async () => {
    const refresh = createDefaultHostedProjectSteeringRefresh({
      fetchProjectInstructions: () => Promise.resolve("Fresh instructions"),
      fetchSkills: () => Promise.resolve([]),
      buildInstructions: (input) => input.instructions,
    });

    const input = createRefreshInput({
      taskContext: {
        authToken: "auth-token",
        projectId: "project-1",
        branchId: "branch-1",
        model: "anthropic/claude-sonnet-4-6",
      },
      toolAssembly: {
        sourceIntegrationPolicy: normalizeSourceIntegrationPolicy(undefined),
        runtimeTools: {},
        remoteToolSources: [],
        localToolNames: ["sleep"],
        remoteToolNames: [],
        providerToolNames: ["web_fetch", "web_search"],
        availableToolNames: [],
        toolLoadingMode: "deferred",
        compatibleRemoteToolNames: [],
        systemInstructions: "",
      },
    });

    const system = await refresh(input);

    assertEquals(input.taskContext.availableToolNames, ["tool_search"]);
    assertEquals(system.includes("web_fetch"), false);
    assertEquals(system.includes("web_search"), false);
  });

  it("falls back to initial steering when refresh lookups fail", async () => {
    const errors: Array<{ message: string; metadata?: Record<string, unknown> }> = [];
    const refresh = createDefaultHostedProjectSteeringRefresh({
      fetchProjectInstructions: () => Promise.reject(new Error("instructions down")),
      fetchSkills: () => Promise.reject(new Error("skills down")),
      buildInstructions: (input) =>
        `${input.instructions}:${input.skills.map((skill) => skill.id).join(",")}`,
      logger: {
        error: (message, metadata) => {
          errors.push({ message, metadata });
        },
      },
    });

    const system = await refresh(
      createRefreshInput({
        taskContext: {
          authToken: "auth-token",
          projectId: "project-1",
          branchId: "branch-1",
          model: "openai/gpt-test",
          availableSkillIds: ["initial"],
        },
      }),
    );

    assertEquals(system.includes("Initial instructions:initial"), true);
    assertEquals(errors.map((error) => error.message), [
      "Refreshing project instructions failed during hosted runtime steering update",
      "Refreshing skills failed during hosted runtime steering update",
    ]);
  });
});
