import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/skill/_test-setup.ts";
import {
  assertEquals,
  assertRejects,
  assertStrictEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  createRuntimeLoadSkillTool,
  RUNTIME_LOAD_SKILL_DESCRIPTION,
  type RuntimeLoadSkillBuiltinStore,
  type RuntimeLoadSkillToolContext,
  type RuntimeLoadSkillToolOptions,
} from "./load-skill-tool.ts";
import {
  LOAD_SKILL_CONTINUE_SAME_TURN,
  LOAD_SKILL_DELEGATION_THRESHOLD,
  LOAD_SKILL_OVERRIDE_FORWARDING,
  LOAD_SKILL_ROOT_OWNERSHIP,
} from "../conversation/delegation-policy.ts";
import { toolToProviderDefinition } from "#veryfront/tool/registry.ts";
import {
  SKILL_DOCUMENT_MAX_CHARACTERS,
  SKILL_ID_MAX_LENGTH,
  SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
  SKILL_RELATIVE_PATH_MAX_LENGTH,
  SKILL_RUNTIME_AVAILABLE_TOOL_MAX_ENTRIES,
  SKILL_SUBDIR_MAX_ENTRIES,
} from "#veryfront/skill/limits.ts";
import type {
  RuntimeLoadedProjectSkill,
  RuntimeProjectSkillContext,
  RuntimeProjectSkillLoader,
} from "./project-skill-loader.ts";
import { createRuntimeProjectSkillLoader } from "./project-skill-loader.ts";
import { getRuntimeProjectSkillCatalog } from "./project-skill-catalog.ts";
import type { RuntimeLoadedSkillResponse } from "./skill-metadata.ts";
import { it } from "#veryfront/testing/bdd.ts";

// The advertised input schema is intentionally STATIC and project-independent
// (RFC 0001, layered context): skill IDs are surfaced in generated skill context,
// not baked into the tool definition, so the tools array can join the shared
// cache prefix. Per-project validation (valid IDs, reload/body rules) still runs at
// `.parse()` time and is covered by the execute() tests below. Every load state
// must advertise this same schema — that invariance is what these assertions guard.
const STATIC_LOAD_SKILL_INPUT_SCHEMA = {
  type: "object",
  properties: {
    skillId: {
      type: "string",
      maxLength: SKILL_ID_MAX_LENGTH + ".md".length,
      pattern: "^[a-zA-Z0-9_-]+(?:\\.md)?$",
      description:
        'The skill ID to load. Omit skillId to list authorized IDs. A lowercase ".md" suffix is accepted for a listed ID.',
    },
    file: {
      type: "string",
      minLength: 1,
      maxLength: 1024,
      description:
        "Optional reference file to load. First load the skill with only skillId, then use file only for a reference path listed by that loaded skill.",
    },
    cursor: {
      type: "integer",
      minimum: 0,
      maximum: 1_000,
      description:
        "Pagination cursor from a previous skill inventory response. Use only when skillId is omitted.",
    },
  },
} as const;

const PROJECT_CONTEXT: RuntimeProjectSkillContext = {
  projectId: "project-1",
  authToken: "auth-token",
  branchId: "branch-1",
};

async function withPollutedDescriptorPrototypeValue<T>(
  value: unknown,
  fn: () => Promise<T>,
): Promise<T> {
  const original = Object.getOwnPropertyDescriptor(Object.prototype, "value");
  Object.defineProperty(Object.prototype, "value", {
    configurable: true,
    value,
  });
  try {
    return await fn();
  } finally {
    if (original) {
      Object.defineProperty(Object.prototype, "value", original);
    } else {
      delete (Object.prototype as Record<string, unknown>).value;
    }
  }
}

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
    typeof result.instructions === "string";
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
    readSkill: (_skillsDir, skillId) => Promise.resolve(input.skills?.get(skillId) ?? null),
    readReferenceFile: (_skillsDir, skillId, normalizedFile) =>
      Promise.resolve(input.references?.get(`${skillId}/${normalizedFile}`) ?? null),
    listReferences: (_skillsDir, skillId) =>
      Promise.resolve(input.referenceLists?.get(skillId) ?? []),
  };
}

function createReadableReferenceList(length: number): string[] {
  return Array.from({ length }, (_unused, index) => {
    const directoryIndex = Math.floor(index / SKILL_SUBDIR_MAX_ENTRIES);
    const directory = ["references", "resources", "assets"][directoryIndex] ?? "assets";
    return `${directory}/${index}.txt`;
  });
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
    references: ["references/project.md"],
  });
});

Deno.test("createRuntimeLoadSkillTool forwards the exact execution cancellation to project reads", async () => {
  let bodySignal: AbortSignal | undefined;
  let referenceSignal: AbortSignal | undefined;
  const projectSkillLoader: RuntimeProjectSkillLoader = {
    listProjectSkillReferences: () => Promise.resolve([]),
    loadProjectSkill: (_context, _skillId, operation) => {
      bodySignal = operation?.budget?.abortSignal;
      return Promise.resolve({
        instructions: "# Project plan",
        references: ["references/project.md"],
      });
    },
    loadProjectSkillReference: (
      _context,
      _skillId,
      _normalizedFile,
      operation,
    ) => {
      referenceSignal = operation?.budget?.abortSignal;
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
  const invalidOverride = "---\nname: shared\n---\n\n# Missing required description";
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
      readSkill: async () => {
        builtinReads += 1;
        return "# Builtin shared";
      },
    },
  });

  await assertRejects(
    () => tool.execute({ skillId: "shared" }),
    Error,
    "No skills are available in this run",
  );
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

it("createRuntimeLoadSkillTool accepts a lowercase .md skill alias at the boundary", async () => {
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

it("createRuntimeLoadSkillTool preserves canonical .md skill IDs", async () => {
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

  assertEquals(tool.inputSchemaJson, STATIC_LOAD_SKILL_INPUT_SCHEMA);

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

it("keeps supported .md IDs valid in the static provider schema", () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({ availableSkillIds: ["plan.md"] }),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({}),
  });

  const parameters = toolToProviderDefinition(tool).parameters as {
    properties?: { skillId?: { maxLength?: number; pattern?: string } };
  };
  assertEquals(parameters.properties?.skillId?.maxLength, SKILL_ID_MAX_LENGTH + ".md".length);
  assertEquals(parameters.properties?.skillId?.pattern, "^[a-zA-Z0-9_-]+(?:\\.md)?$");
});

it("keeps legacy .md alias execution when no manifest is available", async () => {
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

  assertEquals(tool.inputSchemaJson, STATIC_LOAD_SKILL_INPUT_SCHEMA);
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
  assertEquals(secondResult.maxSteps, 8);
  assertEquals(secondResult.references, ["references/write.md"]);
});

Deno.test("createRuntimeLoadSkillTool retains compact skill markers instead of full instructions", async () => {
  const context = createProjectContext();
  const instructions = `# Sensitive body\n\n${"retain-never ".repeat(4_000)}`;
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({
      skills: new Map([["large", instructions]]),
      referenceLists: new Map([["large", ["references/guide.md"]]]),
    }),
  });

  const first = expectLoadedSkillResponse(await tool.execute({ skillId: "large" }));
  const [cached] = Object.values(context.loadedSkillResponses ?? {});

  assertEquals(first.instructions, instructions);
  assertEquals(cached?.instructions.includes("retain-never"), false);
  assertEquals(cached?.references, ["references/guide.md"]);
  assertStringIncludes(
    expectLoadedSkillResponse(await tool.execute({ skillId: "large" })).instructions,
    "already loaded",
  );
});

