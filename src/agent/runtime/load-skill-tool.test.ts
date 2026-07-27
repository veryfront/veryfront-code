import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects, assertStrictEquals, assertStringIncludes } from "@std/assert";
import {
  createRuntimeLoadSkillTool,
  RUNTIME_LOAD_SKILL_CONTINUATION_NOTE,
  type RuntimeLoadSkillBuiltinStore,
  type RuntimeLoadSkillToolContext,
} from "./load-skill-tool.ts";
import { toolToProviderDefinition } from "#veryfront/tool/registry.ts";
import type {
  RuntimeLoadedProjectSkill,
  RuntimeProjectSkillContext,
  RuntimeProjectSkillLoader,
} from "./project-skill-loader.ts";
import { createRuntimeProjectSkillLoader } from "./project-skill-loader.ts";
import { getRuntimeProjectSkillCatalog } from "./project-skill-catalog.ts";
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

Deno.test("createRuntimeLoadSkillTool forwards the exact execution cancellation to project reads", async () => {
  let bodySignal: AbortSignal | undefined;
  let referenceSignal: AbortSignal | undefined;
  const projectSkillLoader: RuntimeProjectSkillLoader = {
    listProjectSkillReferences: () => Promise.resolve([]),
    loadProjectSkill: (_context, _skillId, signal?: AbortSignal) => {
      bodySignal = signal;
      return Promise.resolve({
        instructions: "# Project plan",
        references: ["references/project.md"],
      });
    },
    loadProjectSkillReference: (
      _context,
      _skillId,
      _normalizedFile,
      signal?: AbortSignal,
    ) => {
      referenceSignal = signal;
      return Promise.resolve("Project reference");
    },
  };
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext(),
    skillsDir: "/skills",
    projectSkillLoader,
    builtinStore: createBuiltinStore({}),
  });
  const controller = new AbortController();

  await tool.execute({ skillId: "plan" }, { abortSignal: controller.signal });
  await tool.execute(
    { skillId: "plan", file: "references/project.md" },
    { abortSignal: controller.signal },
  );

  assertStrictEquals(bodySignal, controller.signal);
  assertStrictEquals(referenceSignal, controller.signal);
});

Deno.test("createRuntimeLoadSkillTool does not cache a result returned after cancellation", async () => {
  const controller = new AbortController();
  const cancellation = new DOMException("tool cancelled", "AbortError");
  const context = createProjectContext();
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: () => {
        controller.abort(cancellation);
        return Promise.resolve({
          instructions: "# Project plan",
          references: [],
        });
      },
      loadProjectSkillReference: () => Promise.resolve(null),
    },
    builtinStore: createBuiltinStore({}),
  });

  const error = await assertRejects(() =>
    tool.execute(
      { skillId: "plan" },
      { abortSignal: controller.signal },
    )
  );

  assertStrictEquals(error, cancellation);
  assertEquals(context.loadedSkillResponses, {});
});

Deno.test("a claimed project skill never falls through to a builtin with the same id", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({
      availableSkillIds: ["plan"],
      skillSourcePaths: { plan: "skills/plan/SKILL.md" },
    }),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({
      skills: new Map([["plan", "# Builtin plan"]]),
    }),
  });

  assertEquals(await tool.execute({ skillId: "plan" }), {
    error:
      'Project skill "plan" is unavailable or no longer satisfies its validated catalog contract.',
  });
});

Deno.test("an invalid catalog override cannot re-enable a builtin with the same id", async () => {
  const invalidOverride =
    "---\nname: different\ndescription: Invalid shared override\n---\n\n# Invalid";
  const getProjectFiles = () => Promise.resolve([{ path: "skills/shared/SKILL.md" }]);
  const getProjectFile = ({ path }: { path: string }) =>
    Promise.resolve(
      path === "skills/shared/SKILL.md" ? { path, content: invalidOverride } : null,
    );
  const catalog = await getRuntimeProjectSkillCatalog({
    projectId: "project-1",
    authToken: "auth-token",
    branchId: "branch-1",
    builtinSkills: [{
      id: "shared",
      name: "shared",
      description: "Builtin shared",
      instructions: "# Builtin shared",
      allowedTools: [],
    }],
    getProjectFiles,
    getProjectFile,
  });
  assertEquals(catalog, []);

  let builtinReads = 0;
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({
      availableSkillIds: catalog.map((skill) => skill.id),
    }),
    skillsDir: "/skills",
    projectSkillLoader: createRuntimeProjectSkillLoader({
      getProjectFiles,
      getProjectFile,
    }),
    builtinSkillIds: ["shared"],
    builtinStore: {
      ...createBuiltinStore({}),
      readSkill: () => {
        builtinReads += 1;
        return "# Builtin shared";
      },
    },
  });

  assertEquals(await tool.execute({ skillId: "shared" }), {
    error: "Skill not found: shared. Available skills: none",
  });
  assertEquals(builtinReads, 0);
});

