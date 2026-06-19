import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";
import {
  createRuntimeLoadSkillTool,
  RUNTIME_LOAD_SKILL_CONTINUATION_NOTE,
  type RuntimeLoadSkillBuiltinStore,
  type RuntimeLoadSkillToolContext,
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

function createProjectContext(
  overrides: Partial<RuntimeLoadSkillToolContext> = {},
): RuntimeLoadSkillToolContext {
  return {
    ...PROJECT_CONTEXT,
    ...overrides,
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
    context: createProjectContext(),
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
    referenceNote:
      "After this skill is loaded, use load_skill with the `file` parameter only for one of these listed reference files.",
  });
});

Deno.test("createRuntimeLoadSkillTool falls back to builtin skills and filters allowed tools", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({
      availableToolNames: ["read_file", "invoke_agent"],
    }),
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

Deno.test("createRuntimeLoadSkillTool makes same-skill reloads concise and idempotent", async () => {
  const context = createProjectContext({
    availableToolNames: ["read_file"],
  });
  const tool = createRuntimeLoadSkillTool({
    context,
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
max-steps: 8
---
# Plan

Use form_input once, then produce the plan.`,
        ],
      ]),
      referenceLists: new Map([["write", ["references/write.md"]]]),
    }),
  });

  const firstResult = expectLoadedSkillResponse(await tool.execute({ skillId: "write" }));
  const secondResult = expectLoadedSkillResponse(await tool.execute({ skillId: "write" }));

  assertStringIncludes(firstResult.instructions, "Use form_input once");
  assertStringIncludes(secondResult.instructions, 'Skill "write" is already loaded');
  assertStringIncludes(secondResult.instructions, "Do not call load_skill");
  assertStringIncludes(secondResult.instructions, "do not call form_input again");
  assertEquals(secondResult.allowedTools, ["read_file"]);
  assertEquals(secondResult.delegationTools, ["read_file", "write_file"]);
  assertEquals(secondResult.unavailableCurrentRunTools, ["write_file"]);
  assertEquals(secondResult.maxSteps, 8);
  assertEquals(secondResult.references, ["references/write.md"]);
});

Deno.test("createRuntimeLoadSkillTool reloads same skill after project context changes", async () => {
  const context = createProjectContext();
  let projectSkillReads = 0;
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: (activeContext, skillId) => {
        projectSkillReads++;
        return Promise.resolve({
          instructions: `# ${activeContext.projectId} ${skillId}`,
          references: [`references/${activeContext.projectId}.md`],
        });
      },
      loadProjectSkillReference: () => Promise.resolve(null),
    },
    builtinStore: createBuiltinStore({}),
  });

  const firstResult = expectLoadedSkillResponse(await tool.execute({ skillId: "plan" }));
  context.projectId = "project-2";
  context.branchId = null;
  context.skillSourcePaths = { plan: "agents/planner/skills/plan/SKILL.md" };
  const secondResult = expectLoadedSkillResponse(await tool.execute({ skillId: "plan" }));

  assertEquals(projectSkillReads, 2);
  assertEquals(firstResult.instructions, "# project-1 plan");
  assertEquals(secondResult.instructions, "# project-2 plan");
  assertEquals(secondResult.references, ["references/project-2.md"]);
});

Deno.test("createRuntimeLoadSkillTool removes form_input from same-skill reload policy", async () => {
  const context = createProjectContext({
    availableToolNames: ["form_input", "studio_suggestions", "list_files", "create_file"],
  });
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({
      skills: new Map([
        [
          "plan",
          `---
allowed-tools:
  - form_input
  - studio_suggestions
  - list_files
  - create_file
---
# Plan

Use one form, then write the plan.`,
        ],
      ]),
    }),
  });

  const firstResult = expectLoadedSkillResponse(await tool.execute({ skillId: "plan" }));
  const secondResult = expectLoadedSkillResponse(await tool.execute({ skillId: "plan" }));

  assertEquals(firstResult.allowedTools, [
    "form_input",
    "studio_suggestions",
    "list_files",
    "create_file",
  ]);
  assertEquals(secondResult.allowedTools, ["studio_suggestions", "list_files", "create_file"]);
  assertEquals(secondResult.delegationTools, [
    "form_input",
    "studio_suggestions",
    "list_files",
    "create_file",
  ]);
});

Deno.test("createRuntimeLoadSkillTool rejects reference files before the skill body is loaded", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext(),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([
        ["veryfront", { instructions: "# Veryfront", references: ["references/ROUTES.md"] }],
      ]),
      references: new Map([
        ["veryfront/references/ROUTES.md", "routes reference"],
      ]),
    }),
    builtinStore: createBuiltinStore({}),
  });

  assertEquals(await tool.execute({ skillId: "veryfront", file: "references/ROUTES.md" }), {
    error:
      'Skill "veryfront" must be loaded before reference file "references/ROUTES.md". Call load_skill with only {"skillId":"veryfront"} first, then request one of the listed reference files.',
  });
  assertEquals(await tool.execute({ skillId: "veryfront", file: "references/does-not-exist.md" }), {
    error:
      'Skill "veryfront" must be loaded before reference file "references/does-not-exist.md". Call load_skill with only {"skillId":"veryfront"} first, then request one of the listed reference files.',
  });
});

