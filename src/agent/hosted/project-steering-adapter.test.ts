import "#veryfront/schemas/_test-setup.ts";
import {
  assert,
  assertEquals,
  assertRejects,
  assertStringIncludes,
} from "#veryfront/testing/assert.ts";
import { join } from "node:path";
import { createStdYamlSkillDocumentParserProvider } from "../../../extensions/ext-yaml/src/adapter.ts";
import { SKILL_TEXT_FILE_MAX_BYTES } from "#veryfront/skill/limits.ts";
import { register, tryResolve, unregister } from "#veryfront/extensions/contracts.ts";
import {
  type SkillDocumentParserProvider,
  SkillDocumentParserProviderName,
} from "#veryfront/extensions/parser/skill-document-parser.ts";
import { getDefaultSkillDocumentParserProvider } from "#veryfront/extensions/parser/skill-defaults.ts";
import {
  createHostedProjectSteeringAdapter,
  type HostedProjectSkillIdsContext,
} from "./project-steering-adapter.ts";
import type {
  RuntimeGetProjectFileOptions,
  RuntimeProjectFile,
  RuntimeProjectFileListItem,
  RuntimeProjectFilesApiOptions,
  RuntimeProjectFilesClient,
} from "../runtime/project-files-client.ts";
import type { RuntimeProjectSkillLoader } from "../runtime/project-skill-loader.ts";

const skillDocumentParserProvider = createStdYamlSkillDocumentParserProvider();

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