Deno.test("returned references cannot escalate cached reference authorization", async () => {
  const context = createProjectContext();
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({
      skills: new Map([["writer", "# Writer"]]),
      references: new Map([
        ["writer/references/public.md", "public"],
        ["writer/references/secret.md", "secret"],
      ]),
      referenceLists: new Map([["writer", ["references/public.md"]]]),
    }),
  });

  const first = expectLoadedSkillResponse(await tool.execute({ skillId: "writer" }));
  first.references?.push("references/secret.md");

  const second = expectLoadedSkillResponse(await tool.execute({ skillId: "writer" }));
  assertEquals(second.references, ["references/public.md"]);
  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/secret.md" }),
    {
      error:
        'Reference file not advertised by loaded skill "writer": references/secret.md. Available references: references/public.md',
    },
  );
});

Deno.test("tool recreation keeps reference authorization detached from replaced cache responses", async () => {
  const context = createProjectContext({ availableSkillIds: ["writer"] });
  const projectSkillLoader = createProjectSkillLoader({});
  const builtinStore = createBuiltinStore({
    skills: new Map([["writer", "# Writer"]]),
    references: new Map([
      ["writer/references/public.md", "public"],
      ["writer/references/extra.md", "extra"],
    ]),
    referenceLists: new Map([["writer", ["references/public.md"]]]),
  });
  const initialTool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader,
    builtinStore,
  });

  await initialTool.execute({ skillId: "writer" });
  const loadedSkillResponses = context.loadedSkillResponses ?? {};
  const [cacheKey] = Object.keys(loadedSkillResponses);
  const cached = cacheKey === undefined ? undefined : loadedSkillResponses[cacheKey];
  if (!cacheKey || !cached) throw new Error("Expected a loaded skill cache entry");
  loadedSkillResponses[cacheKey] = {
    ...cached,
    references: ["references/public.md", "references/extra.md"],
  };

  const recreatedTool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader,
    builtinStore,
  });
  assertEquals(
    await recreatedTool.execute({ skillId: "writer", file: "references/extra.md" }),
    {
      error:
        'Reference file not advertised by loaded skill "writer": references/extra.md. Available references: references/public.md',
    },
  );
});

Deno.test("hydrated reference caches are authorized only after authoritative revalidation", async () => {
  const context = createProjectContext({
    availableSkillIds: ["writer"],
    loadedSkillResponses: {
      '["writer",null,"project-1","branch-1",null]': {
        skillId: "writer",
        instructions: "",
        references: ["references/extra.md"],
      },
    },
  });
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([
        ["writer", { instructions: "# Writer", references: ["references/public.md"] }],
      ]),
      references: new Map([["writer/references/extra.md", "extra"]]),
    }),
    builtinStore: createBuiltinStore({}),
  });

  assertEquals(await tool.execute({ skillId: "writer", file: "references/extra.md" }), {
    error:
      'Reference file not advertised by loaded skill "writer": references/extra.md. Available references: references/public.md',
  });
});

Deno.test("reference authorization is revalidated after the credential changes", async () => {
  const context = createProjectContext({
    availableSkillIds: ["writer"],
  });
  let bodyReads = 0;
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: (activeContext) => {
        bodyReads += 1;
        return Promise.resolve({
          instructions: "# Writer",
          references: activeContext.authToken === "credential-a"
            ? ["references/secret.md"]
            : ["references/public.md"],
        });
      },
      loadProjectSkillReference: () => Promise.resolve("secret"),
    },
    builtinStore: createBuiltinStore({}),
  });

  context.authToken = "credential-a";
  await tool.execute({ skillId: "writer" });
  assertEquals(
    Object.keys(context.loadedSkillResponses ?? {}).some((key) => key.includes("credential-a")),
    false,
  );
  context.authToken = "credential-b";

  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/secret.md" }),
    {
      error:
        'Reference file not advertised by loaded skill "writer": references/secret.md. Available references: references/public.md',
    },
  );
  assertEquals(bodyReads, 2);
});

Deno.test("reference authorization restarts when the credential changes inside body revalidation", async () => {
  const context = createProjectContext({
    authToken: "credential-a",
    availableSkillIds: ["writer"],
  });
  let bodyReads = 0;
  let referenceReads = 0;
  let mutateDuringNextBodyRead = false;
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: (activeContext) => {
        bodyReads += 1;
        const credential = activeContext.authToken;
        if (mutateDuringNextBodyRead) {
          mutateDuringNextBodyRead = false;
          context.authToken = "credential-c";
        }
        return Promise.resolve({
          instructions: `# Writer for ${credential}`,
          references: credential === "credential-c"
            ? ["references/public.md"]
            : ["references/secret.md"],
        });
      },
      loadProjectSkillReference: (activeContext, _skillId, normalizedFile) => {
        referenceReads += 1;
        return Promise.resolve(`${activeContext.authToken}:${normalizedFile}`);
      },
    },
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "writer" });
  context.authToken = "credential-b";
  mutateDuringNextBodyRead = true;

  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/secret.md" }),
    {
      error:
        'Reference file not advertised by loaded skill "writer": references/secret.md. Available references: references/public.md',
    },
  );
  assertEquals(context.authToken, "credential-c");
  assertEquals(bodyReads, 3);
  assertEquals(referenceReads, 0);
});

Deno.test("reference authorization fails closed when the credential keeps rotating", async () => {
  const context = createProjectContext({
    authToken: "credential-a",
    availableSkillIds: ["writer"],
  });
  let bodyReads = 0;
  let referenceReads = 0;
  let rotateCredentials = false;
  let credentialSequence = 0;
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: () => {
        bodyReads += 1;
        if (rotateCredentials) {
          credentialSequence += 1;
          context.authToken = `rotated-${credentialSequence}`;
        }
        return Promise.resolve({
          instructions: "# Writer",
          references: ["references/secret.md"],
        });
      },
      loadProjectSkillReference: () => {
        referenceReads += 1;
        return Promise.resolve("secret");
      },
    },
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "writer" });
  context.authToken = "credential-b";
  rotateCredentials = true;

  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/secret.md" }),
    {
      error:
        'Skill authorization context changed repeatedly while loading "writer". Request was not completed.',
    },
  );
  assertEquals(bodyReads, 4);
  assertEquals(referenceReads, 0);
});

Deno.test("concurrent authority generations cannot publish a stale reference result", async () => {
  const context = createProjectContext({
    authToken: "credential-a",
    availableSkillIds: ["writer"],
  });
  let bodyReads = 0;
  let referenceReads = 0;
  let resolveFirstReference: (value: string | null) => void = () => {};
  const firstReference = new Promise<string | null>((resolve) => {
    resolveFirstReference = resolve;
  });
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: (activeContext) => {
        bodyReads += 1;
        return Promise.resolve({
          instructions: `# Writer for ${activeContext.authToken}`,
          references: ["references/guide.md"],
        });
      },
      loadProjectSkillReference: (activeContext) => {
        referenceReads += 1;
        if (referenceReads === 1) return firstReference;
        return Promise.resolve(`fresh guide for ${activeContext.authToken}`);
      },
    },
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "writer" });
  const credentialAReference = tool.execute({
    skillId: "writer",
    file: "references/guide.md",
  });
  assertEquals(referenceReads, 1);

  context.authToken = "credential-b";
  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/guide.md" }),
    {
      skillId: "writer",
      file: "references/guide.md",
      content: "fresh guide for credential-b",
    },
  );
  context.authToken = "credential-a";
  resolveFirstReference("stale guide for credential-a");

  assertEquals(await credentialAReference, {
    skillId: "writer",
    file: "references/guide.md",
    content: "fresh guide for credential-a",
  });
  assertEquals(bodyReads, 3);
  assertEquals(referenceReads, 3);
});