Deno.test("createRuntimeLoadSkillTool loads project and builtin reference files after body load", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext(),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([
        ["plan", { instructions: "# Plan", references: ["references/project.md"] }],
      ]),
      references: new Map([["plan/references/project.md", "project reference"]]),
    }),
    builtinStore: createBuiltinStore({
      skills: new Map([["build", "# Build"]]),
      references: new Map([["build/references/builtin.md", "builtin reference"]]),
      referenceLists: new Map([["build", ["references/builtin.md"]]]),
    }),
  });

  await tool.execute({ skillId: "plan" });
  assertEquals(await tool.execute({ skillId: "plan", file: "references/project.md" }), {
    skillId: "plan",
    file: "references/project.md",
    content: "project reference",
  });
  await tool.execute({ skillId: "build" });
  assertEquals(await tool.execute({ skillId: "build", file: "references/builtin.md" }), {
    skillId: "build",
    file: "references/builtin.md",
    content: "builtin reference",
  });
});

Deno.test("createRuntimeLoadSkillTool rejects unadvertised references after body load", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext(),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([
        ["veryfront", { instructions: "# Veryfront", references: ["references/ROUTES.md"] }],
      ]),
      references: new Map([
        ["veryfront/references/ROUTES.md", "routes reference"],
        ["veryfront/references/does-not-exist.md", "hidden reference"],
      ]),
    }),
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "veryfront" });

  assertEquals(await tool.execute({ skillId: "veryfront", file: "references/does-not-exist.md" }), {
    error:
      'Reference file not advertised by loaded skill "veryfront": references/does-not-exist.md. Available references: references/ROUTES.md',
  });
});

Deno.test("createRuntimeLoadSkillTool preserves advertised quickstart references", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext(),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([
        ["veryfront", { instructions: "# Veryfront", references: ["references/quickstart.md"] }],
      ]),
      references: new Map([
        ["veryfront/references/quickstart.md", "quickstart reference"],
      ]),
    }),
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "veryfront" });

  assertEquals(await tool.execute({ skillId: "veryfront", file: "references/quickstart.md" }), {
    skillId: "veryfront",
    file: "references/quickstart.md",
    content: "quickstart reference",
  });
});

Deno.test("createRuntimeLoadSkillTool makes same-reference reloads concise and idempotent", async () => {
  let projectReferenceReads = 0;
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext(),
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: () =>
        Promise.resolve({
          instructions: "# Plan",
          references: ["references/project.md"],
        }),
      loadProjectSkillReference: (_context, skillId, normalizedFile) => {
        projectReferenceReads++;
        return Promise.resolve(`${skillId}/${normalizedFile} content`);
      },
    },
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "plan" });
  const firstResult = await tool.execute({ skillId: "plan", file: "references/project.md" });
  const secondResult = await tool.execute({ skillId: "plan", file: "references/project.md" });

  assertEquals(projectReferenceReads, 1);
  assertEquals(firstResult, {
    skillId: "plan",
    file: "references/project.md",
    content: "plan/references/project.md content",
  });
  assertEquals(secondResult, {
    skillId: "plan",
    file: "references/project.md",
    content:
      'Reference file "plan/references/project.md" is already loaded in this turn. Do not call load_skill for this file again. Continue from the existing reference content and produce the next useful response now.',
  });
});

Deno.test("createRuntimeLoadSkillTool reloads same reference after project context changes", async () => {
  const context = createProjectContext();
  let projectReferenceReads = 0;
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: (activeContext, skillId) =>
        Promise.resolve({
          instructions: `# ${activeContext.projectId} ${skillId}`,
          references: ["references/project.md"],
        }),
      loadProjectSkillReference: (activeContext, skillId, normalizedFile) => {
        projectReferenceReads++;
        return Promise.resolve(`${activeContext.projectId}/${skillId}/${normalizedFile}`);
      },
    },
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "plan" });
  const firstResult = await tool.execute({ skillId: "plan", file: "references/project.md" });
  context.projectId = "project-2";
  context.branchId = null;
  context.skillSourcePaths = { plan: "agents/planner/skills/plan/SKILL.md" };
  await tool.execute({ skillId: "plan" });
  const secondResult = await tool.execute({ skillId: "plan", file: "references/project.md" });

  assertEquals(projectReferenceReads, 2);
  assertEquals(firstResult, {
    skillId: "plan",
    file: "references/project.md",
    content: "project-1/plan/references/project.md",
  });
  assertEquals(secondResult, {
    skillId: "plan",
    file: "references/project.md",
    content: "project-2/plan/references/project.md",
  });
});

Deno.test("createRuntimeLoadSkillTool rejects unsafe and unknown manifest skill inputs", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({
      availableSkillIds: ["project-only", "plan"],
    }),
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
    context: createProjectContext({
      availableSkillIds: ["daily-briefing"],
    }),
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
    context: createProjectContext({
      availableSkillIds: ["daily-briefing"],
    }),
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
    context: createProjectContext(),
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
