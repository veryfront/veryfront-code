import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
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
      runtimeTools: {},
      remoteToolSources: [],
      localToolNames: ["load_skill", "sleep"],
      remoteToolNames: [],
      availableToolNames: [],
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

    const system = await refresh(input);

    assertEquals(lookups, [
      { projectId: "project-1", authToken: "auth-token", branchId: "branch-1" },
      { projectId: "project-1", authToken: "auth-token", branchId: "branch-1" },
    ]);
    assertEquals(input.taskContext.availableToolNames, ["load_skill", "sleep"]);
    assertEquals(
      system.includes("Fresh instructions:build:Editor context"),
      true,
    );
    assertEquals(system.includes("Current run tool inventory:"), true);
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