Deno.test("a late credential-A body cannot overwrite credential-B authorization", async () => {
  const context = createProjectContext({
    authToken: "credential-a",
    availableSkillIds: ["writer"],
  });
  let bodyReads = 0;
  let referenceReads = 0;
  let resolveCredentialABody: (value: RuntimeLoadedProjectSkill | null) => void = () => {};
  const credentialABody = new Promise<RuntimeLoadedProjectSkill | null>((resolve) => {
    resolveCredentialABody = resolve;
  });
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: (activeContext) => {
        bodyReads += 1;
        if (bodyReads === 1) return credentialABody;
        return Promise.resolve({
          instructions: `# Writer for ${activeContext.authToken}`,
          references: ["references/public.md"],
        });
      },
      loadProjectSkillReference: (activeContext, _skillId, normalizedFile) => {
        referenceReads += 1;
        return Promise.resolve(`${activeContext.authToken}:${normalizedFile}`);
      },
    },
    builtinStore: createBuiltinStore({}),
  });

  const credentialALoad = tool.execute({ skillId: "writer" });
  assertEquals(bodyReads, 1);
  context.authToken = "credential-b";
  const credentialBLoad = expectLoadedSkillResponse(
    await tool.execute({ skillId: "writer" }),
  );
  assertEquals(credentialBLoad.references, ["references/public.md"]);

  resolveCredentialABody({
    instructions: "# Writer for credential-a",
    references: ["references/secret.md"],
  });
  const lateCredentialALoad = expectLoadedSkillResponse(await credentialALoad);
  assertEquals(lateCredentialALoad.references, ["references/public.md"]);
  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/secret.md" }),
    {
      error:
        'Reference file not advertised by loaded skill "writer": references/secret.md. Available references: references/public.md',
    },
  );
  assertEquals(bodyReads, 2);
  assertEquals(referenceReads, 0);
});

Deno.test("concurrent stable body loads settle without retry livelock", async () => {
  const context = createProjectContext({ availableSkillIds: ["writer"] });
  let bodyReads = 0;
  const bodyResolvers: Array<(value: RuntimeLoadedProjectSkill | null) => void> = [];
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: () => {
        bodyReads += 1;
        return new Promise<RuntimeLoadedProjectSkill | null>((resolve) => {
          bodyResolvers.push(resolve);
        });
      },
      loadProjectSkillReference: () => Promise.resolve(null),
    },
    builtinStore: createBuiltinStore({}),
  });

  const firstLoad = tool.execute({ skillId: "writer" });
  const secondLoad = tool.execute({ skillId: "writer" });
  assertEquals(bodyReads, 2);
  bodyResolvers[0]?.({
    instructions: "# Writer",
    references: ["references/guide.md"],
  });
  bodyResolvers[1]?.({
    instructions: "# Writer",
    references: ["references/guide.md"],
  });

  const [firstResult, secondResult] = await Promise.all([firstLoad, secondLoad]);
  assertEquals(expectLoadedSkillResponse(firstResult).references, ["references/guide.md"]);
  assertEquals(expectLoadedSkillResponse(secondResult).references, ["references/guide.md"]);
  assertEquals(bodyReads, 2);
});

Deno.test("concurrent stable loads for distinct skills do not consume each other's retries", async () => {
  const skillIds = Array.from({ length: 8 }, (_, index) => `skill-${index}`);
  const context = createProjectContext({ availableSkillIds: skillIds });
  const bodyReads = new Map<string, number>();
  const bodyResolvers = new Map<
    string,
    (value: RuntimeLoadedProjectSkill | null) => void
  >();
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: (_activeContext, skillId) => {
        bodyReads.set(skillId, (bodyReads.get(skillId) ?? 0) + 1);
        return new Promise<RuntimeLoadedProjectSkill | null>((resolve) => {
          bodyResolvers.set(skillId, resolve);
        });
      },
      loadProjectSkillReference: () => Promise.resolve(null),
    },
    builtinStore: createBuiltinStore({}),
  });

  const loads = skillIds.map((skillId) => tool.execute({ skillId }));
  assertEquals(bodyResolvers.size, skillIds.length);
  for (const skillId of skillIds) {
    bodyResolvers.get(skillId)?.({
      instructions: `# ${skillId}`,
      references: [],
    });
  }

  const results = await Promise.all(loads);
  assertEquals(
    results.map((result) => expectLoadedSkillResponse(result).instructions),
    skillIds.map((skillId) => `# ${skillId}`),
  );
  assertEquals(
    skillIds.map((skillId) => bodyReads.get(skillId)),
    skillIds.map(() => 1),
  );
});

Deno.test("one scope rotation invalidates every old-key publication once", async () => {
  const skillIds = ["writer-a", "writer-b", "writer-c"];
  const context = createProjectContext({
    authToken: "credential-a",
    availableSkillIds: skillIds,
  });
  const bodyReads = new Map<string, number>();
  const credentialAResolvers = new Map<
    string,
    (value: RuntimeLoadedProjectSkill | null) => void
  >();
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: (activeContext, skillId) => {
        const read = (bodyReads.get(skillId) ?? 0) + 1;
        bodyReads.set(skillId, read);
        if (activeContext.authToken === "credential-a" && skillId !== "writer-c") {
          return new Promise<RuntimeLoadedProjectSkill | null>((resolve) => {
            credentialAResolvers.set(skillId, resolve);
          });
        }
        return Promise.resolve({
          instructions: `# ${skillId} for ${activeContext.authToken}`,
          references: [],
        });
      },
      loadProjectSkillReference: () => Promise.resolve(null),
    },
    builtinStore: createBuiltinStore({}),
  });

  const staleLoads = ["writer-a", "writer-b"].map((skillId) => tool.execute({ skillId }));
  assertEquals(credentialAResolvers.size, 2);

  context.authToken = "credential-b";
  assertEquals(
    expectLoadedSkillResponse(await tool.execute({ skillId: "writer-c" })).instructions,
    "# writer-c for credential-b",
  );
  for (const skillId of ["writer-a", "writer-b"]) {
    credentialAResolvers.get(skillId)?.({
      instructions: `# ${skillId} for credential-a`,
      references: ["references/secret.md"],
    });
  }

  const retriedResults = await Promise.all(staleLoads);
  assertEquals(
    retriedResults.map((result) => expectLoadedSkillResponse(result).instructions),
    ["# writer-a for credential-b", "# writer-b for credential-b"],
  );
  assertEquals(
    skillIds.map((skillId) => bodyReads.get(skillId)),
    [2, 2, 1],
  );
});

Deno.test("body payloads are reloaded after the credential changes", async () => {
  const context = createProjectContext({ authToken: "credential-a" });
  let bodyReads = 0;
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: (activeContext) => {
        bodyReads += 1;
        return Promise.resolve({
          instructions: `# ${activeContext.authToken}`,
          references: [],
        });
      },
      loadProjectSkillReference: () => Promise.resolve(null),
    },
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "writer" });
  context.authToken = "credential-b";

  assertEquals(
    expectLoadedSkillResponse(await tool.execute({ skillId: "writer" })).instructions,
    "# credential-b",
  );
  assertEquals(bodyReads, 2);
});

Deno.test("reference payloads are reloaded after the credential changes", async () => {
  const context = createProjectContext({ authToken: "credential-a" });
  let bodyReads = 0;
  let referenceReads = 0;
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: () => {
        bodyReads += 1;
        return Promise.resolve({
          instructions: "# Writer",
          references: ["references/guide.md"],
        });
      },
      loadProjectSkillReference: (activeContext) => {
        referenceReads += 1;
        return Promise.resolve(`guide for ${activeContext.authToken}`);
      },
    },
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "writer" });
  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/guide.md" }),
    {
      skillId: "writer",
      file: "references/guide.md",
      content: "guide for credential-a",
    },
  );
  context.authToken = "credential-b";

  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/guide.md" }),
    {
      skillId: "writer",
      file: "references/guide.md",
      content: "guide for credential-b",
    },
  );
  assertEquals(bodyReads, 2);
  assertEquals(referenceReads, 2);
});

