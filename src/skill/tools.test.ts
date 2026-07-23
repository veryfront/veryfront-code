import "#veryfront/schemas/_test-setup.ts";
import { assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { registerSkill, skillRegistry } from "./registry.ts";
import {
  createExecuteSkillScriptTool,
  createLoadSkillReferenceTool,
  createLoadSkillTool,
} from "./tools.ts";
import type { Skill } from "./types.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { createSkillTestAdapter } from "./testing.ts";

function createTestSkill(fsAdapter: FileSystemAdapter): Skill {
  return {
    id: "my-skill",
    metadata: {
      name: "my-skill",
      description: "Skill from adapter",
    },
    rootPath: "/project/skills/my-skill",
    fsAdapter,
  };
}

function createNamedTestSkill(id: string, fsAdapter: FileSystemAdapter): Skill {
  const metadataName = id.includes("--") ? id.slice(id.lastIndexOf("--") + 2) : id;
  return {
    id,
    metadata: {
      name: metadataName,
      description: `Skill ${id}`,
    },
    rootPath: `/project/skills/${id}`,
    fsAdapter,
  };
}

describe("src/skill/tools", () => {
  beforeEach(() => {
    skillRegistry.clearAll();
  });

  it("uses snake case runtime ids for skill platform tools", () => {
    assertEquals(createLoadSkillTool().id, "load_skill");
    assertEquals(createLoadSkillReferenceTool().id, "load_skill_reference");
    assertEquals(createExecuteSkillScriptTool().id, "execute_skill_script");
  });

  it("load_skill should list references and scripts via fsAdapter", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
allowed-tools: Read api:*
---
# Instructions
Do work.`,
      "/project/skills/my-skill/references/guide.md": "Guide",
      "/project/skills/my-skill/scripts/run.sh": "echo run",
    });
    registerSkill("my-skill", {
      ...createTestSkill(fsAdapter),
      metadata: {
        name: "my-skill",
        description: "Skill from adapter",
        allowedTools: ["Read", "api:*"],
      },
    });

    const tool = createLoadSkillTool();
    const result = await tool.execute({ skillId: "my-skill" });

    assertEquals(result.skillId, "my-skill");
    assertEquals(result.allowedTools, ["Read", "api:*"]);
    assertEquals(result.references, ["references/guide.md"]);
    assertEquals(result.scripts, ["scripts/run.sh"]);
  });

  it("load_skill should enforce the current definition policy instead of stale registry metadata", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
allowed-tools: Write
---
Do work.`,
    });
    registerSkill("my-skill", {
      ...createTestSkill(fsAdapter),
      metadata: {
        name: "my-skill",
        description: "Skill from adapter",
        allowedTools: ["Read"],
      },
    });

    const result = await createLoadSkillTool().execute({ skillId: "my-skill" });

    assertEquals(result.allowedTools, ["Write"]);
  });

  it("load_skill should reject oversized definitions before reading them", async () => {
    const baseAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
---
Do work.`,
    });
    const fsAdapter: FileSystemAdapter = {
      ...baseAdapter,
      async stat(path: string) {
        const info = await baseAdapter.stat(path);
        return path.endsWith("/SKILL.md") ? { ...info, size: 1_048_577 } : info;
      },
    };
    registerSkill("my-skill", createTestSkill(fsAdapter));

    await assertRejects(
      () => createLoadSkillTool().execute({ skillId: "my-skill" }),
      Error,
      "size limit",
    );
  });

  it("load_skill should reject a definition symlink outside the skill root", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "vf-skill-definition-boundary-" });
    const skillRoot = `${tempDir}/my-skill`;
    const outsideDefinition = `${tempDir}/outside.md`;
    try {
      await Deno.mkdir(skillRoot, { recursive: true });
      await Deno.writeTextFile(
        outsideDefinition,
        "---\nname: my-skill\ndescription: Outside definition\n---\nOutside instructions",
      );
      await Deno.symlink(outsideDefinition, `${skillRoot}/SKILL.md`);
      registerSkill("my-skill", {
        id: "my-skill",
        metadata: { name: "my-skill", description: "Registered definition" },
        rootPath: skillRoot,
      });

      await assertRejects(
        () => createLoadSkillTool().execute({ skillId: "my-skill" }),
        Error,
        "symlink",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("load_skill should list resources as loadable references via fsAdapter", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
---
# Instructions
Review the resource files.`,
      "/project/skills/my-skill/resources/article-30.md": "Article 30",
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    const tool = createLoadSkillTool();
    const result = await tool.execute({ skillId: "my-skill" });

    assertEquals(result.references, ["resources/article-30.md"]);
  });

  it("load_skill should list assets as loadable references via fsAdapter", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
---
# Instructions
Review the asset files.`,
      "/project/skills/my-skill/assets/checklist.txt": "Checklist",
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    const tool = createLoadSkillTool();
    const result = await tool.execute({ skillId: "my-skill" });

    assertEquals(result.references, ["assets/checklist.txt"]);
  });

  it("load_skill should omit prompt notes for unavailable file tools", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
---
# Instructions
Do work.`,
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    const tool = createLoadSkillTool();
    const result = await tool.execute({ skillId: "my-skill" });

    assertEquals(result.note, undefined);

    const referencesOnlyAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
---
# Instructions
Do work.`,
      "/project/skills/my-skill/references/guide.md": "Guide",
    });
    registerSkill("my-skill", createTestSkill(referencesOnlyAdapter));

    const referencesOnly = await tool.execute({ skillId: "my-skill" });

    assertEquals(referencesOnly.note, undefined);

    const scriptsOnlyAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
---
# Instructions
Do work.`,
      "/project/skills/my-skill/scripts/run.sh": "echo run",
    });
    registerSkill("my-skill", createTestSkill(scriptsOnlyAdapter));

    const scriptsOnly = await tool.execute({ skillId: "my-skill" });

    assertEquals(scriptsOnly.note, undefined);
  });

  it("load_skill_reference should read content via fsAdapter", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/references/guide.md": "Reference text",
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    const tool = createLoadSkillReferenceTool();
    const result = await tool.execute({
      skillId: "my-skill",
      reference: "references/guide.md",
    });

    assertEquals(result.content, "Reference text");
    assertEquals(result.path, "references/guide.md");
  });

  it("load_skill_reference should read asset files via fsAdapter", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/assets/checklist.txt": "Asset text",
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    const tool = createLoadSkillReferenceTool();
    const result = await tool.execute({
      skillId: "my-skill",
      reference: "assets/checklist.txt",
    });

    assertEquals(result.content, "Asset text");
    assertEquals(result.path, "assets/checklist.txt");
  });

  it("load_skill_reference should read resource files via fsAdapter", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/resources/article-30.md": "Article 30 text",
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    const tool = createLoadSkillReferenceTool();
    const result = await tool.execute({
      skillId: "my-skill",
      reference: "resources/article-30.md",
    });

    assertEquals(result.content, "Article 30 text");
    assertEquals(result.path, "resources/article-30.md");
  });

  it("load_skill_reference should reject binary content instead of corrupting it", async () => {
    const path = "/project/skills/my-skill/assets/image.bin";
    const baseAdapter = createSkillTestAdapter({ [path]: "placeholder" });
    const fsAdapter: FileSystemAdapter = {
      ...baseAdapter,
      async readFileBytes(requestedPath: string) {
        if (requestedPath === path) return new Uint8Array([0xff, 0xfe, 0xfd]);
        return new TextEncoder().encode(await baseAdapter.readFile(requestedPath));
      },
    };
    registerSkill("my-skill", createTestSkill(fsAdapter));

    await assertRejects(
      () =>
        createLoadSkillReferenceTool().execute({
          skillId: "my-skill",
          reference: "assets/image.bin",
        }),
      Error,
      "valid UTF-8 text",
    );
  });

  it("load_skill_reference should reject NUL bytes from text content", async () => {
    const path = "/project/skills/my-skill/references/unsafe.txt";
    const baseAdapter = createSkillTestAdapter({ [path]: "placeholder" });
    const fsAdapter: FileSystemAdapter = {
      ...baseAdapter,
      async readFileBytes(requestedPath: string) {
        if (requestedPath === path) return new Uint8Array([65, 0, 66]);
        return new TextEncoder().encode(await baseAdapter.readFile(requestedPath));
      },
    };
    registerSkill("my-skill", createTestSkill(fsAdapter));

    await assertRejects(
      () =>
        createLoadSkillReferenceTool().execute({
          skillId: "my-skill",
          reference: "references/unsafe.txt",
        }),
      Error,
      "valid UTF-8 text",
    );
  });

  it("skill file tools should stop before I/O when the call is already aborted", async () => {
    let reads = 0;
    const baseAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
---
Do work.`,
      "/project/skills/my-skill/references/guide.md": "Guide",
    });
    const fsAdapter: FileSystemAdapter = {
      ...baseAdapter,
      async readFile(path: string) {
        reads += 1;
        return await baseAdapter.readFile(path);
      },
    };
    registerSkill("my-skill", createTestSkill(fsAdapter));
    const controller = new AbortController();
    controller.abort(new Error("file call canceled"));

    await assertRejects(
      () =>
        createLoadSkillTool().execute(
          { skillId: "my-skill" },
          { abortSignal: controller.signal },
        ),
      Error,
      "file call canceled",
    );
    await assertRejects(
      () =>
        createLoadSkillReferenceTool().execute(
          { skillId: "my-skill", reference: "references/guide.md" },
          { abortSignal: controller.signal },
        ),
      Error,
      "file call canceled",
    );
    assertEquals(reads, 0);
  });

  it("load_skill_reference should allow the active skill through its short name", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/researcher--cite/references/guide.md": "Citation guide",
    });
    registerSkill("researcher--cite", {
      ...createNamedTestSkill("researcher--cite", fsAdapter),
      ownerAgentId: "researcher",
      shortName: "cite",
    });

    const tool = createLoadSkillReferenceTool();
    const result = await tool.execute({
      skillId: "cite",
      reference: "references/guide.md",
    }, {
      agentId: "researcher",
      activeSkillId: "researcher--cite",
      activeSkillToolAvailability: {
        hasActiveSkill: true,
        references: ["references/guide.md"],
        scripts: [],
      },
    });

    assertEquals(result.content, "Citation guide");
    assertEquals(result.path, "references/guide.md");
  });

  it("load_skill_reference should reject a different skill than the active loaded skill", async () => {
    const activeAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/references/guide.md": "Guide",
    });
    const otherAdapter = createSkillTestAdapter({
      "/project/skills/other-skill/references/secret.md": "Secret",
    });
    registerSkill("my-skill", createNamedTestSkill("my-skill", activeAdapter));
    registerSkill("other-skill", createNamedTestSkill("other-skill", otherAdapter));

    const tool = createLoadSkillReferenceTool();

    await assertRejects(
      () =>
        tool.execute({
          skillId: "other-skill",
          reference: "references/secret.md",
        }, {
          activeSkillId: "my-skill",
          activeSkillToolAvailability: {
            hasActiveSkill: true,
            references: ["references/guide.md"],
            scripts: [],
          },
        }),
      Error,
    );
  });

  it("load_skill_reference should reject files not advertised by the active skill", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/references/guide.md": "Guide",
      "/project/skills/my-skill/references/hidden.md": "Hidden",
    });
    registerSkill("my-skill", createNamedTestSkill("my-skill", fsAdapter));

    const tool = createLoadSkillReferenceTool();

    await assertRejects(
      () =>
        tool.execute({
          skillId: "my-skill",
          reference: "references/hidden.md",
        }, {
          activeSkillId: "my-skill",
          activeSkillToolAvailability: {
            hasActiveSkill: true,
            references: ["references/guide.md"],
            scripts: [],
          },
        }),
      Error,
    );
  });

  it("execute_skill_script should run a local script from the skill directory", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "vf-skill-script-" });

    try {
      const skillRoot = `${tempDir}/my-skill`;
      await Deno.mkdir(`${skillRoot}/scripts`, { recursive: true });
      await Deno.writeTextFile(
        `${skillRoot}/scripts/echo-style.sh`,
        [
          "#!/usr/bin/env bash",
          'echo "style=$STYLE voice=$1"',
        ].join("\n"),
      );

      registerSkill("my-skill", {
        id: "my-skill",
        metadata: { name: "my-skill", description: "Executes scripts" },
        rootPath: skillRoot,
      });

      const tool = createExecuteSkillScriptTool();
      const result = await tool.execute({
        skillId: "my-skill",
        script: "scripts/echo-style.sh",
        args: ["active"],
        env: { STYLE: "tight" },
      });

      assertEquals(result.exitCode, 0);
      assertEquals(result.stderr, "");
      assertEquals(result.stdout.trim(), "style=tight voice=active");
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("execute_skill_script should not run adapter-backed source in the host", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "vf-skill-adapter-boundary-" });

    try {
      const skillRoot = `${tempDir}/my-skill`;
      const scriptPath = `${skillRoot}/scripts/run.sh`;
      await Deno.mkdir(`${skillRoot}/scripts`, { recursive: true });
      await Deno.writeTextFile(scriptPath, "echo host-path-must-not-run");

      const fsAdapter = createSkillTestAdapter({
        [scriptPath]: "echo adapter-source",
      });
      registerSkill("my-skill", {
        id: "my-skill",
        metadata: { name: "my-skill", description: "Adapter-backed scripts" },
        rootPath: skillRoot,
        fsAdapter,
      });

      await assertRejects(
        () =>
          createExecuteSkillScriptTool().execute({
            skillId: "my-skill",
            script: "scripts/run.sh",
          }),
        Error,
        "isolated execution",
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("execute_skill_script should reject scripts not advertised by the active skill", async () => {
    const tempDir = await Deno.makeTempDir({ prefix: "vf-skill-script-policy-" });

    try {
      const skillRoot = `${tempDir}/my-skill`;
      await Deno.mkdir(`${skillRoot}/scripts`, { recursive: true });
      await Deno.writeTextFile(
        `${skillRoot}/scripts/hidden.sh`,
        [
          "#!/usr/bin/env bash",
          'echo "hidden"',
        ].join("\n"),
      );

      registerSkill("my-skill", {
        id: "my-skill",
        metadata: { name: "my-skill", description: "Executes scripts" },
        rootPath: skillRoot,
      });

      const tool = createExecuteSkillScriptTool();

      await assertRejects(
        () =>
          tool.execute({
            skillId: "my-skill",
            script: "scripts/hidden.sh",
          }, {
            activeSkillId: "my-skill",
            activeSkillToolAvailability: {
              hasActiveSkill: true,
              references: [],
              scripts: ["scripts/run.sh"],
            },
          }),
        Error,
      );
    } finally {
      await Deno.remove(tempDir, { recursive: true });
    }
  });

  it("execute_skill_script should not start work for an already aborted call", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/scripts/run.sh": "echo must-not-run",
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));

    const controller = new AbortController();
    controller.abort(new Error("skill call canceled"));

    await assertRejects(
      () =>
        createExecuteSkillScriptTool().execute({
          skillId: "my-skill",
          script: "scripts/run.sh",
        }, {
          abortSignal: controller.signal,
        }),
      Error,
      "skill call canceled",
    );
  });

  it("execute_skill_script should bound arguments and environment entries", async () => {
    const tool = createExecuteSkillScriptTool();

    await assertRejects(
      () =>
        tool.execute({
          skillId: "my-skill",
          script: "scripts/run.sh",
          args: Array.from({ length: 129 }, () => "arg"),
        }),
      Error,
      "input validation failed",
    );

    const env = Object.fromEntries(
      Array.from({ length: 129 }, (_, index) => [`KEY_${index}`, "value"]),
    );
    await assertRejects(
      () =>
        tool.execute({
          skillId: "my-skill",
          script: "scripts/run.sh",
          env,
        }),
      Error,
      "too many environment variables",
    );
  });
});
