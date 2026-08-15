import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/skill/_test-setup.ts";
import { createVeryfrontCloudRuntimeSystemMessages } from "#veryfront/agent";
import { assertEquals } from "#veryfront/testing/assert.ts";
import { describe, it } from "#veryfront/testing/bdd.ts";
import { toolToProviderDefinition } from "#veryfront/tool/registry.ts";
import {
  createRuntimeAgentSystemMessages,
  type RuntimeAgentMarkdownDefinition,
} from "./agent-definition.ts";
import {
  createRuntimeLoadSkillTool,
  type RuntimeLoadSkillBuiltinStore,
} from "./load-skill-tool.ts";
import type { RuntimeProjectSkillLoader } from "./project-skill-loader.ts";
import type { RuntimeSkillDefinition } from "./skill-metadata.ts";

const agent: RuntimeAgentMarkdownDefinition = {
  id: "assistant",
  name: "Assistant",
  description: "A test assistant",
  instructions: "Shared prompt",
};

const projectSkillLoader: RuntimeProjectSkillLoader = {
  listProjectSkillReferences: () => Promise.resolve([]),
  loadProjectSkill: () => Promise.resolve(null),
  loadProjectSkillReference: () => Promise.resolve(null),
};

const builtinStore: RuntimeLoadSkillBuiltinStore = {
  readSkill: () => Promise.resolve(null),
  readReferenceFile: () => Promise.resolve(null),
  listReferences: () => Promise.resolve([]),
};

function skill(id: string): RuntimeSkillDefinition {
  return {
    id,
    name: id,
    description: `${id} guidance`,
    instructions: `Use ${id}.`,
    allowedTools: [],
  };
}

function loadSkillProviderDefinition(projectId: string, skillId: string) {
  return toolToProviderDefinition(
    createRuntimeLoadSkillTool({
      context: {
        projectId,
        authToken: "<TOKEN>",
        branchId: "main",
        availableSkillIds: [skillId],
      },
      skillsDir: "/skills",
      projectSkillLoader,
      builtinSkillIds: ["veryfront"],
      builtinStore,
    }),
  );
}

describe("shared provider prefix", () => {
  it("keeps provider tools and system[0] byte-identical between standalone and hosted project contexts", () => {
    const standalone = {
      system: createRuntimeAgentSystemMessages({
        agent,
        runtimeBlocks: ['<project_context>\nproject_reference: "project-a"\n</project_context>'],
        skills: [skill("plan")],
      }),
      tools: [loadSkillProviderDefinition("project-a", "plan")],
    };
    const hosted = {
      system: createVeryfrontCloudRuntimeSystemMessages({
        agent,
        projectId: "project-b",
        branchId: "main",
        skills: [skill("review")],
      }),
      tools: [loadSkillProviderDefinition("project-b", "review")],
    };

    assertEquals(standalone.system[0], hosted.system[0]);
    assertEquals(standalone.tools, hosted.tools);
  });
});