Deno.test("an agent owner change uses a distinct public body marker", async () => {
  const context = createProjectContext({
    agentId: "writer-a",
    availableSkillIds: ["writer"],
  });
  let bodyReads = 0;
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: (activeContext) => {
        bodyReads += 1;
        const owner = (activeContext as RuntimeLoadSkillToolContext).agentId;
        return Promise.resolve({
          instructions: `# ${owner}`,
          references: [],
        });
      },
      loadProjectSkillReference: () => Promise.resolve(null),
    },
    builtinStore: createBuiltinStore({}),
  });

  assertEquals(
    expectLoadedSkillResponse(await tool.execute({ skillId: "writer" })).instructions,
    "# writer-a",
  );
  context.agentId = "writer-b";
  assertEquals(
    expectLoadedSkillResponse(await tool.execute({ skillId: "writer" })).instructions,
    "# writer-b",
  );
  assertEquals(bodyReads, 2);
});

Deno.test("reference authorization is revalidated after the agent owner changes", async () => {
  const context = createProjectContext({
    agentId: "writer-a",
    availableSkillIds: ["writer"],
  });
  let bodyReads = 0;
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: (activeContext) => {
        bodyReads += 1;
        const owner = (activeContext as RuntimeLoadSkillToolContext).agentId;
        return Promise.resolve({
          instructions: "# Writer",
          references: owner === "writer-a" ? ["references/secret.md"] : ["references/public.md"],
        });
      },
      loadProjectSkillReference: () => Promise.resolve("secret"),
    },
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "writer" });
  context.agentId = "writer-b";
  await tool.execute({ skillId: "writer" });

  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/secret.md" }),
    {
      error:
        'Reference file not advertised by loaded skill "writer": references/secret.md. Available references: references/public.md',
    },
  );
  assertEquals(bodyReads, 2);
});

Deno.test("tool recreation revalidates authorization against the replacement builtin store", async () => {
  const context = createProjectContext({ availableSkillIds: ["writer"] });
  const projectSkillLoader = createProjectSkillLoader({});
  const initialTool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader,
    builtinStore: createBuiltinStore({
      skills: new Map([["writer", "# Writer"]]),
      references: new Map([["writer/references/secret.md", "old secret"]]),
      referenceLists: new Map([["writer", ["references/secret.md"]]]),
    }),
  });
  await initialTool.execute({ skillId: "writer" });

  const replacementTool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader,
    builtinStore: createBuiltinStore({
      skills: new Map([["writer", "# Writer"]]),
      references: new Map([["writer/references/secret.md", "replacement secret"]]),
      referenceLists: new Map([["writer", ["references/public.md"]]]),
    }),
  });

  assertEquals(
    await replacementTool.execute({ skillId: "writer", file: "references/secret.md" }),
    {
      error:
        'Reference file not advertised by loaded skill "writer": references/secret.md. Available references: references/public.md',
    },
  );
});

Deno.test("cache record replacement invalidates private reference authorization", async () => {
  const context = createProjectContext({ availableSkillIds: ["writer"] });
  let bodyReads = 0;
  let references = ["references/secret.md"];
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: () => {
        bodyReads += 1;
        return Promise.resolve({ instructions: "# Writer", references });
      },
      loadProjectSkillReference: () => Promise.resolve("secret"),
    },
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "writer" });
  references = ["references/public.md"];
  context.loadedSkillResponses = { ...context.loadedSkillResponses };

  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/secret.md" }),
    {
      error:
        'Reference file not advertised by loaded skill "writer": references/secret.md. Available references: references/public.md',
    },
  );
  assertEquals(bodyReads, 2);
});

Deno.test("cache record replacement invalidates private duplicate payload state", async () => {
  const context = createProjectContext();
  let version = "a";
  let bodyReads = 0;
  let referenceReads = 0;
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: () => {
        bodyReads += 1;
        return Promise.resolve({
          instructions: `# Writer ${version}`,
          references: ["references/guide.md"],
        });
      },
      loadProjectSkillReference: () => {
        referenceReads += 1;
        return Promise.resolve(`guide ${version}`);
      },
    },
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "writer" });
  await tool.execute({ skillId: "writer", file: "references/guide.md" });
  version = "b";
  context.loadedSkillResponses = { ...context.loadedSkillResponses };
  context.loadedSkillReferenceResponses = { ...context.loadedSkillReferenceResponses };

  assertEquals(
    expectLoadedSkillResponse(await tool.execute({ skillId: "writer" })).instructions,
    "# Writer b",
  );
  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/guide.md" }),
    { skillId: "writer", file: "references/guide.md", content: "guide b" },
  );
  assertEquals(bodyReads, 2);
  assertEquals(referenceReads, 2);
});

Deno.test("public markers cannot fabricate current-scope duplicate payloads", async () => {
  const context = createProjectContext({
    loadedSkillResponses: {
      '["writer",null,"project-1","branch-1",null]': {
        skillId: "writer",
        instructions: "",
        references: ["references/guide.md"],
      },
    },
    loadedSkillReferenceResponses: {
      '["[\\"writer\\",null,\\"project-1\\",\\"branch-1\\",null]","references/guide.md"]': true,
    },
  });
  let bodyReads = 0;
  let referenceReads = 0;
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: () => {
        bodyReads += 1;
        return Promise.resolve({
          instructions: "# Authoritative writer",
          references: ["references/guide.md"],
        });
      },
      loadProjectSkillReference: () => {
        referenceReads += 1;
        return Promise.resolve("authoritative guide");
      },
    },
    builtinStore: createBuiltinStore({}),
  });

  assertEquals(
    expectLoadedSkillResponse(await tool.execute({ skillId: "writer" })).instructions,
    "# Authoritative writer",
  );
  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/guide.md" }),
    {
      skillId: "writer",
      file: "references/guide.md",
      content: "authoritative guide",
    },
  );
  assertEquals(bodyReads, 1);
  assertEquals(referenceReads, 1);
});

Deno.test("public marker deletion cannot revoke current-scope private authorization", async () => {
  const context = createProjectContext();
  let bodyReads = 0;
  let referenceReads = 0;
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: () => {
        bodyReads += 1;
        return Promise.resolve({
          instructions: "# Writer",
          references: ["references/guide.md"],
        });
      },
      loadProjectSkillReference: () => {
        referenceReads += 1;
        return Promise.resolve("guide");
      },
    },
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "writer" });
  for (const key of Object.keys(context.loadedSkillResponses ?? {})) {
    delete context.loadedSkillResponses?.[key];
  }

  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/guide.md" }),
    { skillId: "writer", file: "references/guide.md", content: "guide" },
  );
  assertEquals(bodyReads, 1);
  assertEquals(referenceReads, 1);
});

Deno.test("in-place skill source path cycles invalidate private authorization", async () => {
  const skillSourcePaths = { writer: "skills/a/SKILL.md" };
  const context = createProjectContext({
    availableSkillIds: ["writer"],
    skillSourcePaths,
  });
  let bodyReads = 0;
  let referenceReads = 0;
  let secretAllowed = true;
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: () => {
        bodyReads += 1;
        return Promise.resolve({
          instructions: "# Writer",
          references: secretAllowed ? ["references/secret.md"] : ["references/public.md"],
        });
      },
      loadProjectSkillReference: () => {
        referenceReads += 1;
        return Promise.resolve("secret");
      },
    },
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "writer" });
  secretAllowed = false;
  skillSourcePaths.writer = "skills/b/SKILL.md";
  await tool.execute({ skillId: "writer" });
  skillSourcePaths.writer = "skills/a/SKILL.md";

  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/secret.md" }),
    {
      error:
        'Reference file not advertised by loaded skill "writer": references/secret.md. Available references: references/public.md',
    },
  );
  assertEquals(bodyReads, 3);
  assertEquals(referenceReads, 0);
});