Deno.test("hosted project steering uses the bounded transport by default", async () => {
  await withSkillsDir(async (skillsDir) => {
    let cancelled = false;
    const adapter = createHostedProjectSteeringAdapter({
      apiUrl: "https://api.example.test",
      skillsDir,
      builtinSkills: [],
      skillDocumentParserProvider,
      fetch: () =>
        Promise.resolve(
          new Response(
            new ReadableStream<Uint8Array>({
              start(controller) {
                controller.enqueue(new Uint8Array(SKILL_TEXT_FILE_MAX_BYTES * 3));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { headers: { "Content-Type": "application/json" } },
          ),
        ),
    });

    const error = await assertRejects(() =>
      adapter.getSkillsConfig({
        projectId: "project-1",
        authToken: "token-1",
      })
    );
    await Promise.resolve();

    assertStringIncludes(String(error), "Project files list response exceeds");
    assertEquals(cancelled, true);
  });
});

Deno.test("hosted composition activates and captures its parser without test setup", async () => {
  const previous = tryResolve<SkillDocumentParserProvider>(SkillDocumentParserProviderName);
  unregister(SkillDocumentParserProviderName);
  try {
    const capturedProvider = await getDefaultSkillDocumentParserProvider();
    await withSkillsDir(async (skillsDir) => {
      const adapter = createHostedProjectSteeringAdapter({
        apiUrl: "https://api.example.test",
        skillsDir,
        projectFilesClient: createProjectFilesClient(),
        skillDocumentParserProvider: capturedProvider,
      });
      unregister(SkillDocumentParserProviderName);

      assertEquals(adapter.listBuiltinSkillIds(), ["builtin"]);
      assertEquals(
        (await adapter.getSkillsConfig({
          projectId: "project-1",
          authToken: "token-1",
        })).map((skill) => skill.id),
        ["builtin"],
      );
    });
  } finally {
    unregister(SkillDocumentParserProviderName);
    if (previous !== undefined) register(SkillDocumentParserProviderName, previous);
  }
});

Deno.test("hosted project steering adapter loads instructions and project skills", async () => {
  await withSkillsDir(async (skillsDir) => {
    const fileCalls: RuntimeGetProjectFileOptions[] = [];
    const adapter = createHostedProjectSteeringAdapter({
      apiUrl: "https://api.example.test",
      skillsDir,
      skillDocumentParserProvider,
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
    const instructionCall = { ...fileCalls[0] };
    delete instructionCall.abortSignal;
    delete instructionCall.timeoutMs;
    delete instructionCall.listingBudget;
    assertEquals(instructionCall, {
      projectId: "project-1",
      authToken: "token-1",
      branchId: "branch-1",
      path: "AGENTS.md",
      maximumContentCharacters: 1_048_576,
    });
    assert(typeof fileCalls[0]?.timeoutMs === "number");
  });
});

Deno.test("hosted project steering preserves the legacy option set with prebuilt dependencies", async () => {
  const projectFilesClient = createProjectFilesClient({
    getProjectFile: async ({ path }) =>
      path === "AGENTS.md" ? { path, content: "Legacy project instructions" } : null,
  });
  const projectSkillLoader: RuntimeProjectSkillLoader = {
    listProjectSkillReferences: () => Promise.resolve([]),
    loadProjectSkill: () => Promise.resolve(null),
    loadProjectSkillReference: () => Promise.resolve(null),
  };

  const adapter = createHostedProjectSteeringAdapter({
    apiUrl: "https://api.example.test",
    skillsDir: "/unused-with-prebuilt-dependencies",
    projectFilesClient,
    projectSkillLoader,
    builtinSkills: [],
  });

  assertEquals(adapter.listBuiltinSkillIds(), []);
  assertEquals(
    await adapter.getProjectInstructions({
      projectId: "project-1",
      authToken: "token-1",
    }),
    "Legacy project instructions",
  );
  assertEquals(
    await adapter.loadProjectSkill({
      projectId: "project-1",
      authToken: "token-1",
      branchId: null,
    }, "missing"),
    null,
  );
});

Deno.test("hosted project steering adapter creates load_skill and refreshes project skill ids", async () => {
  await withSkillsDir(async (skillsDir) => {
    const adapter = createHostedProjectSteeringAdapter({
      apiUrl: "https://api.example.test",
      skillsDir,
      skillDocumentParserProvider,
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
    const context: HostedProjectSkillIdsContext = {
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

Deno.test("hosted project steering adapter accepts a custom builtin skill store", async () => {
  await withSkillsDir(async (skillsDir) => {
    const readSkillCalls: Array<{ skillsDir: string; skillId: string }> = [];
    const referenceCalls: Array<{ skillsDir: string; skillId: string }> = [];
    const adapter = createHostedProjectSteeringAdapter({
      apiUrl: "https://api.example.test",
      skillsDir,
      skillDocumentParserProvider,
      projectFilesClient: createProjectFilesClient(),
      builtinSkills: [
        {
          id: "custom",
          name: "Custom",
          description: "Custom builtin skill",
          instructions: "",
          allowedTools: [],
        },
      ],
      builtinStore: {
        readSkill: async (storeSkillsDir, skillId) => {
          readSkillCalls.push({ skillsDir: storeSkillsDir, skillId });
          return skillId === "custom" ? "Use custom builtin instructions." : null;
        },
        readReferenceFile: async () => null,
        listReferences: async (storeSkillsDir, skillId) => {
          referenceCalls.push({ skillsDir: storeSkillsDir, skillId });
          return ["references/custom.md"];
        },
      },
    });

    const loadSkillTool = adapter.createLoadSkillTool({
      projectId: null,
      authToken: "token-1",
      branchId: null,
    });
    const result = await loadSkillTool.execute({ skillId: "custom" });

    assert("instructions" in result);
    assertEquals(result.instructions, "Use custom builtin instructions.");
    assertEquals(result.references, ["references/custom.md"]);
    assertEquals(readSkillCalls, [{ skillsDir, skillId: "custom" }]);
    assertEquals(referenceCalls, [{ skillsDir, skillId: "custom" }]);
  });
});

Deno.test("refreshProjectSkillIds keeps the caller's owner scope and source paths", async () => {
  await withSkillsDir(async (skillsDir) => {
    const skillMd = (name: string) =>
      `---
name: ${name}
description: ${name} skill
---
Body.`;
    const adapter = createHostedProjectSteeringAdapter({
      apiUrl: "https://api.example.test",
      skillsDir,
      skillDocumentParserProvider,
      projectFilesClient: createProjectFilesClient({
        getProjectFile: async ({ path }) =>
          path === "skills/global/SKILL.md" ||
            path === "agents/researcher/skills/cite/SKILL.md" ||
            path === "agents/writer/skills/style/SKILL.md"
            ? { path, content: skillMd(path) }
            : null,
        getProjectFiles: async () => [
          { path: "skills/global/SKILL.md" },
          { path: "agents/researcher/AGENT.md" },
          { path: "agents/researcher/skills/cite/SKILL.md" },
          { path: "agents/writer/AGENT.md" },
          { path: "agents/writer/skills/style/SKILL.md" },
        ],
      }),
    });

    // With an agent scope: unowned + own, never another agent's owned skill;
    // the source-path map refreshes alongside.
    const researcherContext = {
      projectId: "project-1",
      authToken: "token-1",
      branchId: null,
      agentId: "researcher",
      availableSkillIds: ["stale-id"],
      skillSourcePaths: { "stale-id": "skills/stale/SKILL.md" } as Readonly<
        Record<string, string>
      >,
    };
    await adapter.refreshProjectSkillIds(researcherContext);
    assertEquals(researcherContext.availableSkillIds, ["builtin", "global", "researcher--cite"]);
    assertEquals(researcherContext.skillSourcePaths, {
      global: "skills/global/SKILL.md",
      "researcher--cite": "agents/researcher/skills/cite/SKILL.md",
    });

    // Without an agent scope: conservative project-level rule (unowned only).
    const projectContext = {
      projectId: "project-1",
      authToken: "token-1",
      branchId: null,
      availableSkillIds: [],
    };
    await adapter.refreshProjectSkillIds(projectContext);
    assertEquals(projectContext.availableSkillIds, ["builtin", "global"]);
  });
});

Deno.test("refreshProjectSkillIds keeps a none skill selector policy at zero skills", async () => {
  await withSkillsDir(async (skillsDir) => {
    const adapter = createHostedProjectSteeringAdapter({
      apiUrl: "https://api.example.test",
      skillsDir,
      skillDocumentParserProvider,
      projectFilesClient: createProjectFilesClient({
        getProjectFile: async ({ path }) =>
          path === "skills/global/SKILL.md" || path === "skills/new-skill/SKILL.md"
            ? {
              path,
              content: `---
description: ${path}
---
Body.`,
            }
            : null,
        getProjectFiles: async () => [
          { path: "skills/global/SKILL.md" },
          { path: "skills/new-skill/SKILL.md" },
        ],
      }),
    });

    const context: HostedProjectSkillIdsContext = {
      projectId: "project-1",
      authToken: "token-1",
      branchId: null,
      availableSkillIds: ["global"],
      skillSelectorPolicy: { kind: "none" as const },
    };

    await adapter.refreshProjectSkillIds(context);

    assertEquals(
      context.availableSkillIds,
      [],
      "none policy must expose zero skills even when the catalog has entries",
    );
    assertEquals(
      context.skillSelectorPolicy,
      { kind: "none" },
      "none policy must survive refresh unchanged",
    );
  });
});

Deno.test("refreshProjectSkillIds rejects unresolved authored allowlist entries without narrowing", async () => {
  await withSkillsDir(async (skillsDir) => {
    const adapter = createHostedProjectSteeringAdapter({
      apiUrl: "https://api.example.test",
      skillsDir,
      skillDocumentParserProvider,
      projectFilesClient: createProjectFilesClient({
        getProjectFile: async ({ path }) =>
          path === "skills/global/SKILL.md" || path === "skills/new-skill/SKILL.md"
            ? {
              path,
              content: `---
description: ${path}
---
Body.`,
            }
            : null,
        getProjectFiles: async () => [
          { path: "skills/global/SKILL.md" },
          { path: "skills/new-skill/SKILL.md" },
        ],
      }),
    });

    const context: HostedProjectSkillIdsContext = {
      projectId: "project-1",
      authToken: "token-1",
      branchId: null,
      availableSkillIds: ["global", "new-skill"],
      skillSelectorPolicy: { kind: "allowlist" as const, entries: ["global", "deleted"] },
    };

    const error = await assertRejects(
      () => adapter.refreshProjectSkillIds(context),
      Error,
      "configured skills are not available",
    );

    assertEquals(String(error).includes("deleted"), false);
    assertEquals(context.availableSkillIds, ["global", "new-skill"]);
    assertEquals(context.skillSelectorPolicy, {
      kind: "allowlist",
      entries: ["global", "deleted"],
    });
    assertEquals(context.skillSourcePaths, undefined);
  });
});