Deno.test("builtin fallback remains available when the project catalog is unavailable", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext(),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinSkillIds: ["plan"],
    builtinStore: createBuiltinStore({
      skills: new Map([["plan", "# Builtin plan"]]),
    }),
  });

  assertEquals(
    expectLoadedSkillResponse(await tool.execute({ skillId: "plan" })).instructions,
    "# Builtin plan",
  );
});

Deno.test("a claimed project reference never falls through to a builtin reference", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({
      availableSkillIds: ["plan"],
      skillSourcePaths: { plan: "skills/plan/SKILL.md" },
    }),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([
        ["plan", { instructions: "# Project plan", references: ["references/guide.md"] }],
      ]),
    }),
    builtinStore: createBuiltinStore({
      references: new Map([["plan/references/guide.md", "builtin secret"]]),
    }),
  });

  await tool.execute({ skillId: "plan" });
  assertEquals(
    await tool.execute({ skillId: "plan", file: "references/guide.md" }),
    { error: "Project skill reference not found: plan/references/guide.md" },
  );
});

Deno.test("createRuntimeLoadSkillTool accepts a lowercase .md skill alias at the boundary", async () => {
  const loaderCalls: string[] = [];
  const context = createProjectContext({
    availableSkillIds: ["plan"],
  });
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: (_context, skillId) =>
        Promise.resolve(
          skillId === "plan" ? ["references/project.md"] : [],
        ),
      loadProjectSkill: (_context, skillId) => {
        loaderCalls.push(skillId);
        return Promise.resolve(
          skillId === "plan"
            ? { skillId: "plan", instructions: "# Project plan", references: [] }
            : null,
        );
      },
      loadProjectSkillReference: (_context, skillId, normalizedFile) =>
        Promise.resolve(`${skillId}/${normalizedFile}`),
    },
    builtinStore: createBuiltinStore({}),
  });

  const result = expectLoadedSkillResponse(await tool.execute({ skillId: "plan.md" }));
  const reload = expectLoadedSkillResponse(await tool.execute({ skillId: "plan" }));

  assertEquals(result.skillId, "plan");
  assertEquals(loaderCalls, ["plan"]);
  assertStringIncludes(reload.instructions, 'Skill "plan" is already loaded');
});

Deno.test("createRuntimeLoadSkillTool preserves canonical .md skill IDs", async () => {
  const loaderCalls: string[] = [];
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({
      availableSkillIds: ["plan", "plan.md"],
    }),
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: (_context, skillId) => {
        loaderCalls.push(skillId);
        return Promise.resolve({
          skillId,
          instructions: `# ${skillId}`,
          references: [],
        });
      },
      loadProjectSkillReference: () => Promise.resolve(null),
    },
    builtinStore: createBuiltinStore({}),
  });

  assertEquals(tool.inputSchemaJson, {
    type: "object",
    properties: {
      skillId: {
        type: "string",
        enum: ["plan", "plan.md"],
        description: "Unloaded skill ID to load. Available unloaded skill IDs: plan, plan.md",
      },
      file: {
        type: "string",
        description:
          "Optional reference file to load. First load the skill with only skillId, then use file only for a reference path listed by that loaded skill.",
      },
    },
    required: ["skillId"],
  });

  const markdownNamed = expectLoadedSkillResponse(await tool.execute({ skillId: "plan.md" }));
  const extensionless = expectLoadedSkillResponse(await tool.execute({ skillId: "plan" }));

  assertEquals(markdownNamed.skillId, "plan.md");
  assertEquals(extensionless.skillId, "plan");
  assertEquals(loaderCalls, ["plan.md", "plan"]);
  await assertRejects(
    () => tool.execute({ skillId: "plan.md.md" }),
    Error,
    "input validation failed",
  );
});