Deno.test("project skill loader replacement invalidates private authorization", async () => {
  let loaderABodyReads = 0;
  let loaderAReferenceReads = 0;
  const loaderA: RuntimeProjectSkillLoader = {
    listProjectSkillReferences: () => Promise.resolve([]),
    loadProjectSkill: () => {
      loaderABodyReads += 1;
      return Promise.resolve({
        instructions: "# Writer A",
        references: ["references/secret.md"],
      });
    },
    loadProjectSkillReference: () => {
      loaderAReferenceReads += 1;
      return Promise.resolve("secret A");
    },
  };
  let loaderBBodyReads = 0;
  let loaderBReferenceReads = 0;
  const loaderB: RuntimeProjectSkillLoader = {
    listProjectSkillReferences: () => Promise.resolve([]),
    loadProjectSkill: () => {
      loaderBBodyReads += 1;
      return Promise.resolve({
        instructions: "# Writer B",
        references: ["references/public.md"],
      });
    },
    loadProjectSkillReference: () => {
      loaderBReferenceReads += 1;
      return Promise.resolve("secret B");
    },
  };
  const options: RuntimeLoadSkillToolOptions = {
    context: createProjectContext(),
    skillsDir: "/skills",
    projectSkillLoader: loaderA,
    builtinStore: createBuiltinStore({}),
  };
  const tool = createRuntimeLoadSkillTool(options);

  await tool.execute({ skillId: "writer" });
  options.projectSkillLoader = loaderB;

  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/secret.md" }),
    {
      error:
        'Reference file not advertised by loaded skill "writer": references/secret.md. Available references: references/public.md',
    },
  );
  assertEquals(loaderABodyReads, 1);
  assertEquals(loaderAReferenceReads, 0);
  assertEquals(loaderBBodyReads, 1);
  assertEquals(loaderBReferenceReads, 0);
});

Deno.test("in-place project skill loader method changes invalidate private authorization", async () => {
  let version = "a";
  let bodyReads = 0;
  let referenceReads = 0;
  const loader: RuntimeProjectSkillLoader = {
    listProjectSkillReferences: () => Promise.resolve([]),
    loadProjectSkill: () => {
      bodyReads += 1;
      return Promise.resolve({
        instructions: `# Writer ${version}`,
        references: ["references/secret.md"],
      });
    },
    loadProjectSkillReference: () => {
      referenceReads += 1;
      return Promise.resolve("secret A");
    },
  };
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext(),
    skillsDir: "/skills",
    projectSkillLoader: loader,
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "writer" });
  version = "b";
  loader.loadProjectSkill = () => {
    bodyReads += 1;
    return Promise.resolve({
      instructions: "# Writer B",
      references: ["references/public.md"],
    });
  };
  loader.loadProjectSkillReference = () => {
    referenceReads += 1;
    return Promise.resolve("secret B");
  };

  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/secret.md" }),
    {
      error:
        'Reference file not advertised by loaded skill "writer": references/secret.md. Available references: references/public.md',
    },
  );
  assertEquals(bodyReads, 2);
  assertEquals(referenceReads, 0);
});

Deno.test("skillsDir changes invalidate private builtin authorization", async () => {
  const options: RuntimeLoadSkillToolOptions = {
    context: createProjectContext(),
    skillsDir: "/skills-a",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: {
      readSkill: async (skillsDir) => `# Writer from ${skillsDir}`,
      listReferences: async (skillsDir) =>
        skillsDir === "/skills-a" ? ["references/secret.md"] : ["references/public.md"],
      readReferenceFile: async (_skillsDir, _skillId, normalizedFile) =>
        normalizedFile === "references/secret.md" ? "secret" : null,
    },
  };
  const tool = createRuntimeLoadSkillTool(options);

  await tool.execute({ skillId: "writer" });
  options.skillsDir = "/skills-b";

  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/secret.md" }),
    {
      error:
        'Reference file not advertised by loaded skill "writer": references/secret.md. Available references: references/public.md',
    },
  );
});

Deno.test("accessor-backed scalar scopes are never reusable authority", async () => {
  let credential = "credential-a";
  let authTokenGetterReads = 0;
  let bodyReads = 0;
  let referenceReads = 0;
  const context = createProjectContext();
  Object.defineProperty(context, "authToken", {
    configurable: true,
    enumerable: true,
    get() {
      authTokenGetterReads += 1;
      return credential;
    },
  });
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: () => {
        bodyReads += 1;
        return Promise.resolve({
          instructions: "# Writer",
          references: credential === "credential-a"
            ? ["references/secret.md"]
            : ["references/public.md"],
        });
      },
      loadProjectSkillReference: () => {
        referenceReads += 1;
        return Promise.resolve("secret");
      },
    },
    builtinStore: createBuiltinStore({}),
  });

  await withPollutedDescriptorPrototypeValue("credential-a", async () => {
    await tool.execute({ skillId: "writer" });
    credential = "credential-b";

    assertEquals(
      await tool.execute({ skillId: "writer", file: "references/secret.md" }),
      {
        error:
          'Reference file not advertised by loaded skill "writer": references/secret.md. Available references: references/public.md',
      },
    );
  });
  assertEquals(bodyReads, 2);
  assertEquals(referenceReads, 0);
  assertEquals(authTokenGetterReads, 0);
});

Deno.test("inherited scalar accessors are never reusable authority", async () => {
  let credential = "credential-a";
  let authTokenGetterReads = 0;
  let bodyReads = 0;
  let referenceReads = 0;
  const context = createProjectContext();
  Reflect.deleteProperty(context, "authToken");
  const contextPrototype = {};
  Object.defineProperty(contextPrototype, "authToken", {
    configurable: true,
    get() {
      authTokenGetterReads += 1;
      return credential;
    },
  });
  Object.setPrototypeOf(context, contextPrototype);
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: () => {
        bodyReads += 1;
        return Promise.resolve({
          instructions: "# Writer",
          references: credential === "credential-a"
            ? ["references/secret.md"]
            : ["references/public.md"],
        });
      },
      loadProjectSkillReference: () => {
        referenceReads += 1;
        return Promise.resolve("secret");
      },
    },
    builtinStore: createBuiltinStore({}),
  });

  await tool.execute({ skillId: "writer" });
  credential = "credential-b";

  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/secret.md" }),
    {
      error:
        'Reference file not advertised by loaded skill "writer": references/secret.md. Available references: references/public.md',
    },
  );
  assertEquals(bodyReads, 2);
  assertEquals(referenceReads, 0);
  assertEquals(authTokenGetterReads, 0);
});

Deno.test("body execution ignores accessor-backed cache entries", async () => {
  const context = createProjectContext({ loadedSkillResponses: {} });
  let getterReads = 0;
  let setterWrites = 0;
  Object.defineProperty(
    context.loadedSkillResponses,
    '["writer",null,"project-1","branch-1",null]',
    {
      configurable: true,
      enumerable: true,
      get() {
        getterReads += 1;
        throw new Error("body cache getter must not run");
      },
      set(_value) {
        setterWrites += 1;
        throw new Error("body cache setter must not run");
      },
    },
  );
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({
      skills: new Map([["writer", "# Writer"]]),
    }),
  });

  const result = expectLoadedSkillResponse(await tool.execute({ skillId: "writer" }));

  assertEquals(result.instructions, "# Writer");
  assertEquals(getterReads, 0);
  assertEquals(setterWrites, 0);
});

