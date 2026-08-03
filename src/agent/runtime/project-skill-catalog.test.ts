import "#veryfront/schemas/_test-setup.ts";
import "#veryfront/skill/_test-setup.ts";
import { assertEquals, assertExists, assertRejects, assertThrows } from "@std/assert";
import { resolve } from "node:path";
import {
  SKILL_STEERING_PATH_MAX_ENTRIES,
  SKILL_SUBDIR_MAX_ENTRIES,
  SKILL_TEXT_FILE_MAX_BYTES,
} from "#veryfront/skill/limits.ts";
import {
  getRuntimeProjectInstructions,
  getRuntimeProjectSkillCatalog,
  loadRuntimeBuiltinSkillCatalog,
} from "./project-skill-catalog.ts";
import type {
  RuntimeGetProjectFileOptions,
  RuntimeProjectFileListItem,
  RuntimeProjectFilesApiOptions,
} from "./project-files-client.ts";
import type { RuntimeSkillDefinition } from "./skill-metadata.ts";
import {
  SKILL_CATALOG_MAX_DOCUMENT_CHARACTERS,
  SKILL_CATALOG_MAX_METADATA_CHARACTERS,
  SKILL_CATALOG_MAX_PATH_ENTRIES,
  SKILL_CATALOG_MAX_SKILLS,
} from "#veryfront/skill/limits.ts";