Deno.test("createRuntimeLoadSkillTool normalizes .md aliases without a known skill manifest", async () => {
  const loaderCalls: string[] = [];
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext(),
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: (_context, skillId) => {
        loaderCalls.push(skillId);
        return Promise.resolve(
          skillId === "plan" ? { instructions: "# Project plan", references: [] } : null,
        );
      },
      loadProjectSkillReference: () => Promise.resolve(null),
    },
    builtinStore: createBuiltinStore({}),
  });

  assertStringIncludes(
    JSON.stringify(tool.inputSchemaJson),
    'A lowercase \\".md\\" suffix is accepted',
  );
  const result = expectLoadedSkillResponse(await tool.execute({ skillId: "plan.md" }));
  const reload = expectLoadedSkillResponse(await tool.execute({ skillId: "plan" }));

  assertEquals(result.skillId, "plan");
  assertEquals(loaderCalls, ["plan"]);
  assertStringIncludes(reload.instructions, 'Skill "plan" is already loaded');
  for (const invalidSkillId of ["plan.md.md", "plan.MD", "bad/path.md"]) {
    await assertRejects(
      () => tool.execute({ skillId: invalidSkillId }),
      Error,
      "input validation failed",
    );
  }
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

Deno.test("createRuntimeLoadSkillTool enforces an explicitly empty allowed-tools policy", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({
      availableToolNames: ["read_file"],
    }),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({
      skills: new Map([
        [
          "read-only",
          `---
allowed-tools: []
---
Read without direct tools.`,
        ],
      ]),
    }),
  });

  const result = expectLoadedSkillResponse(await tool.execute({ skillId: "read-only" }));

  assertEquals(result.allowedTools, []);
  assertEquals(result.delegationTools, []);
  assertStringIncludes(result.note ?? "", "intentionally empty");
});