Deno.test("reference execution ignores accessor-backed duplicate markers", async () => {
  const context = createProjectContext();
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({
      skills: new Map([["writer", "# Writer"]]),
      references: new Map([["writer/references/guide.md", "guide"]]),
      referenceLists: new Map([["writer", ["references/guide.md"]]]),
    }),
  });
  await tool.execute({ skillId: "writer" });
  const [loadedSkillKey] = Object.keys(context.loadedSkillResponses ?? {});
  if (!loadedSkillKey) throw new Error("Expected a loaded skill cache key");
  const referenceKey = JSON.stringify([loadedSkillKey, "references/guide.md"]);
  const referenceResponses = context.loadedSkillReferenceResponses ??= {};
  let getterReads = 0;
  Object.defineProperty(referenceResponses, referenceKey, {
    configurable: true,
    enumerable: true,
    get() {
      getterReads += 1;
      throw new Error("reference cache getter must not run");
    },
  });

  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/guide.md" }),
    { skillId: "writer", file: "references/guide.md", content: "guide" },
  );
  assertEquals(getterReads, 0);
});

Deno.test("cache keys ignore accessor-backed source-path values", async () => {
  let sourcePathGetterReads = 0;
  const skillSourcePaths: Record<string, string> = {};
  Object.defineProperty(skillSourcePaths, "writer", {
    configurable: true,
    enumerable: true,
    get() {
      sourcePathGetterReads += 1;
      throw new Error("source-path getter must not run");
    },
  });
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({ skillSourcePaths }),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([["writer", { instructions: "# Writer", references: [] }]]),
    }),
    builtinStore: createBuiltinStore({}),
  });

  assertEquals(
    expectLoadedSkillResponse(await tool.execute({ skillId: "writer" })).instructions,
    "# Writer",
  );
  assertEquals(sourcePathGetterReads, 0);
});

Deno.test("project-claim checks fail closed without invoking a skillSourcePaths accessor", async () => {
  let sourcePathsGetterReads = 0;
  let builtinReads = 0;
  const context = createProjectContext({ availableSkillIds: ["writer"] });
  Object.defineProperty(context, "skillSourcePaths", {
    configurable: true,
    enumerable: true,
    get() {
      sourcePathsGetterReads += 1;
      return {};
    },
  });
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: {
      readSkill: async () => {
        builtinReads += 1;
        return "# Builtin writer";
      },
      readReferenceFile: async () => null,
      listReferences: async () => [],
    },
  });

  assertEquals(await tool.execute({ skillId: "writer" }), {
    error:
      'Project skill "writer" is unavailable or no longer satisfies its validated catalog contract.',
  });
  assertEquals(sourcePathsGetterReads, 0);
  assertEquals(builtinReads, 0);
});

Deno.test("runtime skill availability snapshots do not invoke cache accessors", () => {
  let recordGetterCalls = 0;
  let responseGetterCalls = 0;
  const loadedSkillResponses: Record<string, RuntimeLoadedSkillResponse> = {};
  Object.defineProperty(loadedSkillResponses, "accessor-entry", {
    enumerable: true,
    get() {
      recordGetterCalls += 1;
      throw new Error("cache entry getter must not run");
    },
  });
  const accessorResponse = {
    instructions: "",
  } as RuntimeLoadedSkillResponse;
  Object.defineProperties(accessorResponse, {
    skillId: {
      enumerable: true,
      get() {
        responseGetterCalls += 1;
        throw new Error("skillId getter must not run");
      },
    },
    references: {
      enumerable: true,
      get() {
        responseGetterCalls += 1;
        throw new Error("references getter must not run");
      },
    },
  });
  Object.defineProperty(loadedSkillResponses, "data-entry", {
    enumerable: true,
    value: accessorResponse,
  });
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({
      availableSkillIds: ["writer"],
      loadedSkillResponses,
    }),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({}),
  });

  assertEquals(tool.inputSchemaJson, STATIC_LOAD_SKILL_INPUT_SCHEMA);
  assertEquals(recordGetterCalls, 0);
  assertEquals(responseGetterCalls, 0);
});

Deno.test("createRuntimeLoadSkillTool stores bounded reference markers without retaining content", async () => {
  const context = createProjectContext();
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({
      skills: new Map([["large", "# Large"]]),
      references: new Map([["large/references/guide.md", "reference-secret"]]),
      referenceLists: new Map([["large", ["references/guide.md"]]]),
    }),
  });
  await tool.execute({ skillId: "large" });
  const loadedSkillReferenceResponses = context.loadedSkillReferenceResponses ??= {};
  Object.assign(
    loadedSkillReferenceResponses,
    Object.fromEntries(
      Array.from({ length: 3_002 }, (_unused, index) => [`old-${index}`, true]),
    ),
  );

  const result = await tool.execute({
    skillId: "large",
    file: "references/guide.md",
  });

  assertEquals(result, {
    skillId: "large",
    file: "references/guide.md",
    content: "reference-secret",
  });
  assertEquals(Object.keys(loadedSkillReferenceResponses).length, 3_000);
  assertEquals(Object.hasOwn(loadedSkillReferenceResponses, "old-0"), false);
  assertEquals(Object.values(loadedSkillReferenceResponses).at(-1) as unknown, true);
  assertEquals(JSON.stringify(loadedSkillReferenceResponses).includes("reference-secret"), false);
});