const PROJECT_CONTEXT = {
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

function withoutRuntimeBudgetFields<T extends RuntimeProjectFilesApiOptions>(options: T) {
  const copy = { ...options };
  delete copy.abortSignal;
  delete copy.timeoutMs;
  delete copy.listingBudget;
  return copy;
}

function withTempDir(fn: (dir: string) => void): void {
  const dir = Deno.makeTempDirSync();
  try {
    fn(dir);
  } finally {
    Deno.removeSync(dir, { recursive: true });
  }
}

function createSkillCatalog(input: {
  builtinSkills?: readonly RuntimeSkillDefinition[];
  paths?: readonly string[] | null;
  contentsByPath?: Record<string, string>;
}) {
  const fileCalls: RuntimeGetProjectFileOptions[] = [];
  const filesCalls: RuntimeProjectFilesApiOptions[] = [];
  const contentsByPath = input.contentsByPath ?? {};

  return {
    catalog: () =>
      getRuntimeProjectSkillCatalog({
        ...PROJECT_CONTEXT,
        builtinSkills: input.builtinSkills ?? [],
        getProjectFiles: async (options) => {
          filesCalls.push(options);
          if (input.paths === null) return null;
          const prefix = options.pathPrefix ? `${options.pathPrefix}/` : undefined;
          return (input.paths ?? [])
            .filter((path) => !prefix || path.startsWith(prefix))
            .map((path) => ({ path }));
        },
        getProjectFile: async (options) => {
          fileCalls.push(options);
          const content = contentsByPath[options.path];
          return content ? { path: options.path, content } : null;
        },
      }),
    fileCalls,
    filesCalls,
  };
}

Deno.test("loadRuntimeBuiltinSkillCatalog loads flat and directory skills with references", () => {
  withTempDir((rootDir) => {
    Deno.writeTextFileSync(
      resolve(rootDir, "plan.md"),
      "---\ndescription: Plan work\nallowed-tools: bash, edit\n---\n\n# Plan",
    );
    Deno.mkdirSync(resolve(rootDir, "research", "references", "nested"), { recursive: true });
    Deno.mkdirSync(resolve(rootDir, "research", "resources"), { recursive: true });
    Deno.mkdirSync(resolve(rootDir, "research", "assets"), { recursive: true });
    Deno.writeTextFileSync(
      resolve(rootDir, "research", "SKILL.md"),
      "---\nname: research\ndescription: Research\nmodel: sonnet\n---\n\n# Research",
    );
    Deno.writeTextFileSync(resolve(rootDir, "research", "references", "guide.md"), "# Guide");
    Deno.writeTextFileSync(
      resolve(rootDir, "research", "references", "nested", "details.md"),
      "# Details",
    );
    Deno.writeTextFileSync(resolve(rootDir, "research", "resources", "schema.json"), "{}");
    Deno.writeTextFileSync(resolve(rootDir, "research", "assets", "template.txt"), "template");

    const catalog = loadRuntimeBuiltinSkillCatalog({ skillsDir: rootDir });

    assertEquals(catalog.map((skill) => skill.id), ["plan", "research"]);
    assertEquals(catalog[0]?.allowedTools, ["bash", "edit"]);
    assertEquals(catalog[1]?.references, [
      "assets/template.txt",
      "references/guide.md",
      "references/nested/details.md",
      "resources/schema.json",
    ]);
  });
});

Deno.test("loadRuntimeBuiltinSkillCatalog logs path-free root failures", () => {
  withTempDir((rootDir) => {
    const invalidRoot = resolve(rootDir, "not-a-directory");
    Deno.writeTextFileSync(invalidRoot, "body");
    const errors: Array<{ message: string; metadata?: Record<string, unknown> }> = [];

    assertEquals(
      loadRuntimeBuiltinSkillCatalog({
        skillsDir: invalidRoot,
        logger: {
          error: (message, metadata) => errors.push({ message, metadata }),
        },
      }),
      [],
    );
    assertEquals(errors, [{
      message: "Failed to load built-in skills",
      metadata: { error: "Built-in skills root must be a directory" },
    }]);
    assertEquals(JSON.stringify(errors).includes(rootDir), false);
  });
});

Deno.test("builtin directory skills take precedence over flat files with the same id", () => {
  withTempDir((rootDir) => {
    Deno.writeTextFileSync(
      resolve(rootDir, "writer.md"),
      "---\ndescription: Flat writer\nallowed-tools: shell\n---\n\n# Flat writer",
    );
    Deno.mkdirSync(resolve(rootDir, "writer"), { recursive: true });
    Deno.writeTextFileSync(
      resolve(rootDir, "writer", "SKILL.md"),
      "---\nname: writer\ndescription: Directory writer\nallowed-tools: read_file\n---\n\n# Directory writer",
    );

    const catalog = loadRuntimeBuiltinSkillCatalog({ skillsDir: rootDir });

    assertEquals(catalog.length, 1);
    assertEquals(catalog[0]?.id, "writer");
    assertEquals(catalog[0]?.description, "Directory writer");
    assertEquals(catalog[0]?.allowedTools, ["read_file"]);
    assertEquals(catalog[0]?.instructions.includes("# Directory writer"), true);
  });
});

Deno.test("built-in catalog rejects work beyond the cumulative skill limit", () => {
  withTempDir((rootDir) => {
    for (let index = 0; index <= SKILL_CATALOG_MAX_SKILLS; index += 1) {
      Deno.writeTextFileSync(resolve(rootDir, `skill-${index}.md`), "# Skill");
    }
    assertThrows(
      () => loadRuntimeBuiltinSkillCatalog({ skillsDir: rootDir }),
      RangeError,
      `at most ${SKILL_CATALOG_MAX_SKILLS} skills`,
    );
  });
});

Deno.test("hosted catalog accepts the exact document aggregate and rejects one character over", async () => {
  const exact = Array.from({ length: 8 }, (_, index) => ({
    id: `skill-${index}`,
    name: `skill-${index}`,
    description: "Skill",
    instructions: "x".repeat(SKILL_CATALOG_MAX_DOCUMENT_CHARACTERS / 8),
    allowedTools: [],
  }));
  const getProjectFiles = () => Promise.resolve(null);
  const getProjectFile = () => Promise.resolve(null);

  assertEquals(
    await getRuntimeProjectSkillCatalog({
      ...PROJECT_CONTEXT,
      builtinSkills: exact,
      getProjectFiles,
      getProjectFile,
    }),
    exact,
  );
  await assertRejects(
    () =>
      getRuntimeProjectSkillCatalog({
        ...PROJECT_CONTEXT,
        builtinSkills: [...exact, {
          id: "over",
          name: "over",
          description: "Over",
          instructions: "x",
          allowedTools: [],
        }],
        getProjectFiles,
        getProjectFile,
      }),
    RangeError,
    `at most ${SKILL_CATALOG_MAX_DOCUMENT_CHARACTERS} characters`,
  );
});

Deno.test("hosted catalog enforces retained metadata cumulatively before discovery", async () => {
  const exactDescription = "x".repeat(SKILL_CATALOG_MAX_METADATA_CHARACTERS - 2);
  const exact: RuntimeSkillDefinition = {
    id: "a",
    name: "a",
    description: exactDescription,
    instructions: "",
    allowedTools: [],
  };
  assertEquals(
    await getRuntimeProjectSkillCatalog({
      ...PROJECT_CONTEXT,
      builtinSkills: [exact],
      getProjectFiles: () => Promise.resolve(null),
      getProjectFile: () => Promise.resolve(null),
    }),
    [exact],
  );
  await assertRejects(
    () =>
      getRuntimeProjectSkillCatalog({
        ...PROJECT_CONTEXT,
        builtinSkills: [{ ...exact, description: `${exactDescription}x` }],
        getProjectFiles: () => Promise.resolve(null),
        getProjectFile: () => Promise.resolve(null),
      }),
    RangeError,
    `at most ${SKILL_CATALOG_MAX_METADATA_CHARACTERS} characters`,
  );
});

Deno.test("hosted catalog accepts the exact aggregate reference count and rejects one over", async () => {
  const definition = (id: string, count: number): RuntimeSkillDefinition => ({
    id,
    name: id,
    description: id,
    instructions: "",
    allowedTools: [],
    references: Array.from({ length: count }, (_, index) => `references/${id}-${index}.md`),
  });
  const exact = [
    definition("first", SKILL_CATALOG_MAX_PATH_ENTRIES / 2),
    definition("second", SKILL_CATALOG_MAX_PATH_ENTRIES / 2),
  ];
  const getProjectFiles = () => Promise.resolve(null);
  const getProjectFile = () => Promise.resolve(null);
  assertEquals(
    await getRuntimeProjectSkillCatalog({
      ...PROJECT_CONTEXT,
      builtinSkills: exact,
      getProjectFiles,
      getProjectFile,
    }),
    exact,
  );
  await assertRejects(
    () =>
      getRuntimeProjectSkillCatalog({
        ...PROJECT_CONTEXT,
        builtinSkills: [...exact, definition("over", 1)],
        getProjectFiles,
        getProjectFile,
      }),
    RangeError,
    `at most ${SKILL_CATALOG_MAX_PATH_ENTRIES} entries`,
  );
});

Deno.test("getRuntimeProjectInstructions returns the first available instruction file", async () => {
  const fileCalls: RuntimeGetProjectFileOptions[] = [];

  const instructions = await getRuntimeProjectInstructions({
    ...PROJECT_CONTEXT,
    getProjectFile: async (options) => {
      fileCalls.push(options);
      return options.path === "AGENTS.md" ? { path: options.path, content: "# Agent" } : null;
    },
  });

  assertEquals(instructions, "# Agent");
  assertEquals(fileCalls.map(withoutRuntimeBudgetFields), [
    {
      ...PROJECT_CONTEXT,
      path: "AGENTS.md",
      maximumContentCharacters: 1_048_576,
    },
  ]);
});

Deno.test("getRuntimeProjectInstructions rejects untrusted custom loader responses", async () => {
  await assertRejects(
    () =>
      getRuntimeProjectInstructions({
        ...PROJECT_CONTEXT,
        getProjectFile: async ({ path }) => ({
          path: `${path}.mismatch`,
          content: "# Wrong file",
        }),
      }),
    TypeError,
    "did not match requested path",
  );

  await assertRejects(
    () =>
      getRuntimeProjectInstructions({
        ...PROJECT_CONTEXT,
        getProjectFile: async ({ path }) => ({
          path,
          content: "x".repeat(SKILL_TEXT_FILE_MAX_BYTES + 1),
        }),
      }),
    RangeError,
    "content exceeds",
  );
});

Deno.test("getRuntimeProjectSkillCatalog returns builtin skills when project files are unavailable", async () => {
  const builtinSkills = [
    {
      id: "plan",
      name: "plan",
      description: "Plan",
      instructions: "# Plan",
      allowedTools: [],
    },
  ];
  const { catalog } = createSkillCatalog({ builtinSkills, paths: null });

  assertEquals(await catalog(), builtinSkills);
});

Deno.test("project skill catalog rejects oversized discovery before scheduling file reads", async () => {
  let fileReads = 0;
  await assertRejects(
    () =>
      getRuntimeProjectSkillCatalog({
        ...PROJECT_CONTEXT,
        builtinSkills: [],
        getProjectFiles: () =>
          Promise.resolve(
            Array.from({ length: 1_001 }, (_, index) => ({ path: `skills/${index}.md` })),
          ),
        getProjectFile: () => {
          fileReads += 1;
          return Promise.resolve(null);
        },
      }),
    RangeError,
    "may contain at most 1000 entries",
  );
  assertEquals(fileReads, 0);
});

Deno.test("getRuntimeProjectSkillCatalog parses project directory skills and references", async () => {
  const { catalog, filesCalls, fileCalls } = createSkillCatalog({
    paths: [
      "skills/research/SKILL.md",
      "skills/research/references/checklists/checklist.md",
      "skills/research/resources/schema.json",
      "skills/research/assets/template.txt",
      "skills/research/scripts/ignored.ts",
    ],
    contentsByPath: {
      "skills/research/SKILL.md":
        "---\nname: research\ndescription: Research deeply\nmodel: sonnet\nthinking: false\nmax-steps: 7\nallowed-tools:\n  - bash\n---\n\n# Research",
    },
  });

  const skills = await catalog();
  const research = skills.find((skill) => skill.id === "research");

  assertExists(research);
  assertEquals(research.description, "Research deeply");
  assertEquals(research.model, "sonnet");
  assertEquals(research.thinking, false);
  assertEquals(research.maxSteps, 7);
  assertEquals(research.allowedTools, ["bash"]);
  assertEquals(research.references, [
    "assets/template.txt",
    "references/checklists/checklist.md",
    "resources/schema.json",
  ]);
  assertEquals(filesCalls.map(withoutRuntimeBudgetFields), [
    { ...PROJECT_CONTEXT, pathPrefix: "skills", maximumEntries: 1_000 },
    { ...PROJECT_CONTEXT, pathPrefix: ".veryfront/skills", maximumEntries: 1_000 },
    { ...PROJECT_CONTEXT, pathPrefix: "agents", maximumEntries: 1_000 },
  ]);
  assertEquals(fileCalls.map(withoutRuntimeBudgetFields), [
    {
      ...PROJECT_CONTEXT,
      path: "skills/research/SKILL.md",
      maximumContentCharacters: 1_048_576,
    },
  ]);
});

Deno.test("project catalog only treats immediate child directories as directory skills", async () => {
  const builtinSkills: RuntimeSkillDefinition[] = [{
    id: "shared",
    name: "shared",
    description: "Builtin shared",
    instructions: "# Builtin shared",
    allowedTools: [],
  }];
  const { catalog, fileCalls } = createSkillCatalog({
    builtinSkills,
    paths: ["skills/group/shared/SKILL.md"],
    contentsByPath: {
      "skills/group/shared/SKILL.md":
        "---\nname: shared\ndescription: Nested impostor\n---\n\n# Nested",
    },
  });

  assertEquals(await catalog(), builtinSkills);
  assertEquals(fileCalls, []);
});

Deno.test("getRuntimeProjectSkillCatalog prefers directory skills and lets project skills override builtins", async () => {
  const builtinSkills = [
    {
      id: "alpha",
      name: "alpha",
      description: "Builtin alpha",
      instructions: "# Builtin alpha",
      allowedTools: [],
    },
    {
      id: "shared",
      name: "shared",
      description: "Builtin shared",
      instructions: "# Builtin shared",
      allowedTools: [],
    },
  ];
  const { catalog } = createSkillCatalog({
    builtinSkills,
    paths: [
      "skills/shared.md",
      "skills/shared/SKILL.md",
      "skills/zeta.md",
    ],
    contentsByPath: {
      "skills/shared.md": "---\ndescription: Flat shared\n---\n\n# Shared flat",
      "skills/shared/SKILL.md":
        "---\nname: shared\ndescription: Directory shared\n---\n\n# Shared directory",
      "skills/zeta.md": "---\ndescription: Zeta\n---\n\n# Zeta",
    },
  });

  const skills = await catalog();
  const shared = skills.find((skill) => skill.id === "shared");

  assertExists(shared);
  assertEquals(shared.description, "Directory shared");
  assertEquals(skills.map((skill) => skill.id), ["alpha", "shared", "zeta"]);
});

Deno.test("an invalid directory skill fails closed instead of falling through to flat or builtin", async () => {
  const builtinSkills: RuntimeSkillDefinition[] = [{
    id: "shared",
    name: "shared",
    description: "Builtin shared",
    instructions: "# Builtin shared",
    allowedTools: [],
  }];
  const { catalog, fileCalls } = createSkillCatalog({
    builtinSkills,
    paths: ["skills/shared.md", "skills/shared/SKILL.md"],
    contentsByPath: {
      "skills/shared.md": "---\ndescription: Flat shared\n---\n\n# Flat fallback",
      "skills/shared/SKILL.md": "---\nname: shared\n---\n\n# Missing required description",
    },
  });

  assertEquals(await catalog(), []);
  assertEquals(fileCalls.map((call) => call.path), ["skills/shared/SKILL.md"]);
});

Deno.test("a mismatched project-file response path fails closed for the claimed skill", async () => {
  const errors: Array<Record<string, unknown> | undefined> = [];
  const skills = await getRuntimeProjectSkillCatalog({
    ...PROJECT_CONTEXT,
    builtinSkills: [{
      id: "shared",
      name: "shared",
      description: "Builtin shared",
      instructions: "# Builtin shared",
      allowedTools: [],
    }],
    getProjectFiles: async () => [{ path: "skills/shared/SKILL.md" }],
    getProjectFile: async () => ({
      path: "skills/other/SKILL.md",
      content: "---\nname: shared\ndescription: Shared\n---\nBody",
    }),
    logger: {
      error: (_message, metadata) => errors.push(metadata),
    },
  });

  assertEquals(skills, []);
  assertEquals(errors, [{
    expectedPath: "skills/shared/SKILL.md",
    responsePath: "skills/other/SKILL.md",
  }]);
});

Deno.test("getRuntimeProjectSkillCatalog still parses legacy hidden project skills", async () => {
  const { catalog, fileCalls } = createSkillCatalog({
    paths: [".veryfront/skills/legacy/SKILL.md"],
    contentsByPath: {
      ".veryfront/skills/legacy/SKILL.md":
        "---\nname: legacy\ndescription: Legacy\n---\n\n# Legacy",
    },
  });

  const skills = await catalog();

  assertEquals(skills.map((skill) => skill.id), ["legacy"]);
  assertEquals(fileCalls.map((call) => call.path), [".veryfront/skills/legacy/SKILL.md"]);
});

// ── Colocated (agent-owned) skills in the catalog (review finding) ────────

const CITE_SKILL_MD = `---
name: cite
description: Cite sources properly
---
Cite primary sources.
`;

const RESEARCHER_SKILL_MD = `---
name: researcher
description: Research methodology
---
Follow the method.
`;

Deno.test("catalog includes colocated skills with owner metadata and source paths", async () => {
  const { catalog } = createSkillCatalog({
    paths: [
      "agents/researcher/AGENT.md",
      "agents/researcher/SKILL.md",
      "agents/researcher/skills/cite/SKILL.md",
      "agents/researcher/skills/cite/references/styles.md",
    ],
    contentsByPath: {
      "agents/researcher/SKILL.md": RESEARCHER_SKILL_MD,
      "agents/researcher/skills/cite/SKILL.md": CITE_SKILL_MD,
    },
  });

  const skills = await catalog();
  const ids = skills.map((skill) => skill.id).sort();
  assertEquals(ids, ["researcher", "researcher--cite"]);

  const nested = skills.find((skill) => skill.id === "researcher--cite");
  assertEquals(nested?.ownerAgentId, "researcher");
  assertEquals(nested?.shortName, "cite");
  assertEquals(nested?.sourcePath, "agents/researcher/skills/cite/SKILL.md");
  assertEquals(nested?.references, ["references/styles.md"]);

  const own = skills.find((skill) => skill.id === "researcher");
  assertEquals(own?.ownerAgentId, "researcher");
  assertEquals(own?.sourcePath, "agents/researcher/SKILL.md");
});

Deno.test("catalog quarantines an exact global and agent-owned skill id collision", async () => {
  const errors: string[] = [];
  const skills = await getRuntimeProjectSkillCatalog({
    ...PROJECT_CONTEXT,
    builtinSkills: [],
    getProjectFiles: async () => [
      { path: "skills/researcher/SKILL.md" },
      { path: "agents/researcher/AGENT.md" },
      { path: "agents/researcher/SKILL.md" },
    ],
    getProjectFile: async ({ path }) => {
      if (path === "skills/researcher/SKILL.md") {
        return {
          path,
          content: "---\nname: researcher\ndescription: Global researcher\n---\nGlobal policy.",
        };
      }
      if (path === "agents/researcher/SKILL.md") {
        return { path, content: RESEARCHER_SKILL_MD };
      }
      return null;
    },
    logger: {
      error: (message) => errors.push(message),
    },
  });

  assertEquals(skills.some((skill) => skill.id === "researcher"), false);
  assertEquals(errors.some((message) => message.includes('skill id "researcher"')), true);
});

Deno.test("catalog ignores colocated skills without an owning AGENT.md", async () => {
  const { catalog, fileCalls } = createSkillCatalog({
    paths: [
      "agents/orphan/SKILL.md",
      "agents/orphan/skills/cite/SKILL.md",
      "agents/researcher/AGENT.md",
      "agents/researcher/skills/cite/SKILL.md",
    ],
    contentsByPath: {
      "agents/orphan/SKILL.md": RESEARCHER_SKILL_MD,
      "agents/orphan/skills/cite/SKILL.md": CITE_SKILL_MD,
      "agents/researcher/skills/cite/SKILL.md": CITE_SKILL_MD,
    },
  });

  const skills = await catalog();

  assertEquals(skills.map((skill) => skill.id), ["researcher--cite"]);
  assertEquals(
    fileCalls.map((call) => call.path),
    ["agents/researcher/skills/cite/SKILL.md"],
  );
});

Deno.test("catalog rejects colliding sanitized agent capability namespaces", async () => {
  let fileFetches = 0;

  await assertRejects(
    () =>
      getRuntimeProjectSkillCatalog({
        ...PROJECT_CONTEXT,
        builtinSkills: [],
        getProjectFiles: async () => [
          { path: "agents/a.b/AGENT.md" },
          { path: "agents/a.b/skills/cite/SKILL.md" },
          { path: "agents/a_b/AGENT.md" },
          { path: "agents/a_b/skills/cite/SKILL.md" },
        ],
        getProjectFile: async () => {
          fileFetches += 1;
          return null;
        },
      }),
    TypeError,
    "collide after sanitized capability namespace",
  );
  assertEquals(fileFetches, 0);
});

Deno.test("catalog accepts provider-safe colocated skill ids for dotted agent ids", async () => {
  const { catalog } = createSkillCatalog({
    paths: [
      "agents/a.b/AGENT.md",
      "agents/a.b/skills/x_y/SKILL.md",
      "agents/a.b/skills/x_y/references/styles.md",
    ],
    contentsByPath: {
      "agents/a.b/skills/x_y/SKILL.md": `---
name: X Y
description: Owned underscore helper
metadata:
  display_name: X Y
---
Use X Y.
`,
    },
  });

  const skills = await catalog();
  assertEquals(skills.map((skill) => skill.id), ["a_b--x_y"]);
  const nested = skills[0];
  assertEquals(nested?.name, "a_b--x_y");
  assertEquals(nested?.displayName, "X Y");
  assertEquals(nested?.ownerAgentId, "a.b");
  assertEquals(nested?.shortName, "x_y");
  assertEquals(nested?.sourcePath, "agents/a.b/skills/x_y/SKILL.md");
  assertEquals(nested?.references, ["references/styles.md"]);
});

Deno.test("catalog keeps global skills unowned and carries their source paths", async () => {
  const { catalog } = createSkillCatalog({
    paths: ["skills/gmail/SKILL.md"],
    contentsByPath: {
      "skills/gmail/SKILL.md": "---\nname: gmail\ndescription: Use Gmail safely\n---\n\nUse Gmail.",
    },
  });

  const skills = await catalog();
  assertEquals(skills.length, 1);
  assertEquals(skills[0]?.ownerAgentId, undefined);
  assertEquals(skills[0]?.sourcePath, "skills/gmail/SKILL.md");
});

Deno.test("project skill catalog caps declarations and concurrent content fetches", async () => {
  const paths = Array.from(
    { length: 40 },
    (_unused, index) => `skills/skill-${index}/SKILL.md`,
  );
  let activeFetches = 0;
  let maxActiveFetches = 0;
  const skills = await getRuntimeProjectSkillCatalog({
    ...PROJECT_CONTEXT,
    builtinSkills: [],
    getProjectFiles: async () => paths.map((path) => ({ path })),
    getProjectFile: async ({ path }) => {
      activeFetches += 1;
      maxActiveFetches = Math.max(maxActiveFetches, activeFetches);
      await new Promise((resolve) => setTimeout(resolve, 1));
      activeFetches -= 1;
      const id = path.split("/")[1]!;
      return {
        path,
        content: `---\nname: ${id}\ndescription: Bounded ${id}\n---\nBody`,
      };
    },
  });

  assertEquals(skills.length, paths.length);
  assertEquals(maxActiveFetches <= 16, true);

  let fileFetches = 0;
  await assertRejects(
    () =>
      getRuntimeProjectSkillCatalog({
        ...PROJECT_CONTEXT,
        builtinSkills: [],
        getProjectFiles: async () =>
          Array.from(
            { length: SKILL_SUBDIR_MAX_ENTRIES + 1 },
            (_unused, index) => ({ path: `skills/declared-${index}/SKILL.md` }),
          ),
        getProjectFile: async () => {
          fileFetches += 1;
          return null;
        },
      }),
    RangeError,
    `${SKILL_SUBDIR_MAX_ENTRIES}`,
  );
  assertEquals(fileFetches, 0);
});

Deno.test("project skill catalog stops scheduling after a fetch failure and awaits in-flight work", async () => {
  const paths = Array.from(
    { length: 40 },
    (_unused, index) => `skills/skill-${index}/SKILL.md`,
  );
  let fileFetches = 0;

  await assertRejects(
    () =>
      getRuntimeProjectSkillCatalog({
        ...PROJECT_CONTEXT,
        builtinSkills: [],
        getProjectFiles: async () => paths.map((path) => ({ path })),
        getProjectFile: async ({ path }) => {
          fileFetches += 1;
          if (path === "skills/skill-0/SKILL.md") {
            throw new Error("fetch failed");
          }
          await new Promise((resolve) => setTimeout(resolve, 5));
          return null;
        },
      }),
    Error,
    "fetch failed",
  );

  const fetchesAtRejection = fileFetches;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assertEquals(fetchesAtRejection <= 16, true);
  assertEquals(fileFetches, fetchesAtRejection);
});

Deno.test("project catalog enforces its aggregate path budget before content fetches", async () => {
  const skillPath = "skills/research/SKILL.md";
  const readablePaths = ["references", "resources", "assets"].flatMap((directory) =>
    Array.from(
      { length: SKILL_SUBDIR_MAX_ENTRIES },
      (_unused, index) => `skills/research/${directory}/${index}.txt`,
    )
  );
  const skillContent = "---\nname: research\ndescription: Research\n---\nBody";

  await assertRejects(
    () =>
      getRuntimeProjectSkillCatalog({
        ...PROJECT_CONTEXT,
        builtinSkills: [],
        getProjectFiles: async () => [
          { path: skillPath },
          ...readablePaths.map((path) => ({ path })),
        ],
        getProjectFile: async ({ path }) =>
          path === skillPath ? { path, content: skillContent } : null,
      }),
    RangeError,
    "Skill catalog paths",
  );
});

Deno.test("project steering path lists are bounded before lookup", async () => {
  let fileFetches = 0;
  await assertRejects(
    () =>
      getRuntimeProjectInstructions({
        ...PROJECT_CONTEXT,
        steeringPaths: {
          instructions: Array.from(
            { length: SKILL_STEERING_PATH_MAX_ENTRIES + 1 },
            (_unused, index) => `instructions-${index}.md`,
          ),
        },
        getProjectFile: async () => {
          fileFetches += 1;
          return null;
        },
      }),
    RangeError,
    `${SKILL_STEERING_PATH_MAX_ENTRIES}`,
  );
  assertEquals(fileFetches, 0);
});

Deno.test("project catalog rejects accessor entries despite inherited descriptor values", async () => {
  let getterReads = 0;
  let fileFetches = 0;
  const listing: RuntimeProjectFileListItem[] = [];
  Object.defineProperty(listing, 0, {
    enumerable: true,
    get() {
      getterReads += 1;
      return { path: "skills/accessor/SKILL.md" };
    },
  });

  await withPollutedDescriptorPrototypeValue(
    { path: "skills/injected/SKILL.md" },
    async () => {
      await assertRejects(
        () =>
          getRuntimeProjectSkillCatalog({
            ...PROJECT_CONTEXT,
            builtinSkills: [],
            getProjectFiles: async () => listing,
            getProjectFile: async () => {
              fileFetches += 1;
              return null;
            },
          }),
        TypeError,
        "item 0",
      );
    },
  );

  assertEquals(getterReads, 0);
  assertEquals(fileFetches, 0);
});
