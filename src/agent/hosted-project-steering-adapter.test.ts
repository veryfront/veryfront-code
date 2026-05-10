import { assert, assertEquals } from "#veryfront/testing/assert.ts";
import { join } from "node:path";
import { createHostedProjectSteeringAdapter } from "./hosted-project-steering-adapter.ts";
import type {
  RuntimeGetProjectFileOptions,
  RuntimeProjectFile,
  RuntimeProjectFileListItem,
  RuntimeProjectFilesApiOptions,
  RuntimeProjectFilesClient,
} from "./runtime-project-files-client.ts";

async function createSkillsDir(): Promise<string> {
  const skillsDir = await Deno.makeTempDir();
  const skillDir = join(skillsDir, "builtin");
  await Deno.mkdir(skillDir, { recursive: true });
  await Deno.writeTextFile(
    join(skillDir, "SKILL.md"),
    `---
name: Builtin
description: Builtin skill
---
Use builtin instructions.`,
  );
  return skillsDir;
}

async function withSkillsDir<T>(fn: (skillsDir: string) => Promise<T>): Promise<T> {
  const skillsDir = await createSkillsDir();
  try {
    return await fn(skillsDir);
  } finally {
    await Deno.remove(skillsDir, { recursive: true });
  }
}

function createProjectFilesClient(input: {
  getProjectFile?: (options: RuntimeGetProjectFileOptions) => Promise<RuntimeProjectFile | null>;
  getProjectFiles?: (
    options: RuntimeProjectFilesApiOptions,
  ) => Promise<RuntimeProjectFileListItem[]>;
} = {}): RuntimeProjectFilesClient {
  return {
    getProjectFile: (options) => input.getProjectFile?.(options) ?? Promise.resolve(null),
    getProjectFiles: (options) => input.getProjectFiles?.(options) ?? Promise.resolve([]),
  };
}

Deno.test("hosted project steering adapter loads instructions and project skills", async () => {
  await withSkillsDir(async (skillsDir) => {
    const fileCalls: RuntimeGetProjectFileOptions[] = [];
    const adapter = createHostedProjectSteeringAdapter({
      apiUrl: "https://api.example.test",
      skillsDir,
      projectFilesClient: createProjectFilesClient({
        getProjectFile: async (options) => {
          fileCalls.push(options);
          if (options.path === "AGENTS.md") {
            return { path: options.path, content: "Project instructions" };
          }
          if (options.path === ".veryfront/skills/project/SKILL.md") {
            return {
              path: options.path,
              content: `---
name: Project Skill
description: Project skill
---
Use project instructions.`,
            };
          }
          return null;
        },
        getProjectFiles: async () => [
          { path: ".veryfront/skills/project/SKILL.md" },
          { path: ".veryfront/skills/project/references/guide.md" },
        ],
      }),
    });

    const lookup = {
      projectId: "project-1",
      authToken: "token-1",
      branchId: "branch-1",
    };

    assertEquals(await adapter.getProjectInstructions(lookup), "Project instructions");
    assertEquals((await adapter.getSkillsConfig(lookup)).map((skill) => skill.id), [
      "builtin",
      "project",
    ]);
    assertEquals(fileCalls.length, 2);
    assertEquals(fileCalls[0], {
      projectId: "project-1",
      authToken: "token-1",
      branchId: "branch-1",
      path: "AGENTS.md",
    });
  });
});

Deno.test("hosted project steering adapter creates load_skill and refreshes project skill ids", async () => {
  await withSkillsDir(async (skillsDir) => {
    const adapter = createHostedProjectSteeringAdapter({
      apiUrl: "https://api.example.test",
      skillsDir,
      projectFilesClient: createProjectFilesClient({
        getProjectFile: async ({ path }) =>
          path === ".veryfront/skills/project/SKILL.md"
            ? {
              path,
              content: `---
name: Project Skill
description: Project skill
---
Use project instructions.`,
            }
            : null,
        getProjectFiles: async () => [{ path: ".veryfront/skills/project/SKILL.md" }],
      }),
    });
    const context = {
      projectId: "project-1",
      authToken: "token-1",
      branchId: null,
      availableSkillIds: [],
    };

    await adapter.refreshProjectSkillIds(context);
    assertEquals(context.availableSkillIds, ["builtin", "project"]);

    const loadSkillTool = adapter.createLoadSkillTool(context);
    const result = await loadSkillTool.execute({ skillId: "project" });

    assert("skillId" in result);
    assertEquals(result.skillId, "project");
    assert("instructions" in result);
    assertEquals(result.instructions.includes("Use project instructions."), true);
  });
});
