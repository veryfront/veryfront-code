import { skillRegistryInternal } from "#veryfront/skill/registry.ts";
import "./_test-setup.ts";
import "#veryfront/schemas/_test-setup.ts";
import { assert, assertEquals, assertRejects } from "#veryfront/testing/assert.ts";
import { beforeEach, describe, it } from "#veryfront/testing/bdd.ts";
import { registerSkill } from "./registry.ts";
import {
  createExecuteSkillScriptTool,
  createLoadSkillReferenceTool,
  createLoadSkillTool,
} from "./tools.ts";
import type { Skill, SkillScriptResult } from "./types.ts";
import type { FileSystemAdapter } from "#veryfront/platform/adapters/base.ts";
import { createSkillTestAdapter } from "./testing.ts";
import { LocalScriptExecutor } from "./executor.ts";

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
  return {
    id,
    metadata: {
      name: id,
      description: `Skill ${id}`,
    },
    rootPath: `/project/skills/${id}`,
    fsAdapter,
  };
}

describe("src/skill/tools", () => {
  beforeEach(() => {
    skillRegistryInternal.clearAll();
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

  it("load_skill should reject skills outside the selector before reading storage", async () => {
    let readCount = 0;
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/SKILL.md": `---
name: my-skill
description: Skill from adapter
---
# Instructions
Do work.`,
    });
    const countingAdapter: FileSystemAdapter = {
      ...fsAdapter,
      async readFile(path) {
        readCount++;
        return await fsAdapter.readFile(path);
      },
    };
    registerSkill("my-skill", createTestSkill(countingAdapter));

    const tool = createLoadSkillTool();

    await assertRejects(
      () =>
        tool.execute({ skillId: "my-skill" }, {
          agentId: "agent",
          allowedSkillIds: [],
        }),
      Error,
      "not available to this agent",
    );
    assertEquals(readCount, 0);
  });

  it("load_skill should not disclose selector-disallowed skills in unavailable errors", async () => {
    const allowedAdapter = createSkillTestAdapter({
      "/project/skills/allowed-skill/SKILL.md": `---
name: allowed-skill
description: Allowed skill
---
# Instructions
Allowed work.`,
    });
    const hiddenAdapter = createSkillTestAdapter({
      "/project/skills/hidden-skill/SKILL.md": `---
name: hidden-skill
description: Hidden skill
---
# Instructions
Hidden work.`,
    });
    registerSkill("allowed-skill", createNamedTestSkill("allowed-skill", allowedAdapter));
    registerSkill("hidden-skill", createNamedTestSkill("hidden-skill", hiddenAdapter));

    const tool = createLoadSkillTool();

    const error = await assertRejects(
      () =>
        tool.execute({ skillId: "missing-skill" }, {
          agentId: "agent",
          allowedSkillIds: ["allowed-skill"],
        }),
      Error,
    );

    assert(error instanceof Error);
    assertEquals(error.message.includes("hidden-skill"), false);
    assertEquals(error.message.includes("allowed-skill"), false);

    const hiddenError = await assertRejects(
      () =>
        tool.execute({ skillId: "hidden-skill" }, {
          agentId: "agent",
          allowedSkillIds: ["allowed-skill"],
        }),
      Error,
    );

    assert(hiddenError instanceof Error);
    assertEquals(hiddenError.message.includes("hidden-skill"), false);
    assertEquals(hiddenError.message.includes("allowed-skill"), false);
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

  it("load_skill_reference should reject stale active skill state outside the selector", async () => {
    let readCount = 0;
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/references/guide.md": "Guide",
    });
    const countingAdapter: FileSystemAdapter = {
      ...fsAdapter,
      async readFile(path) {
        readCount++;
        return await fsAdapter.readFile(path);
      },
    };
    registerSkill("my-skill", createNamedTestSkill("my-skill", countingAdapter));

    const tool = createLoadSkillReferenceTool();

    await assertRejects(
      () =>
        tool.execute({
          skillId: "my-skill",
          reference: "references/guide.md",
        }, {
          agentId: "agent",
          allowedSkillIds: [],
          activeSkillId: "my-skill",
          activeSkillToolAvailability: {
            hasActiveSkill: true,
            references: ["references/guide.md"],
            scripts: [],
          },
        }),
      Error,
      "not available to this agent",
    );
    assertEquals(readCount, 0);
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

      const tool = createExecuteSkillScriptTool({
        executor: new LocalScriptExecutor(),
      });
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

  it("execute_skill_script snapshots only validated executor result fields", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/scripts/run.sh": "echo run",
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));
    let extraGetterCalls = 0;
    const executorResult = {
      stdout: "done",
      stderr: "",
      exitCode: 0,
      get extra(): string {
        extraGetterCalls += 1;
        return "ignored";
      },
    };
    const tool = createExecuteSkillScriptTool({
      executor: {
        execute: async () => executorResult,
      },
    });

    const result = await tool.execute({
      skillId: "my-skill",
      script: "scripts/run.sh",
    });
    executorResult.stdout = "mutated";

    assertEquals(result, { stdout: "done", stderr: "", exitCode: 0 });
    assertEquals("extra" in result, false);
    assertEquals(Object.isFrozen(result), true);
    assertEquals(extraGetterCalls, 0);
  });

  it("execute_skill_script rejects accessor-backed required result fields", async () => {
    const fsAdapter = createSkillTestAdapter({
      "/project/skills/my-skill/scripts/run.sh": "echo run",
    });
    registerSkill("my-skill", createTestSkill(fsAdapter));
    let getterCalls = 0;
    const executorResult = {
      get stdout(): string {
        getterCalls += 1;
        return "unsafe";
      },
      stderr: "",
      exitCode: 0,
    } as SkillScriptResult;
    const tool = createExecuteSkillScriptTool({
      executor: {
        execute: async () => executorResult,
      },
    });

    await assertRejects(
      () =>
        tool.execute({
          skillId: "my-skill",
          script: "scripts/run.sh",
        }),
      TypeError,
      'own data property for "stdout"',
    );
    assertEquals(getterCalls, 0);
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
});