Deno.test("createRuntimeLoadSkillTool names scoped delegates and omits override forwarding", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({
      availableToolNames: ["read_file", "agent_writer", "load_skill"],
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

  assertEquals(result.allowedTools, ["read_file"]);
  assertEquals(result.unavailableCurrentRunTools, ["write_file"]);
  assertStringIncludes(
    result.nextStep,
    "use only these available scoped delegation tools: `agent_writer`",
  );
  assertStringIncludes(result.delegationNote ?? "", "`agent_writer`");
  assertEquals(JSON.stringify(result).includes("invoke_agent"), false);
  assertEquals(result.overrideNote, undefined);
});

Deno.test("createRuntimeLoadSkillTool omits delegation advice without delegate tools", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({
      availableToolNames: ["read_file", "load_skill"],
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
---
Write carefully.`,
        ],
      ]),
    }),
  });

  const result = expectLoadedSkillResponse(await tool.execute({ skillId: "write" }));

  assertEquals(result.allowedTools, ["read_file"]);
  assertEquals(result.unavailableCurrentRunTools, ["write_file"]);
  assertEquals(result.delegationNote, undefined);
  assertEquals(result.nextStep.includes("multi-step or isolated work"), false);
  assertEquals(JSON.stringify(result).includes("invoke_agent"), false);
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

Deno.test("createRuntimeLoadSkillTool schema disallows body reloads for already-loaded skills", async () => {
  const context = createProjectContext({
    availableSkillIds: ["plan", "veryfront"],
    loadedSkillResponses: {
      "veryfront-key": {
        skillId: "veryfront",
        instructions: "# Veryfront",
        nextStep: "Continue.",
        references: ["references/create-agent.md"],
      },
    },
  });
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({}),
  });

  assertEquals(tool.inputSchemaJson, {
    anyOf: [
      {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            enum: ["plan", "plan.md"],
            description: "Unloaded skill ID to load. Available unloaded skill IDs: plan, plan.md",
          },
          file: {
            type: "string",
            description:
              "Optional reference file to load. First load the skill with only skillId, then use file only for a reference path listed by that loaded skill.",
          },
        },
        required: ["skillId"],
      },
      {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            enum: ["veryfront", "veryfront.md"],
            description:
              "Already-loaded skill ID. Body reloads are not allowed; use this only with file for listed references. Loaded skill IDs: veryfront, veryfront.md",
          },
          file: {
            type: "string",
            description:
              "Required reference file to load from an already-loaded skill. Do not call load_skill again for the skill body.",
          },
        },
        required: ["skillId", "file"],
      },
    ],
  });
});

Deno.test("createRuntimeLoadSkillTool refreshes its provider schema after a skill body load", async () => {
  const context = createProjectContext({
    availableSkillIds: ["veryfront"],
  });
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([
        ["veryfront", {
          skillId: "veryfront",
          instructions: "# Veryfront",
          references: ["references/create-agent.md"],
        }],
      ]),
    }),
    builtinStore: createBuiltinStore({}),
  });

  const beforeLoad = toolToProviderDefinition(tool).parameters;
  assertEquals(beforeLoad, {
    type: "object",
    properties: {
      skillId: {
        type: "string",
        enum: ["veryfront", "veryfront.md"],
        description:
          "Unloaded skill ID to load. Available unloaded skill IDs: veryfront, veryfront.md",
      },
      file: {
        type: "string",
        description:
          "Optional reference file to load. First load the skill with only skillId, then use file only for a reference path listed by that loaded skill.",
      },
    },
    required: ["skillId"],
  });

  await tool.execute({ skillId: "veryfront" });

  const afterLoad = toolToProviderDefinition(tool).parameters;
  assertEquals(afterLoad, {
    type: "object",
    properties: {
      skillId: {
        type: "string",
        enum: ["veryfront", "veryfront.md"],
        description:
          "Already-loaded skill ID. Body reloads are not allowed; use this only with file for listed references. Loaded skill IDs: veryfront, veryfront.md",
      },
      file: {
        type: "string",
        description:
          "Required reference file to load from an already-loaded skill. Do not call load_skill again for the skill body.",
      },
    },
    required: ["skillId", "file"],
  });
  await assertRejects(() => tool.execute({ skillId: "veryfront" }));
});

Deno.test("createRuntimeLoadSkillTool schema only permits reference loads when all known skills are loaded", async () => {
  const context = createProjectContext({
    availableSkillIds: ["veryfront"],
    loadedSkillResponses: {
      "veryfront-key": {
        skillId: "veryfront",
        instructions: "# Veryfront",
        nextStep: "Continue.",
        references: ["references/create-agent.md"],
      },
    },
  });
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({}),
  });

  assertEquals(tool.inputSchemaJson, {
    type: "object",
    properties: {
      skillId: {
        type: "string",
        enum: ["veryfront", "veryfront.md"],
        description:
          "Already-loaded skill ID. Body reloads are not allowed; use this only with file for listed references. Loaded skill IDs: veryfront, veryfront.md",
      },
      file: {
        type: "string",
        description:
          "Required reference file to load from an already-loaded skill. Do not call load_skill again for the skill body.",
      },
    },
    required: ["skillId", "file"],
  });
});

Deno.test("createRuntimeLoadSkillTool exposes a no-file no-op schema after loading a skill without references", async () => {
  const context = createProjectContext({
    availableSkillIds: ["veryfront"],
  });
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([
        ["veryfront", {
          skillId: "veryfront",
          instructions: "# Veryfront",
          references: [],
        }],
      ]),
    }),
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "veryfront" });
  const [loadedResponse] = Object.values(context.loadedSkillResponses ?? {});
  if (loadedResponse) {
    delete loadedResponse.references;
  }

  assertEquals(toolToProviderDefinition(tool).parameters, {
    type: "object",
    additionalProperties: false,
    properties: {
      skillId: {
        type: "string",
        enum: ["veryfront", "veryfront.md"],
        description:
          "Already-loaded skill ID with no advertised reference files. Calling load_skill again is a no-op. Loaded skill IDs: veryfront, veryfront.md",
      },
    },
    required: ["skillId"],
  });

  const reloadResult = expectLoadedSkillResponse(await tool.execute({ skillId: "veryfront" }));
  assertStringIncludes(reloadResult.instructions, 'Skill "veryfront" is already loaded');
  let rejectedUnexpectedFile = false;
  try {
    await tool.execute({ skillId: "veryfront", file: "references/foo.md" });
  } catch (error) {
    rejectedUnexpectedFile = true;
    assertStringIncludes(String(error), "input validation failed");
  }
  assertEquals(rejectedUnexpectedFile, true);
});

Deno.test("createRuntimeLoadSkillTool exposes only referenceable skills when every skill is loaded", async () => {
  const context = createProjectContext({
    availableSkillIds: ["plain", "with-reference"],
  });
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([
        ["plain", { instructions: "# Plain", references: [] }],
        ["with-reference", {
          instructions: "# With reference",
          references: ["references/guide.md"],
        }],
      ]),
    }),
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "plain" });
  await tool.execute({ skillId: "with-reference" });

  assertEquals(toolToProviderDefinition(tool).parameters, {
    type: "object",
    properties: {
      skillId: {
        type: "string",
        enum: ["with-reference", "with-reference.md"],
        description:
          "Already-loaded skill ID. Body reloads are not allowed; use this only with file for listed references. Loaded skill IDs: with-reference, with-reference.md",
      },
      file: {
        type: "string",
        description:
          "Required reference file to load from an already-loaded skill. Do not call load_skill again for the skill body.",
      },
    },
    required: ["skillId", "file"],
  });
});

Deno.test("createRuntimeLoadSkillTool omits loaded skills without references from productive schema branches", async () => {
  const context = createProjectContext({
    availableSkillIds: ["create", "plain", "with-reference"],
  });
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([
        ["create", { instructions: "# Create", references: [] }],
        ["plain", { instructions: "# Plain", references: [] }],
        ["with-reference", {
          instructions: "# With reference",
          references: ["references/guide.md"],
        }],
      ]),
      references: new Map([
        ["with-reference/references/guide.md", "reference content"],
      ]),
    }),
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "plain" });
  await tool.execute({ skillId: "with-reference" });

  assertEquals(tool.inputSchemaJson, {
    anyOf: [
      {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            enum: ["create", "create.md"],
            description:
              "Unloaded skill ID to load. Available unloaded skill IDs: create, create.md",
          },
          file: {
            type: "string",
            description:
              "Optional reference file to load. First load the skill with only skillId, then use file only for a reference path listed by that loaded skill.",
          },
        },
        required: ["skillId"],
      },
      {
        type: "object",
        properties: {
          skillId: {
            type: "string",
            enum: ["with-reference", "with-reference.md"],
            description:
              "Already-loaded skill ID. Body reloads are not allowed; use this only with file for listed references. Loaded skill IDs: with-reference, with-reference.md",
          },
          file: {
            type: "string",
            description:
              "Required reference file to load from an already-loaded skill. Do not call load_skill again for the skill body.",
          },
        },
        required: ["skillId", "file"],
      },
    ],
  });

  assertEquals(
    await tool.execute({ skillId: "with-reference", file: "references/guide.md" }),
    {
      skillId: "with-reference",
      file: "references/guide.md",
      content: "reference content",
    },
  );
  assertEquals(
    expectLoadedSkillResponse(await tool.execute({ skillId: "create" })).instructions,
    "# Create",
  );
});

Deno.test("createRuntimeLoadSkillTool schema ignores stale loaded skills outside the current manifest", async () => {
  const context = createProjectContext({
    availableSkillIds: ["veryfront"],
    loadedSkillResponses: {
      "old-plan-key": {
        skillId: "plan",
        instructions: "# Old plan",
        nextStep: "Continue.",
      },
    },
  });
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({}),
  });

  assertEquals(tool.inputSchemaJson, {
    type: "object",
    properties: {
      skillId: {
        type: "string",
        enum: ["veryfront", "veryfront.md"],
        description:
          "Unloaded skill ID to load. Available unloaded skill IDs: veryfront, veryfront.md",
      },
      file: {
        type: "string",
        description:
          "Optional reference file to load. First load the skill with only skillId, then use file only for a reference path listed by that loaded skill.",
      },
    },
    required: ["skillId"],
  });
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

Deno.test("createRuntimeLoadSkillTool preserves policy on a duplicate body load", async () => {
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
  assertEquals(secondResult.allowedTools, [
    "form_input",
    "studio_suggestions",
    "list_files",
    "create_file",
  ]);
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

Deno.test("createRuntimeLoadSkillTool authorizes an advertised reference after a resumed form continuation", async () => {
  const projectSkillLoader = createProjectSkillLoader({
    skills: new Map([
      [
        "research",
        {
          instructions: "# Research",
          references: ["resources/schema.json", "assets/template.txt"],
        },
      ],
    ]),
    references: new Map([
      ["research/resources/schema.json", '{"type":"object"}'],
      ["research/assets/template.txt", "template"],
    ]),
  });
  const initialTool = createRuntimeLoadSkillTool({
    context: createProjectContext({ availableSkillIds: ["research"] }),
    skillsDir: "/skills",
    projectSkillLoader,
    builtinStore: createBuiltinStore({}),
  });
  const loaded = expectLoadedSkillResponse(
    await initialTool.execute({ skillId: "research" }),
  );

  // Default-chat task continuations recreate the tool closure after form input,
  // while the runtime hydrates the active skill into ToolExecutionContext.
  const resumedTool = createRuntimeLoadSkillTool({
    context: createProjectContext({ availableSkillIds: ["research"] }),
    skillsDir: "/skills",
    projectSkillLoader,
    builtinStore: createBuiltinStore({}),
  });
  const resumedExecutionContext = {
    activeSkillId: loaded.skillId,
    activeSkillToolAvailability: {
      hasActiveSkill: true,
      references: loaded.references,
      scripts: [],
    },
  };

  assertEquals(
    await resumedTool.execute(
      { skillId: "research", file: "resources/schema.json" },
      resumedExecutionContext,
    ),
    {
      skillId: "research",
      file: "resources/schema.json",
      content: '{"type":"object"}',
    },
  );
  assertEquals(
    await resumedTool.execute(
      { skillId: "research", file: "assets/template.txt" },
      { ...resumedExecutionContext, activeSkillId: "other" },
    ),
    {
      error:
        'Skill "research" must be loaded before reference file "assets/template.txt". Call load_skill with only {"skillId":"research"} first, then request one of the listed reference files.',
    },
  );
  assertEquals(
    await resumedTool.execute(
      { skillId: "research", file: " assets/template.txt " },
      resumedExecutionContext,
    ),
    {
      error:
        'Skill "research" must be loaded before reference file "assets/template.txt". Call load_skill with only {"skillId":"research"} first, then request one of the listed reference files.',
    },
  );
});

Deno.test("createRuntimeLoadSkillTool loads project and builtin reference files after body load", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext(),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([
        [
          "plan",
          {
            instructions: "# Plan",
            references: [
              "references/project.md",
              "references/empty.md",
              "resources/schema.json",
              "assets/template.txt",
            ],
          },
        ],
      ]),
      references: new Map([
        ["plan/references/project.md", "project reference"],
        ["plan/references/empty.md", ""],
        ["plan/resources/schema.json", "project resource"],
        ["plan/assets/template.txt", "project asset"],
      ]),
    }),
    builtinStore: createBuiltinStore({
      skills: new Map([["build", "# Build"]]),
      references: new Map([
        ["build/references/builtin.md", "builtin reference"],
        ["build/references/empty.md", ""],
      ]),
      referenceLists: new Map([
        ["build", ["references/builtin.md", "references/empty.md"]],
      ]),
    }),
  });

  await tool.execute({ skillId: "plan" });
  assertEquals(await tool.execute({ skillId: "plan", file: "references/project.md" }), {
    skillId: "plan",
    file: "references/project.md",
    content: "project reference",
  });
  assertEquals(await tool.execute({ skillId: "plan", file: "references/empty.md" }), {
    skillId: "plan",
    file: "references/empty.md",
    content: "",
  });
  assertEquals(await tool.execute({ skillId: "plan", file: "resources/schema.json" }), {
    skillId: "plan",
    file: "resources/schema.json",
    content: "project resource",
  });
  assertEquals(await tool.execute({ skillId: "plan", file: "assets/template.txt" }), {
    skillId: "plan",
    file: "assets/template.txt",
    content: "project asset",
  });
  await tool.execute({ skillId: "build" });
  assertEquals(await tool.execute({ skillId: "build", file: "references/builtin.md" }), {
    skillId: "build",
    file: "references/builtin.md",
    content: "builtin reference",
  });
  assertEquals(await tool.execute({ skillId: "build", file: "references/empty.md" }), {
    skillId: "build",
    file: "references/empty.md",
    content: "",
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
  for (
    const invalidSkillId of [
      "plan.md.md",
      "bad/path.md",
      "..",
      "plan.mdx",
      "plan.MD",
    ]
  ) {
    await assertRejects(
      () => tool.execute({ skillId: invalidSkillId }),
      Error,
      "input validation failed",
    );
  }
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