Deno.test("createRuntimeLoadSkillTool schema disallows body reloads for already-loaded skills", async () => {
  const context = createProjectContext({
    availableSkillIds: ["plan", "veryfront"],
    loadedSkillResponses: {
      "veryfront-key": {
        skillId: "veryfront",
        instructions: "# Veryfront",
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

  assertEquals(tool.inputSchemaJson, STATIC_LOAD_SKILL_INPUT_SCHEMA);
});

it("createRuntimeLoadSkillTool advertises a static provider schema unchanged across a skill body load", async () => {
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
  assertEquals(beforeLoad, STATIC_LOAD_SKILL_INPUT_SCHEMA);

  await tool.execute({ skillId: "veryfront" });

  // The advertised schema is state-independent; the body-reload guard stays at runtime.
  const afterLoad = toolToProviderDefinition(tool).parameters;
  assertEquals(afterLoad, STATIC_LOAD_SKILL_INPUT_SCHEMA);
  assertEquals(afterLoad, beforeLoad);
  await assertRejects(() => tool.execute({ skillId: "veryfront" }));
});

it("createRuntimeLoadSkillTool advertises a static schema even when all known skills are loaded", async () => {
  const context = createProjectContext({
    availableSkillIds: ["veryfront"],
    loadedSkillResponses: {
      "veryfront-key": {
        skillId: "veryfront",
        instructions: "# Veryfront",
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

  // Reference-only-when-loaded is enforced at runtime (.parse/execute), not advertised.
  assertEquals(tool.inputSchemaJson, STATIC_LOAD_SKILL_INPUT_SCHEMA);
});

it("createRuntimeLoadSkillTool advertises a static schema after loading a skill without references (reload/extra-file guarded at runtime)", async () => {
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

  assertEquals(toolToProviderDefinition(tool).parameters, STATIC_LOAD_SKILL_INPUT_SCHEMA);

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

it("createRuntimeLoadSkillTool advertises a static schema when every skill is loaded", async () => {
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

  assertEquals(toolToProviderDefinition(tool).parameters, STATIC_LOAD_SKILL_INPUT_SCHEMA);
});

it("createRuntimeLoadSkillTool loads references and bodies under a static advertised schema", async () => {
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

  assertEquals(tool.inputSchemaJson, STATIC_LOAD_SKILL_INPUT_SCHEMA);

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

it("createRuntimeLoadSkillTool advertises a static schema, ignoring stale loaded skills outside the current manifest", async () => {
  const context = createProjectContext({
    availableSkillIds: ["veryfront"],
    loadedSkillResponses: {
      "old-plan-key": {
        skillId: "plan",
        instructions: "# Old plan",
      },
    },
  });
  const tool = createRuntimeLoadSkillTool({
    context,
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({}),
  });

  assertEquals(tool.inputSchemaJson, STATIC_LOAD_SKILL_INPUT_SCHEMA);
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

Deno.test("createRuntimeLoadSkillTool bounds and sanitizes schema input strings", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext(),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({}),
  });

  for (
    const invalidFile of [
      "",
      "a".repeat(SKILL_RELATIVE_PATH_MAX_LENGTH + 1),
      "references/secret\u0000.md",
      "references/\ud800.md",
    ]
  ) {
    await assertRejects(
      () => tool.execute({ skillId: "plan", file: invalidFile }),
      Error,
      "input validation failed",
    );
  }

  await assertRejects(
    () =>
      tool.execute({
        skillId: "a".repeat(SKILL_ID_MAX_LENGTH + ".md".length + 1),
      }),
    Error,
    "input validation failed",
  );
});

it("createRuntimeLoadSkillTool keeps IDs out of the description and points to runtime context", () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({
      availableSkillIds: ["daily-briefing"],
    }),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinSkillIds: [],
    builtinStore: createBuiltinStore({}),
  });

  // Static description — per-project IDs live in <available_skills>, not the tool
  // definition, so the description is byte-identical across projects (RFC 0001).
  assertEquals(tool.description.includes("daily-briefing"), false);
  assertStringIncludes(tool.description, "<available_skills>");
  assertStringIncludes(tool.description, "<authorized_skill_ids>");
  assertStringIncludes(tool.description, "Direct consumers can omit skillId");
  assertStringIncludes(tool.description, "You must not invent IDs");
  assertStringIncludes(tool.description, "omit skillId");
});

it("createRuntimeLoadSkillTool pages authorized IDs for standalone consumers", async () => {
  const availableSkillIds = Array.from(
    { length: 65 },
    (_, index) => `skill-${index.toString().padStart(3, "0")}`,
  );
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({ availableSkillIds }),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({}),
  });

  const first = await tool.execute({});
  assertEquals(first, {
    skillIds: availableSkillIds.slice(0, 60),
    nextCursor: 60,
  });
  const second = await tool.execute({ cursor: 60 });
  assertEquals(second, {
    skillIds: availableSkillIds.slice(60),
  });
});

it("createRuntimeLoadSkillTool discovers the maximum catalog within the default step budget", async () => {
  const availableSkillIds = Array.from(
    { length: 1_000 },
    (_, index) => `skill-${index.toString().padStart(8, "0")}`,
  );
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({ availableSkillIds }),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({}),
  });

  const discoveredSkillIds: string[] = [];
  let cursor: number | undefined;
  let calls = 0;
  do {
    const page = await tool.execute(cursor === undefined ? {} : { cursor }) as {
      skillIds: string[];
      nextCursor?: number;
    };
    discoveredSkillIds.push(...page.skillIds);
    cursor = page.nextCursor;
    calls += 1;
  } while (cursor !== undefined);

  assertEquals(discoveredSkillIds, availableSkillIds);
  assertEquals(calls <= 17, true);
});

it("createRuntimeLoadSkillTool rejects mixed load and inventory inputs", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({ availableSkillIds: ["plan"] }),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({}),
  });

  await assertRejects(
    () => tool.execute({ skillId: "plan", cursor: 0 }),
    Error,
    "input validation failed",
  );
  await assertRejects(
    () => tool.execute({ file: "references/guide.md" }),
    Error,
    "input validation failed",
  );
});

Deno.test("createRuntimeLoadSkillTool snapshots skill inventories without invoking iterators", () => {
  let availableIteratorCalls = 0;
  let builtinIteratorCalls = 0;
  const availableSkillIds = ["daily-briefing"];
  const builtinSkillIds = ["builtin-writer"];
  Object.defineProperty(availableSkillIds, Symbol.iterator, {
    configurable: true,
    value: function* () {
      availableIteratorCalls += 1;
      for (let index = 0; index < 100_001; index += 1) {
        yield `fabricated-${index}`;
      }
    },
  });
  Object.defineProperty(builtinSkillIds, Symbol.iterator, {
    configurable: true,
    value: function* () {
      builtinIteratorCalls += 1;
      for (let index = 0; index < 100_001; index += 1) {
        yield `fabricated-${index}`;
      }
    },
  });

  const projectTool = createRuntimeLoadSkillTool({
    context: createProjectContext({ availableSkillIds }),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinSkillIds,
    builtinStore: createBuiltinStore({}),
  });
  const builtinTool = createRuntimeLoadSkillTool({
    context: createProjectContext(),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinSkillIds,
    builtinStore: createBuiltinStore({}),
  });

  // The static description never enumerates skill IDs, so it cannot have walked
  // the (fabricated) iterators — which is exactly what this test guards.
  assertEquals(projectTool.description.includes("daily-briefing"), false);
  assertEquals(builtinTool.description.includes("builtin-writer"), false);
  assertEquals(availableIteratorCalls, 0);
  assertEquals(builtinIteratorCalls, 0);
  assertEquals(projectTool.description.length < 2_000, true);
  assertEquals(builtinTool.description.length < 2_000, true);
});

Deno.test("createRuntimeLoadSkillTool rejects skill inventory element accessors without invoking them", async () => {
  let getterReads = 0;
  const availableSkillIds = ["daily-briefing"];
  Object.defineProperty(availableSkillIds, 0, {
    configurable: true,
    enumerable: true,
    get() {
      getterReads += 1;
      return "fabricated";
    },
  });

  await assertRejects(
    async () => {
      createRuntimeLoadSkillTool({
        context: createProjectContext({ availableSkillIds }),
        skillsDir: "/skills",
        projectSkillLoader: createProjectSkillLoader({}),
        builtinStore: createBuiltinStore({}),
      });
    },
    TypeError,
    "availableSkillIds entry 0 must be a data property",
  );
  assertEquals(getterReads, 0);
});

Deno.test("createRuntimeLoadSkillTool bounds skill inventory entries and IDs", async () => {
  await assertRejects(
    async () => {
      createRuntimeLoadSkillTool({
        context: createProjectContext({
          availableSkillIds: Array.from({ length: 1_001 }, (_, index) => `skill-${index}`),
        }),
        skillsDir: "/skills",
        projectSkillLoader: createProjectSkillLoader({}),
        builtinStore: createBuiltinStore({}),
      });
    },
    RangeError,
    "availableSkillIds may contain at most 1000 entries",
  );
  await assertRejects(
    async () => {
      createRuntimeLoadSkillTool({
        context: createProjectContext(),
        skillsDir: "/skills",
        projectSkillLoader: createProjectSkillLoader({}),
        builtinSkillIds: ["x".repeat(257)],
        builtinStore: createBuiltinStore({}),
      });
    },
    TypeError,
    "builtinSkillIds entry 0 must be a valid bounded skill ID",
  );
});

Deno.test("builtin skill inventory cycles invalidate private reference authorization", async () => {
  const builtinSkillIds = ["writer"];
  let bodyReads = 0;
  const builtinStore: RuntimeLoadSkillBuiltinStore = {
    readSkill: async () => {
      bodyReads += 1;
      return "# Writer";
    },
    readReferenceFile: async () => "secret",
    listReferences: async () => ["references/secret.md"],
  };
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext(),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinSkillIds,
    builtinStore,
  });

  await tool.execute({ skillId: "writer" });
  builtinSkillIds[0] = "other";
  void tool.inputSchemaJson;
  builtinSkillIds[0] = "writer";

  assertEquals(
    await tool.execute({ skillId: "writer", file: "references/secret.md" }),
    {
      skillId: "writer",
      file: "references/secret.md",
      content: "secret",
    },
  );
  assertEquals(bodyReads, 2);
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

Deno.test("createRuntimeLoadSkillTool treats an empty availableSkillIds manifest as deny-all before storage reads", async () => {
  let projectReads = 0;
  let builtinReads = 0;
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({
      availableSkillIds: [],
    }),
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: () => {
        projectReads++;
        return Promise.resolve({ instructions: "# Project plan", references: [] });
      },
      loadProjectSkillReference: () => Promise.resolve(null),
    },
    builtinSkillIds: ["plan"],
    builtinStore: {
      readSkill: async () => {
        builtinReads++;
        return "# Builtin plan";
      },
      readReferenceFile: async () => {
        builtinReads++;
        return "Guide";
      },
      listReferences: async () => {
        builtinReads++;
        return ["references/guide.md"];
      },
    },
  });

  await assertRejects(
    () => tool.execute({ skillId: "plan" }),
    Error,
    "input validation failed",
  );
  await assertRejects(
    () => tool.execute({ skillId: "plan", file: "references/guide.md" }),
    Error,
    "input validation failed",
  );
  assertEquals(projectReads, 0);
  assertEquals(builtinReads, 0);
});

