import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects, assertThrows } from "#veryfront/testing/assert.ts";
import { join } from "node:path";
import {
  createHostedProjectSteeringAdapter,
  createStrictHostedProjectSteeringAdapter,
  type HostedProjectSkillIdsContext,
} from "./project-steering-adapter.ts";
import type {
  RuntimeGetProjectFileOptions,
  RuntimeProjectFile,
  RuntimeProjectFileListItem,
  RuntimeProjectFilesApiOptions,
  RuntimeProjectFilesClient,
} from "../runtime/project-files-client.ts";

async function createSkillsDir(): Promise<string> {
  const skillsDir = await Deno.makeTempDir();
  const skillDir = join(skillsDir, "builtin");
  await Deno.mkdir(skillDir, { recursive: true });
  await Deno.writeTextFile(
    join(skillDir, "SKILL.md"),
    `---
name: builtin
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
name: project
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

Deno.test("hosted project steering adapter uses the strict default project files client", async () => {
  await withSkillsDir(async (skillsDir) => {
    let fetchCalls = 0;
    const adapter = createStrictHostedProjectSteeringAdapter({
      apiUrl: "https://api.example.test",
      skillsDir,
      fetch: async () => {
        fetchCalls += 1;
        return new Response(null, { status: 404 });
      },
    });

    await assertRejects(
      () =>
        adapter.getProjectInstructions({
          projectId: "..",
          authToken: "token-1",
        }),
      TypeError,
      "route-safe",
    );
    assertEquals(fetchCalls, 0);
  });
});

Deno.test("strict hosted project steering propagates in-flight caller cancellation", async () => {
  await withSkillsDir(async (skillsDir) => {
    const controller = new AbortController();
    const cancellation = new DOMException("stop project steering", "AbortError");
    let notifyFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      notifyFetchStarted = resolve;
    });
    const observedSignals: AbortSignal[] = [];
    const adapter = createStrictHostedProjectSteeringAdapter({
      apiUrl: "https://api.example.test",
      skillsDir,
      fetch: (_url, init) => {
        observedSignals.push(init.signal as AbortSignal);
        notifyFetchStarted();
        return new Promise(() => undefined);
      },
    });

    const instructions = adapter.getProjectInstructionsForRequest(
      {
        projectId: "project-1",
        authToken: "token-1",
      },
      controller.signal,
    );
    await fetchStarted;
    controller.abort(cancellation);
    const error = await assertRejects(() => instructions);

    assertEquals(error, cancellation);
    assertEquals(observedSignals[0]?.aborted, true);
    assertEquals(observedSignals[0]?.reason, cancellation);
  });
});

Deno.test("strict hosted load_skill routes execution cancellation to the project-files request", async () => {
  await withSkillsDir(async (skillsDir) => {
    const controller = new AbortController();
    const cancellation = new DOMException("cancel load_skill", "AbortError");
    let observedSignal: AbortSignal | undefined;
    let notifyFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      notifyFetchStarted = resolve;
    });
    let releaseFetch!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      releaseFetch = resolve;
    });
    const adapter = createStrictHostedProjectSteeringAdapter({
      apiUrl: "https://api.example.test",
      skillsDir,
      fetch: (_url, init) => {
        observedSignal = init.signal as AbortSignal;
        notifyFetchStarted();
        return pendingResponse;
      },
    });
    const loadSkill = adapter.createLoadSkillTool({
      projectId: "project-1",
      authToken: "token-1",
      branchId: null,
      availableSkillIds: ["project"],
      skillSourcePaths: {
        project: "skills/project/SKILL.md",
      },
    });

    const result = loadSkill.execute(
      { skillId: "project" },
      { abortSignal: controller.signal },
    );
    await fetchStarted;
    controller.abort(cancellation);
    await Promise.resolve();
    releaseFetch(new Response(null, { status: 404 }));
    const error = await assertRejects(() => result);

    assertEquals(error, cancellation);
    assertEquals(observedSignal?.aborted, true);
    assertEquals(observedSignal?.reason, cancellation);
  });
});

Deno.test("strict hosted skill refresh routes caller cancellation to the project-files request", async () => {
  await withSkillsDir(async (skillsDir) => {
    const controller = new AbortController();
    const cancellation = new DOMException("cancel skill refresh", "AbortError");
    let observedSignal: AbortSignal | undefined;
    let notifyFetchStarted!: () => void;
    const fetchStarted = new Promise<void>((resolve) => {
      notifyFetchStarted = resolve;
    });
    let releaseFetch!: (response: Response) => void;
    const pendingResponse = new Promise<Response>((resolve) => {
      releaseFetch = resolve;
    });
    const adapter = createStrictHostedProjectSteeringAdapter({
      apiUrl: "https://api.example.test",
      skillsDir,
      fetch: (_url, init) => {
        observedSignal = init.signal as AbortSignal;
        notifyFetchStarted();
        return pendingResponse;
      },
    });
    const requestAdapter = adapter as typeof adapter & {
      refreshProjectSkillIdsForRequest?: (
        context: {
          projectId: string;
          authToken: string;
          branchId: null;
          availableSkillIds: string[];
        },
        signal: AbortSignal,
      ) => Promise<void>;
    };

    assert(
      typeof requestAdapter.refreshProjectSkillIdsForRequest === "function",
      "strict adapter must expose request-scoped skill refresh",
    );
    const result = requestAdapter.refreshProjectSkillIdsForRequest(
      {
        projectId: "project-1",
        authToken: "token-1",
        branchId: null,
        availableSkillIds: [],
      },
      controller.signal,
    );
    await fetchStarted;
    controller.abort(cancellation);
    await Promise.resolve();
    releaseFetch(new Response(null, { status: 404 }));
    const error = await assertRejects(() => result);

    assertEquals(error, cancellation);
    assertEquals(observedSignal?.aborted, true);
    assertEquals(observedSignal?.reason, cancellation);
  });
});

Deno.test("strict hosted project steering rejects signal-unaware client injection", async () => {
  await withSkillsDir(async (skillsDir) => {
    type StrictOptions = Parameters<typeof createStrictHostedProjectSteeringAdapter>[0];
    const strictTypeRejectsPublicClient: RuntimeProjectFilesClient extends
      NonNullable<StrictOptions["projectFilesClient"]> ? false
      : true = true;
    assertEquals(strictTypeRejectsPublicClient, true);

    const projectFilesClient = createProjectFilesClient();
    const publicAdapter = createHostedProjectSteeringAdapter({
      apiUrl: "https://api.example.test",
      skillsDir,
      projectFilesClient,
    });
    assertEquals(
      await publicAdapter.getProjectInstructions({
        projectId: "project-1",
        authToken: "token-1",
      }),
      "",
    );

    assertThrows(
      () =>
        createStrictHostedProjectSteeringAdapter({
          apiUrl: "https://api.example.test",
          skillsDir,
          projectFilesClient,
        } as never),
      TypeError,
      "signal-unaware projectFilesClient",
    );
  });
});

Deno.test("public hosted project steering adapter preserves the legacy project files client", async () => {
  await withSkillsDir(async (skillsDir) => {
    let fetchCalls = 0;
    const adapter = createHostedProjectSteeringAdapter({
      apiUrl: "https://api.example.test",
      skillsDir,
      fetch: async () => {
        fetchCalls += 1;
        return new Response(null, { status: 404 });
      },
    });

    assertEquals(
      await adapter.getProjectInstructions({
        projectId: "..",
        authToken: "",
      }),
      "",
    );
    assertEquals(fetchCalls, 1);
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
name: project
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
        readSkill: (storeSkillsDir, skillId) => {
          readSkillCalls.push({ skillsDir: storeSkillsDir, skillId });
          return skillId === "custom" ? "Use custom builtin instructions." : null;
        },
        readReferenceFile: () => null,
        listReferences: (storeSkillsDir, skillId) => {
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
      projectFilesClient: createProjectFilesClient({
        getProjectFile: async ({ path }) => {
          const skillName = path === "skills/global/SKILL.md"
            ? "global"
            : path === "agents/researcher/skills/cite/SKILL.md"
            ? "cite"
            : path === "agents/writer/skills/style/SKILL.md"
            ? "style"
            : null;
          return skillName ? { path, content: skillMd(skillName) } : null;
        },
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

Deno.test("refreshProjectSkillIds rejects unresolved authored allowlist entries without narrowing", async () => {
  await withSkillsDir(async (skillsDir) => {
    const adapter = createHostedProjectSteeringAdapter({
      apiUrl: "https://api.example.test",
      skillsDir,
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
