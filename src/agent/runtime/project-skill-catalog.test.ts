import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertExists } from "@std/assert";
import { resolve } from "node:path";
import {
  getRuntimeProjectInstructions,
  getRuntimeProjectSkillCatalog,
  loadRuntimeBuiltinSkillCatalog,
} from "./project-skill-catalog.ts";
import type {
  RuntimeGetProjectFileOptions,
  RuntimeProjectFilesApiOptions,
} from "./project-files-client.ts";
import type { RuntimeSkillDefinition } from "./skill-metadata.ts";

const PROJECT_CONTEXT = {
  projectId: "project-1",
  authToken: "auth-token",
  branchId: "branch-1",
};

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
          return input.paths === null ? null : (input.paths ?? []).map((path) => ({ path }));
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
    Deno.mkdirSync(resolve(rootDir, "research", "references"), { recursive: true });
    Deno.writeTextFileSync(
      resolve(rootDir, "research", "SKILL.md"),
      "---\ndescription: Research\nmodel: sonnet\n---\n\n# Research",
    );
    Deno.writeTextFileSync(resolve(rootDir, "research", "references", "guide.md"), "# Guide");

    const catalog = loadRuntimeBuiltinSkillCatalog({ skillsDir: rootDir });

    assertEquals(catalog.map((skill) => skill.id), ["plan", "research"]);
    assertEquals(catalog[0]?.allowedTools, ["bash", "edit"]);
    assertEquals(catalog[1]?.references, ["references/guide.md"]);
  });
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
  assertEquals(fileCalls, [
    {
      ...PROJECT_CONTEXT,
      path: "AGENTS.md",
    },
  ]);
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

Deno.test("getRuntimeProjectSkillCatalog parses project directory skills and references", async () => {
  const { catalog, filesCalls, fileCalls } = createSkillCatalog({
    paths: [
      "skills/research/SKILL.md",
      "skills/research/references/checklists/checklist.md",
    ],
    contentsByPath: {
      "skills/research/SKILL.md":
        "---\ndescription: Research deeply\nmodel: sonnet\nthinking: false\nmax-steps: 7\nallowed-tools:\n  - bash\n---\n\n# Research",
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
  assertEquals(research.references, ["references/checklists/checklist.md"]);
  assertEquals(filesCalls, [PROJECT_CONTEXT]);
  assertEquals(fileCalls, [
    {
      ...PROJECT_CONTEXT,
      path: "skills/research/SKILL.md",
    },
  ]);
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
      "skills/shared/SKILL.md": "---\ndescription: Directory shared\n---\n\n# Shared directory",
      "skills/zeta.md": "---\ndescription: Zeta\n---\n\n# Zeta",
    },
  });

  const skills = await catalog();
  const shared = skills.find((skill) => skill.id === "shared");

  assertExists(shared);
  assertEquals(shared.description, "Directory shared");
  assertEquals(skills.map((skill) => skill.id), ["alpha", "shared", "zeta"]);
});

Deno.test("getRuntimeProjectSkillCatalog still parses legacy hidden project skills", async () => {
  const { catalog, fileCalls } = createSkillCatalog({
    paths: [".veryfront/skills/legacy/SKILL.md"],
    contentsByPath: {
      ".veryfront/skills/legacy/SKILL.md": "---\ndescription: Legacy\n---\n\n# Legacy",
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

Deno.test("catalog keeps global skills unowned and carries their source paths", async () => {
  const { catalog } = createSkillCatalog({
    paths: ["skills/gmail/SKILL.md"],
    contentsByPath: {
      "skills/gmail/SKILL.md": CITE_SKILL_MD,
    },
  });

  const skills = await catalog();
  assertEquals(skills.length, 1);
  assertEquals(skills[0]?.ownerAgentId, undefined);
  assertEquals(skills[0]?.sourcePath, "skills/gmail/SKILL.md");
});