Deno.test("runtime load_skill rejects oversized production-loader documents", async () => {
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext(),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([
        ["large", {
          instructions: "x".repeat(SKILL_DOCUMENT_MAX_CHARACTERS + 1),
          references: [],
        }],
      ]),
    }),
    builtinStore: createBuiltinStore({}),
  });

  await assertRejects(
    () => tool.execute({ skillId: "large" }),
    RangeError,
    "Skill document may contain at most",
  );
});

Deno.test("runtime load_skill admits the complete aggregate readable-file contract", async () => {
  for (
    const referenceCount of [
      SKILL_SUBDIR_MAX_ENTRIES,
      SKILL_SUBDIR_MAX_ENTRIES + 1,
      SKILL_LOADABLE_REFERENCE_MAX_ENTRIES,
    ]
  ) {
    const references = createReadableReferenceList(referenceCount);
    const tool = createRuntimeLoadSkillTool({
      context: createProjectContext({ availableSkillIds: ["plan"] }),
      skillsDir: "/skills",
      projectSkillLoader: createProjectSkillLoader({
        skills: new Map([["plan", { instructions: "# Plan", references }]]),
      }),
      builtinStore: createBuiltinStore({}),
    });

    const response = expectLoadedSkillResponse(await tool.execute({ skillId: "plan" }));
    assertEquals(response.references?.length, referenceCount);
  }

  const perDirectoryOverflowReferences = Array.from(
    { length: SKILL_SUBDIR_MAX_ENTRIES + 1 },
    (_unused, index) => `references/${index}.txt`,
  );
  const perDirectoryOverflow = createRuntimeLoadSkillTool({
    context: createProjectContext({ availableSkillIds: ["plan"] }),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([["plan", {
        instructions: "# Plan",
        references: perDirectoryOverflowReferences,
      }]]),
    }),
    builtinStore: createBuiltinStore({}),
  });
  await assertRejects(
    () => perDirectoryOverflow.execute({ skillId: "plan" }),
    TypeError,
    "references are invalid",
  );

  const references = createReadableReferenceList(SKILL_LOADABLE_REFERENCE_MAX_ENTRIES + 1);
  const overflow = createRuntimeLoadSkillTool({
    context: createProjectContext({ availableSkillIds: ["plan"] }),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([["plan", { instructions: "# Plan", references }]]),
    }),
    builtinStore: createBuiltinStore({}),
  });
  await assertRejects(
    () => overflow.execute({ skillId: "plan" }),
    TypeError,
    "references are invalid",
  );
});

Deno.test("runtime load_skill rejects Array proxies without invoking length get traps", async () => {
  let lengthReads = 0;
  const availableToolNames = new Proxy(["invoke_agent"], {
    get(target, key, receiver) {
      if (key === "length") {
        lengthReads += 1;
        throw new Error("length getter must not run");
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({ availableToolNames }),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({}),
    builtinStore: createBuiltinStore({ skills: new Map([["plan", "# Plan"]]) }),
  });
  await assertRejects(
    () => tool.execute({ skillId: "plan" }),
    TypeError,
    "must not be a Proxy",
  );
  assertEquals(lengthReads, 0);

  const revoked = Proxy.revocable<string[]>(["plan"], {});
  revoked.revoke();
  let storageCalls = 0;
  assertThrows(
    () =>
      createRuntimeLoadSkillTool({
        context: createProjectContext({ availableSkillIds: revoked.proxy }),
        skillsDir: "/skills",
        projectSkillLoader: {
          listProjectSkillReferences: async () => [],
          loadProjectSkill: async () => {
            storageCalls += 1;
            return null;
          },
          loadProjectSkillReference: async () => null,
        },
        builtinStore: createBuiltinStore({}),
      }),
    TypeError,
    "must not be a Proxy",
  );
  assertEquals(storageCalls, 0);
});

Deno.test("runtime load_skill rejects oversized available-tool inventories before storage", async () => {
  let storageCalls = 0;
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({
      availableToolNames: Array.from(
        { length: SKILL_RUNTIME_AVAILABLE_TOOL_MAX_ENTRIES + 1 },
        (_, index) => `tool_${index}`,
      ),
    }),
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: () => {
        storageCalls += 1;
        return Promise.resolve(null);
      },
      loadProjectSkillReference: () => Promise.resolve(null),
    },
    builtinStore: createBuiltinStore({}),
  });

  await assertRejects(
    () => tool.execute({ skillId: "large" }),
    RangeError,
    "availableToolNames may contain at most",
  );
  assertEquals(storageCalls, 0);
});

Deno.test("runtime load_skill propagates caller cancellation through the shared budget", async () => {
  const controller = new AbortController();
  const reason = new Error("cancel runtime skill load");
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext(),
    skillsDir: "/skills",
    projectSkillLoader: {
      listProjectSkillReferences: () => Promise.resolve([]),
      loadProjectSkill: (_context, _skillId, operation) =>
        new Promise((_resolve, reject) => {
          const signal = operation?.budget?.abortSignal;
          signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
        }),
      loadProjectSkillReference: () => Promise.resolve(null),
    },
    builtinStore: createBuiltinStore({}),
  });

  const pending = tool.execute({ skillId: "pending" }, { abortSignal: controller.signal });
  controller.abort(reason);
  await assertRejects(() => pending, Error, reason.message);
});

Deno.test("createRuntimeLoadSkillTool snapshots tool inventory without invoking iterators", async () => {
  let iteratorCalls = 0;
  const availableToolNames = ["agent_writer"];
  Object.defineProperty(availableToolNames, Symbol.iterator, {
    configurable: true,
    value: function* () {
      iteratorCalls += 1;
      yield `agent_${"x".repeat(SKILL_DOCUMENT_MAX_CHARACTERS + 1)}`;
    },
  });
  const tool = createRuntimeLoadSkillTool({
    context: createProjectContext({ availableToolNames }),
    skillsDir: "/skills",
    projectSkillLoader: createProjectSkillLoader({
      skills: new Map([["writer", { instructions: "# Writer", references: [] }]]),
    }),
    builtinStore: createBuiltinStore({}),
  });

  expectLoadedSkillResponse(await tool.execute({ skillId: "writer" }));
  assertEquals(iteratorCalls, 0);
});

Deno.test("load_skill tool description carries the orchestration policy the result no longer does", () => {
  // Regression for the gap Codex found on veryfront/veryfront-code#3473.
  // buildAgentCallContext (call-context.ts) skips the generated
  // <available_skills> block when an agent authors its own, so the system
  // prompt cannot be relied on to carry this policy. The tool description is
  // always sent, which makes it the trusted layer that must hold it.
  for (
    const clause of [
      LOAD_SKILL_CONTINUE_SAME_TURN,
      LOAD_SKILL_ROOT_OWNERSHIP,
      LOAD_SKILL_DELEGATION_THRESHOLD,
      LOAD_SKILL_OVERRIDE_FORWARDING,
    ]
  ) {
    assertStringIncludes(RUNTIME_LOAD_SKILL_DESCRIPTION, clause);
  }
});
