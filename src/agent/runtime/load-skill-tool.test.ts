import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  createRuntimeLoadSkillTool,
  RUNTIME_LOAD_SKILL_CONTINUATION_NOTE,
  type RuntimeLoadSkillBuiltinStore,
} from "./load-skill-tool.ts";
import type {
  RuntimeLoadedProjectSkill,
  RuntimeProjectSkillContext,
  RuntimeProjectSkillLoader,
} from "./project-skill-loader.ts";
import type { RuntimeLoadedSkillResponse } from "./skill-metadata.ts";

const PROJECT_CONTEXT: RuntimeProjectSkillContext = {
  projectId: "project-1",
  authToken: "auth-token",
  branchId: "branch-1",
};

type ProjectSkillMap = Map<string, RuntimeLoadedProjectSkill>;
type ProjectReferenceMap = Map<string, string>;

function createProjectSkillLoader(input: {
  skills?: ProjectSkillMap;
  references?: ProjectReferenceMap;
}): RuntimeProjectSkillLoader {
  return {
    listProjectSkillReferences: (_context, skillId) =>
      Promise.resolve(input.skills?.get(skillId)?.references ?? []),
    loadProjectSkill: (_context, skillId) => Promise.resolve(input.skills?.get(skillId) ?? null),
    loadProjectSkillReference: (_context, skillId, normalizedFile) =>
      Promise.resolve(input.references?.get(`${skillId}/${normalizedFile}`) ?? null),
  };
}

function isRuntimeLoadedSkillResponse(result: unknown): result is RuntimeLoadedSkillResponse {
  return !!result && typeof result === "object" && "skillId" in result &&
    typeof result.skillId === "string" && "instructions" in result &&
    typeof result.instructions === "string" && "nextStep" in result &&
    typeof result.nextStep === "string";
}

function expectLoadedSkillResponse(result: unknown): RuntimeLoadedSkillResponse {
  if (isRuntimeLoadedSkillResponse(result)) {
    return result;
  }

  throw new Error("Expected loaded skill response");
}

function createBuiltinStore(input: {
  skills?: Map<string, string>;
  references?: Map<string, string>;
  referenceLists?: Map<string, string[]>;
}): RuntimeLoadSkillBuiltinStore {
  return {
    readSkill: (_skillsDir, skillId) => input.skills?.get(skillId) ?? null,
    readReferenceFile: (_skillsDir, skillId, normalizedFile) =>
      input.references?.get(`${skillId}/${normalizedFile}`) ?? null,
    listReferences: (_skillsDir, skillId) => input.referenceLists?.get(skillId) ?? [],
  };
}

Deno.test("createRuntimeLoadSkillTool loads project skills before builtin skills", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: PROJECT_CONTEXT,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([
        ["plan", { instructions: "# Project plan", references: ["references/project.md"] }],
      ]),
    }),
    builtinStore: createBuiltinStore({
      skills: new Map([["plan", "# Builtin plan"]]),
      referenceLists: new Map([["plan", ["references/builtin.md"]]]),
    }),
  });

  const result = await tool.execute({ skillId: "plan" });

  assertEquals(result, {
    skillId: "plan",
    instructions: "# Project plan",
    nextStep: RUNTIME_LOAD_SKILL_CONTINUATION_NOTE,
    references: ["references/project.md"],
    referenceNote: "Use load_skill with the `file` parameter to load any of these reference files.",
  });
});

Deno.test("createRuntimeLoadSkillTool falls back to builtin skills and filters allowed tools", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: {
      ...PROJECT_CONTEXT,
      availableToolNames: ["read_file", "invoke_agent"],
    },
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({
      skills: new Map([
        [
          "write",
          `---
allowed-tools:
  - read_file
  - write_file
model: sonnet
max-steps: 8
---
Write carefully.`,
        ],
      ]),
    }),
  });

  const result = expectLoadedSkillResponse(await tool.execute({ skillId: "write" }));

  assertEquals(result.skillId, "write");
  assertEquals(result.allowedTools, ["read_file"]);
  assertEquals(result.delegationTools, ["read_file", "write_file"]);
  assertEquals(result.unavailableCurrentRunTools, ["write_file"]);
  assertEquals(result.model, "sonnet");
  assertEquals(result.maxSteps, 8);
});

Deno.test("createRuntimeLoadSkillTool loads project and builtin reference files", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: PROJECT_CONTEXT,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      references: new Map([["plan/references/project.md", "project reference"]]),
    }),
    builtinStore: createBuiltinStore({
      references: new Map([["plan/references/builtin.md", "builtin reference"]]),
    }),
  });

  assertEquals(await tool.execute({ skillId: "plan", file: "references/project.md" }), {
    skillId: "plan",
    file: "references/project.md",
    content: "project reference",
  });
  assertEquals(await tool.execute({ skillId: "plan", file: "references/builtin.md" }), {
    skillId: "plan",
    file: "references/builtin.md",
    content: "builtin reference",
  });
});

Deno.test("createRuntimeLoadSkillTool rejects unsafe and unknown manifest skill inputs", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: {
      ...PROJECT_CONTEXT,
      availableSkillIds: ["project-only", "plan"],
    },
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinSkillIds: ["build", "plan"],
    builtinStore: createBuiltinStore({}),
  });

  assertEquals(await tool.execute({ skillId: "plan", file: "../secret.md" }), {
    error: "Invalid reference file path: ../secret.md",
  });
  await assertRejects(
    () => tool.execute({ skillId: "missing" }),
    Error,
    "input validation failed",
  );
  await assertRejects(
    () => tool.execute({ skillId: "bad/path" }),
    Error,
    "input validation failed",
  );
});

Deno.test("createRuntimeLoadSkillTool advertises the runtime skill manifest instead of inviting invented skill IDs", () => {
  const tool = createRuntimeLoadSkillTool({
    context: {
      ...PROJECT_CONTEXT,
      availableSkillIds: ["daily-briefing"],
    },
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinSkillIds: [],
    builtinStore: createBuiltinStore({}),
  });

  assertStringIncludes(tool.description, "Available skill IDs: daily-briefing.");
  assertStringIncludes(tool.description, "Do not invent skill IDs");
});

Deno.test("createRuntimeLoadSkillTool rejects invented skill IDs before tool execution when manifest is known", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: {
      ...PROJECT_CONTEXT,
      availableSkillIds: ["daily-briefing"],
    },
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinSkillIds: [],
    builtinStore: createBuiltinStore({}),
  });

  await assertRejects(
    () => tool.execute({ skillId: "skill-sales-agent" }),
    Error,
    "input validation failed",
  );
});

Deno.test("createRuntimeLoadSkillTool allows host copy overrides", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: PROJECT_CONTEXT,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({
      skills: new Map([["plan", "# Plan"]]),
    }),
    description: "Custom load skill description.",
    nextStep: "Custom next step.",
    messages: {
      referenceNote: "Custom reference note.",
    },
  });

  assertEquals(tool.description, "Custom load skill description.");
  const result = expectLoadedSkillResponse(await tool.execute({ skillId: "plan" }));
  assertEquals(result.nextStep, "Custom next step.");
  assertStringIncludes(JSON.stringify(result), "Custom next step.");
});
