import { assertEquals } from "#veryfront/testing/assert.ts";
import { createRuntimeProjectSkillLoader } from "./project-skill-loader.ts";
import type {
  RuntimeGetProjectFileOptions,
  RuntimeProjectFile,
  RuntimeProjectFileListItem,
  RuntimeProjectFilesApiOptions,
} from "./project-files-client.ts";

class AccessDeniedError extends Error {}

const PROJECT_CONTEXT = {
  projectId: "project-1",
  authToken: "auth-token",
  branchId: "branch-1",
};

type FileCall = RuntimeGetProjectFileOptions;
type FilesCall = RuntimeProjectFilesApiOptions;

function createLoader(input: {
  getProjectFile?: (options: RuntimeGetProjectFileOptions) => Promise<RuntimeProjectFile | null>;
  getProjectFiles?: (
    options: RuntimeProjectFilesApiOptions,
  ) => Promise<RuntimeProjectFileListItem[]>;
  warnings?: Array<{ message: string; metadata?: Record<string, unknown> }>;
} = {}) {
  const fileCalls: FileCall[] = [];
  const filesCalls: FilesCall[] = [];
  const warnings = input.warnings ?? [];

  return {
    loader: createRuntimeProjectSkillLoader({
      getProjectFile: async (options) => {
        fileCalls.push(options);
        return input.getProjectFile ? await input.getProjectFile(options) : null;
      },
      getProjectFiles: async (options) => {
        filesCalls.push(options);
        return input.getProjectFiles ? await input.getProjectFiles(options) : [];
      },
      isAccessDeniedError: (error) => error instanceof AccessDeniedError,
      logger: {
        warn: (message, metadata) => warnings.push({ message, metadata }),
      },
    }),
    fileCalls,
    filesCalls,
    warnings,
  };
}

Deno.test("runtime project skill loader returns empty results without project context", async () => {
  const { loader, fileCalls, filesCalls } = createLoader();
  const context = { authToken: "auth-token", projectId: null, branchId: null };

  assertEquals(await loader.listProjectSkillReferences(context, "research"), []);
  assertEquals(await loader.loadProjectSkill(context, "research"), null);
  assertEquals(
    await loader.loadProjectSkillReference(context, "research", "references/guide.md"),
    null,
  );
  assertEquals(fileCalls, []);
  assertEquals(filesCalls, []);
});

Deno.test("runtime project skill loader loads directory skills with normalized sorted references", async () => {
  const { loader } = createLoader({
    getProjectFile: async ({ path }) =>
      path === ".veryfront/skills/research/SKILL.md" ? { path, content: "# Research" } : null,
    getProjectFiles: async () => [
      { path: ".veryfront/skills/research/references/zeta.md" },
      { path: ".veryfront/skills/research/references/checklists/checklist.md" },
      { path: ".veryfront/skills/other/references/skip.md" },
      { path: ".veryfront/skills/research/references//invalid.md" },
    ],
  });

  assertEquals(await loader.loadProjectSkill(PROJECT_CONTEXT, "research"), {
    instructions: "# Research",
    references: ["references/checklists/checklist.md", "references/zeta.md"],
  });
});

Deno.test("runtime project skill loader falls back to flat project skills without references", async () => {
  const { loader, fileCalls } = createLoader({
    getProjectFile: async ({ path }) =>
      path === ".veryfront/skills/custom.md" ? { path, content: "# Custom" } : null,
  });

  assertEquals(await loader.loadProjectSkill(PROJECT_CONTEXT, "custom"), {
    instructions: "# Custom",
    references: [],
  });
  assertEquals(fileCalls.map((call) => call.path), [
    ".veryfront/skills/custom/SKILL.md",
    ".veryfront/skills/custom.md",
  ]);
});

Deno.test("runtime project skill loader loads project skill reference content", async () => {
  const { loader } = createLoader({
    getProjectFile: async ({ path }) =>
      path === ".veryfront/skills/research/references/guide.md"
        ? { path, content: "# Guide" }
        : null,
  });

  assertEquals(
    await loader.loadProjectSkillReference(PROJECT_CONTEXT, "research", "references/guide.md"),
    "# Guide",
  );
});

Deno.test("runtime project skill loader returns null and logs when lookup is denied", async () => {
  const { loader, warnings } = createLoader({
    getProjectFile: async () => {
      throw new AccessDeniedError("Access denied");
    },
  });

  assertEquals(await loader.loadProjectSkill(PROJECT_CONTEXT, "research"), null);
  assertEquals(
    await loader.loadProjectSkillReference(PROJECT_CONTEXT, "research", "references/guide.md"),
    null,
  );
  assertEquals(warnings, [
    {
      message: "Falling back to builtin skill after project skill lookup was denied",
      metadata: {
        projectId: "project-1",
        branchId: "branch-1",
        skillId: "research",
      },
    },
    {
      message: "Falling back to builtin skill reference after project skill lookup was denied",
      metadata: {
        projectId: "project-1",
        branchId: "branch-1",
        skillId: "research",
        file: "references/guide.md",
      },
    },
  ]);
});
